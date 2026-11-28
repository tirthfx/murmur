import { z } from "zod";
import type {
  CalendarAttendee,
  CalendarEvent,
  CalendarResponse,
  ConnectorOption,
  RsvpAnswer,
} from "@murmur/shared";
import type { ConnectorProvider } from "../providers";
import { CalendarFetchError, localDayStart } from "./google-calendar";

export const OUTLOOK_CALENDAR_ID = "outlookCalendar";
const GRAPH = "https://graph.microsoft.com/v1.0";
/** The only place the account's token is sent for events. */
export const GRAPH_ORIGIN = "https://graph.microsoft.com";

/**
 * Outlook calendar (CN-03) through Microsoft Graph: the owner's own app registration in Microsoft
 * Entra, a public client (no secret), delegated read permissions only. Microsoft registers
 * `http://localhost` for a loopback redirect, so the redirect names localhost. A work account may
 * need an administrator's consent: the provider's own message is shown when it asks for it.
 * Microsoft has no endpoint to revoke a token, so disconnecting removes it here only.
 */
export const outlookCalendarProvider: ConnectorProvider = {
  id: OUTLOOK_CALENDAR_ID,
  name: "Outlook calendar",
  authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  revokeUrl: null,
  scopes: ["Calendars.Read", "User.Read", "offline_access"],
  loopbackPort: null,
  redirectHost: "localhost",
  async accountLabel({ token, http }) {
    const response = await http(`${GRAPH}/me?$select=mail,userPrincipalName`, {
      headers: { authorization: `Bearer ${token.accessToken}` },
    });
    if (!response.ok) throw new Error("profile failed");
    const body = z
      .object({ mail: z.string().nullish(), userPrincipalName: z.string().nullish() })
      .parse(await response.json());
    const label = body.mail || body.userPrincipalName;
    if (!label) throw new Error("no address");
    return label;
  },
};

// ------------------------------------------------------------------ events

const addressSchema = z.object({
  emailAddress: z.object({ name: z.string().nullish(), address: z.string().nullish() }).optional(),
});

const eventSchema = z.object({
  id: z.string().min(1),
  subject: z.string().nullish(),
  start: z.object({ dateTime: z.string(), timeZone: z.string().optional() }).optional(),
  end: z.object({ dateTime: z.string(), timeZone: z.string().optional() }).optional(),
  isAllDay: z.boolean().optional(),
  isCancelled: z.boolean().optional(),
  location: z.object({ displayName: z.string().nullish() }).nullish(),
  attendees: z
    .array(addressSchema.extend({ status: z.object({ response: z.string().nullish() }).nullish() }))
    .optional(),
  organizer: addressSchema.nullish(),
  onlineMeeting: z.object({ joinUrl: z.string().nullish() }).nullish(),
  onlineMeetingUrl: z.string().nullish(),
  responseStatus: z.object({ response: z.string().nullish() }).nullish(),
  sensitivity: z.string().nullish(),
});

const pageSchema = z.object({
  value: z.array(z.unknown()).optional(),
  "@odata.nextLink": z.string().optional(),
});

const RESPONSES: Record<string, CalendarResponse> = {
  accepted: "accepted",
  organizer: "accepted",
  declined: "declined",
  tentativelyAccepted: "tentative",
  none: "none",
  notResponded: "none",
};

/**
 * Graph gives `2026-11-21T10:00:00.0000000` with no zone mark; with the header
 * `Prefer: outlook.timezone="UTC"` it is UTC, so this reads it as UTC. A change of the event's
 * own time zone therefore never moves the moment it starts.
 */
export function graphUtc(value: string): number {
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
}

const http = (value: string | null | undefined) =>
  value && /^https?:\/\//i.test(value) ? value : null;

