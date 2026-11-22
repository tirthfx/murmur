import { z } from "zod";

/**
 * Calendar events as Murmur keeps them (CN-02, CN-03): one shape for every provider, times in
 * UTC milliseconds, so a change of time zone on an event never moves where it starts.
 */

/** How an invited person answered; `none` when they have not. */
export const CALENDAR_RESPONSES = ["accepted", "declined", "tentative", "none"] as const;
export type CalendarResponse = (typeof CALENDAR_RESPONSES)[number];

export interface CalendarAttendee {
  name: string | null;
  /** Lower case. */
  email: string;
  response: CalendarResponse;
  /** The person the account belongs to. */
  self: boolean;
  organizer: boolean;
}

export interface CalendarEvent {
  /** The provider's id of the event, unique within an account. */
  id: string;
  accountId: string;
  /** The provider id, for example `googleCalendar`. */
  connector: string;
  title: string;
  /** UTC milliseconds. An all-day event runs from the start of its first day here to the start of the day after its last. */
  startMs: number;
  endMs: number;
  allDay: boolean;
  location: string | null;
  attendees: CalendarAttendee[];
  /** A link that joins the call (Meet, Teams, ...), or null. */
  joinUrl: string | null;
  /** How the owner answered; `accepted` for an event nobody was invited to. */
  response: CalendarResponse;
  /** The provider marks the event private. */
  isPrivate: boolean;
}

/** The connectors that are calendars. */
export const CALENDAR_CONNECTOR_IDS = ["googleCalendar", "outlookCalendar"] as const;

/** What is kept: from a day ago to a week ahead. */
export const CALENDAR_WINDOW = { pastMs: 86_400_000, aheadMs: 7 * 86_400_000 } as const;

/** The most events one sync keeps for an account. */
export const CALENDAR_MAX_EVENTS = 500;

// ------------------------------------------------------------------ writing events (NT-28)

/**
 * The permission that lets Murmur create an event, by calendar. It is asked for only when the
 * owner turns the connector's read-only switch off, never at the first sign-in.
 */
export const CALENDAR_WRITE_SCOPES: Readonly<Record<string, string>> = {
  googleCalendar: "https://www.googleapis.com/auth/calendar.events",
  outlookCalendar: "Calendars.ReadWrite",
};

/** The last part of a scope, in lower case: Microsoft may return `Calendars.ReadWrite` as a full address. */
const scopeName = (scope: string) => scope.split("/").pop()!.toLowerCase();

/** Whether a list of granted scopes has this one. */
export function hasScope(granted: readonly string[], wanted: string): boolean {
  const name = scopeName(wanted);
  return granted.some((scope) => scope === wanted || scopeName(scope) === name);
}

/**
 * What a calendar sign-in asks for: the provider's own (read) scopes, and the write scope too
 * only when the connector is not read-only.
 */
export function calendarScopesFor(
  connectorId: string,
  providerScopes: readonly string[],
  readOnly: boolean,
): string[] {
  const write = CALENDAR_WRITE_SCOPES[connectorId];
  return !readOnly && write && !hasScope(providerScopes, write)
    ? [...providerScopes, write]
    : [...providerScopes];
}

export const CREATE_EVENT_LIMITS = {
  title: 200,
  description: 4000,
  attendees: 20,
  minMinutes: 5,
  maxMinutes: 1440,
} as const;

/** What an event is made from: a task, or a meeting (its summary). */
export const calendarEventSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("task"), id: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("meeting"), id: z.string().min(1).max(64) }),
  /** A request typed in Ask (CN-13): the id is the Ask thread's. */
  z.strictObject({ kind: z.literal("ask"), id: z.string().min(1).max(64) }),
]);
export type CalendarEventSource = z.infer<typeof calendarEventSourceSchema>;

export interface EventCandidate {
  name: string | null;
  email: string;
}

/** What the window shows before anything is created. The owner changes it, then confirms. */
export interface CalendarEventProposal {
  title: string;
  /** UTC milliseconds of the proposed start. */
  startMs: number;
  durationMinutes: number;
  /** The people invited to the meeting, who can be added. */
  candidates: EventCandidate[];
  description: string;
  accountId: string;
  accountEmail: string;
  /** The calendar service, for the words on the window: `googleCalendar` or `outlookCalendar`. */
  connector: string;
  /** Whether sending invitations is allowed at all (the setting); the confirmation has its own box. */
  invitesAllowed: boolean;
}

export type CalendarEventProposalResult =
  { ok: true; proposal: CalendarEventProposal } | { ok: false; message: string };

/** What the owner confirmed. */
export const calendarEventInputSchema = z.strictObject({
  source: calendarEventSourceSchema,
  accountId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(CREATE_EVENT_LIMITS.title),
  startMs: z.number().int().min(0).max(4_102_444_800_000),
  durationMinutes: z
    .number()
    .int()
    .min(CREATE_EVENT_LIMITS.minMinutes)
    .max(CREATE_EVENT_LIMITS.maxMinutes),
  attendees: z.array(z.string().trim().max(320)).max(CREATE_EVENT_LIMITS.attendees),
  description: z.string().max(CREATE_EVENT_LIMITS.description),
  /** The box on the confirmation. Invitations go out only when this and the setting are both on. */
  sendInvites: z.boolean(),
});
export type CalendarEventInput = z.infer<typeof calendarEventInputSchema>;

export type CalendarEventResult =
  | { ok: true; automationId: string; eventId: string; openUrl: string; invited: boolean }
  | { ok: false; message: string };

export interface CalendarEventState {
  available: boolean;
  /** Why not, in words for the button's note; null when it is. */
  reason: string | null;
  /** The action is off or its connector is not connected: it is left out of the screens that would offer it (CN-12). */
  hidden?: boolean;
}

export interface CalendarEventRecord {
  id: string;
  sourceKind: "task" | "meeting" | "ask";
  sourceId: string;
  title: string;
  startMs: number;
  /** The provider's id of the event (`automations.result_ref`). */
  eventId: string;
  /** The address of the event in the calendar, to open it. */
  openUrl: string;
  createdAt: number;
}