/** One Graph event as an event, or null when it is cancelled or has no usable time. */
export function outlookEvent(
  item: unknown,
  accountEmail: string,
  /** On another calendar, the event's own answer is that calendar owner's, not this account's. */
  mainCalendar = true,
): Omit<CalendarEvent, "accountId" | "connector"> | null {
  const parsed = eventSchema.safeParse(item);
  if (!parsed.success) return null;
  const event = parsed.data;
  if (event.isCancelled || !event.start || !event.end) return null;

  const allDay = event.isAllDay === true;
  let startMs: number | null;
  let endMs: number | null;
  if (allDay) {
    // An all-day event is a date, not a moment: it starts at the start of that day here.
    startMs = localDayStart(event.start.dateTime.slice(0, 10));
    endMs = localDayStart(event.end.dateTime.slice(0, 10));
  } else {
    startMs = graphUtc(event.start.dateTime);
    endMs = graphUtc(event.end.dateTime);
  }
  if (startMs === null || endMs === null || Number.isNaN(startMs) || Number.isNaN(endMs))
    return null;

  const me = accountEmail.toLowerCase();
  const organizerEmail = event.organizer?.emailAddress?.address?.toLowerCase();
  const attendees: CalendarAttendee[] = (event.attendees ?? [])
    .filter((attendee) => attendee.emailAddress?.address)
    .map((attendee) => {
      const email = attendee.emailAddress!.address!.toLowerCase();
      return {
        name: attendee.emailAddress?.name ?? null,
        email,
        response: RESPONSES[attendee.status?.response ?? ""] ?? "none",
        self: email === me,
        organizer: email === organizerEmail,
      };
    });
  if (organizerEmail && !attendees.some((attendee) => attendee.email === organizerEmail))
    attendees.unshift({
      name: event.organizer?.emailAddress?.name ?? null,
      email: organizerEmail,
      response: "accepted",
      self: organizerEmail === me,
      organizer: true,
    });

  const own = mainCalendar ? RESPONSES[event.responseStatus?.response ?? ""] : undefined;
  const selfAttendee = attendees.find((attendee) => attendee.self);
  return {
    id: event.id,
    title: (event.subject ?? "").trim() || "(No title)",
    startMs,
    endMs: Math.max(endMs, startMs),
    allDay,
    location: event.location?.displayName?.trim() || null,
    attendees,
    joinUrl: http(event.onlineMeeting?.joinUrl) ?? http(event.onlineMeetingUrl),
    response: own ?? selfAttendee?.response ?? "accepted",
    isPrivate: event.sensitivity === "private" || event.sensitivity === "confidential",
  };
}

const SELECT =
  "id,subject,start,end,isAllDay,isCancelled,location,attendees,organizer,onlineMeeting,onlineMeetingUrl,responseStatus,sensitivity";

const calendarsSchema = z.object({
  value: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().nullish(),
        isDefaultCalendar: z.boolean().nullish(),
      }),
    )
    .default([]),
});

/** The account's other calendars, which can be read besides the default one (CN-03). */
export async function listOutlookCalendars(options: {
  fetch(url: string): Promise<Response>;
}): Promise<ConnectorOption[]> {
  const query = new URLSearchParams({ $select: "id,name,isDefaultCalendar", $top: "100" });
  const response = await options.fetch(`${GRAPH}/me/calendars?${query}`);
  if (!response.ok)
    throw new CalendarFetchError(`Outlook answered ${response.status}.`, response.status);
  const body = calendarsSchema.safeParse(await response.json().catch(() => null));
  if (!body.success) throw new CalendarFetchError("Outlook sent an answer Murmur cannot read.");
  return body.data.value
    .filter((calendar) => !calendar.isDefaultCalendar)
    .map((calendar) => ({ id: calendar.id, label: (calendar.name || "Calendar").slice(0, 200) }));
}

/**
 * The events of one calendar (the default one unless named) from `from` to `to` through
 * `calendarView`, which expands repeats. Times are asked for in UTC.
 */
export async function fetchOutlookEvents(options: {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  accountEmail: string;
  from: number;
  to: number;
  maxEvents: number;
  calendarId?: string;
}): Promise<Omit<CalendarEvent, "accountId" | "connector">[]> {
  const events: Omit<CalendarEvent, "accountId" | "connector">[] = [];
  const query = new URLSearchParams({
    startDateTime: new Date(options.from).toISOString(),
    endDateTime: new Date(options.to).toISOString(),
    $select: SELECT,
    $orderby: "start/dateTime",
    $top: "100",
  });
  const calendar = options.calendarId ? `calendars/${encodeURIComponent(options.calendarId)}/` : "";
  let next: string | null = `${GRAPH}/me/${calendar}calendarView?${query}`;
  for (let page = 0; page < 10 && next && events.length < options.maxEvents; page++) {
    const response: Response = await options.fetch(next, {
      headers: { prefer: 'outlook.timezone="UTC"' },
    });
    if (!response.ok)
      throw new CalendarFetchError(`Outlook answered ${response.status}.`, response.status);
    const body = pageSchema.safeParse(await response.json().catch(() => null));
    if (!body.success) throw new CalendarFetchError("Outlook sent an answer Murmur cannot read.");
    for (const item of body.data.value ?? []) {
      const event = outlookEvent(item, options.accountEmail, options.calendarId === undefined);
      if (event) events.push(event);
    }
    next = body.data["@odata.nextLink"] ?? null;
    // The next page is named by the provider's answer; the token goes only to Microsoft Graph.
    if (next !== null && new URL(next).origin !== GRAPH_ORIGIN)
      throw new CalendarFetchError("Outlook named a page somewhere else, so it was not followed.");
  }
  return events.slice(0, options.maxEvents);
}

// ------------------------------------------------------------------ creating an event (NT-28)

const createdSchema = z.object({ id: z.string().min(1), webLink: z.string().nullish() });

/** Graph wants a date and time without a zone next to the zone name: UTC, with no fraction. */
const graphTime = (ms: number) => new Date(ms).toISOString().slice(0, 19);

/**
 * Creates an event in the default calendar. Graph tells everyone on an event the moment it is
 * created, so when `invite` is off the people are not added to the event: they are named in its
 * text instead, and nobody is notified.
 */
export async function createOutlookEvent(options: {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  title: string;
  startMs: number;
  endMs: number;
  description: string;
  attendees: readonly string[];
  invite: boolean;
}): Promise<{ eventId: string; openUrl: string }> {
  const text =
    !options.invite && options.attendees.length > 0
      ? `${options.description}${options.description ? "\n\n" : ""}To invite: ${options.attendees.join(", ")}`
      : options.description;
  const response = await options.fetch(`${GRAPH}/me/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subject: options.title,
      body: { contentType: "text", content: text },
      start: { dateTime: graphTime(options.startMs), timeZone: "UTC" },
      end: { dateTime: graphTime(options.endMs), timeZone: "UTC" },
      ...(options.invite && options.attendees.length > 0
        ? {
            attendees: options.attendees.map((address) => ({
              emailAddress: { address },
              type: "required",
            })),
          }
        : {}),
    }),
  });
  if (response.status === 403)
    throw new CalendarFetchError(
      "Microsoft did not allow an event to be created. Give Murmur permission to create events and try again.",
    );
  if (!response.ok) throw new CalendarFetchError(`Outlook answered ${response.status}.`);
  const body = createdSchema.safeParse(await response.json().catch(() => null));
  if (!body.success) throw new CalendarFetchError("Outlook sent an answer Murmur cannot read.");
  const link = body.data.webLink ?? "";
  return {
    eventId: body.data.id,
    openUrl: /^https:\/\//i.test(link) ? link : "https://outlook.office.com/calendar/",
  };
}

const RSVP_ACTIONS: Record<RsvpAnswer, string> = {
  accepted: "accept",
  tentative: "tentativelyAccept",
  declined: "decline",
};

/** Answers an invitation; Graph tells the organiser (NT-02). */
export async function respondOutlookEvent(options: {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  eventId: string;
  answer: RsvpAnswer;
}): Promise<void> {
  const response = await options.fetch(
    `${GRAPH}/me/events/${encodeURIComponent(options.eventId)}/${RSVP_ACTIONS[options.answer]}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sendResponse: true }),
    },
  );
  if (!response.ok) throw new CalendarFetchError(`Outlook answered ${response.status}.`);
}
