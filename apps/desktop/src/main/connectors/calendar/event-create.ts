import {
  CALENDAR_CONNECTOR_IDS,
  CALENDAR_WRITE_SCOPES,
  CONNECTOR_CATALOGUE,
  calendarEventInputSchema,
  connectorChoice,
  hasScope,
  isEmailAddress,
  type AutomationsSettings,
  type CalendarEventProposalResult,
  type CalendarEventRecord,
  type CalendarEventResult,
  type CalendarEventSource,
  type CalendarEventState,
  type ConnectorAccount,
  type ConnectorSettings,
  type EventCandidate,
  type Meeting,
  type Task,
} from "@murmur/shared";
import { ConnectorError, type ConnectorService } from "../connector-service";
import type { AutomationsStore } from "../gmail/automations-store";
import {
  CalendarFetchError,
  GOOGLE_CALENDAR_ID,
  GOOGLE_ORIGIN,
  createGoogleEvent,
} from "./google-calendar";
import { GRAPH_ORIGIN, createOutlookEvent } from "./outlook-calendar";

/**
 * "Create event" (NT-28): a follow-up event for a task, or for a meeting, made in the owner's
 * calendar after they have read the form and clicked. It needs the connector's read-only switch
 * off and the write permission, and the people on it are told only when the setting allows it and
 * the confirmation's own box is ticked.
 */
export interface EventCreateService {
  state(): CalendarEventState;
  /** A starting form for a task or a meeting. Creates nothing. */
  propose(source: CalendarEventSource): Promise<CalendarEventProposalResult>;
  /** Creates the event the owner confirmed, and records it. */
  create(input: unknown): Promise<CalendarEventResult>;
  /** The events already made from a task or a meeting, newest first. */
  list(source: CalendarEventSource): CalendarEventRecord[];
}

export interface EventCreateDeps {
  connectors: Pick<ConnectorService, "list" | "authorizedFetch">;
  settings(): { connectors: ConnectorSettings; automations: AutomationsSettings };
  store: AutomationsStore;
  tasks: { get(id: string): Task | null };
  meetings: { get(id: string): Meeting | null };
  now(): number;
  newId(): string;
  /** Called after an event was created, so the calendar can be read again. */
  onCreated?(accountId: string): void;
}

const FIVE_MINUTES = 5 * 60_000;
const OPEN_HOSTS = new Set([
  "calendar.google.com",
  "www.google.com",
  "outlook.office.com",
  "outlook.office365.com",
  "outlook.live.com",
]);

/** Whether an address is one the owner's calendar service gave for an event, safe to open. */
export function isCalendarOpenUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && OPEN_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** `YYYY-MM-DD` at 09:00 here, or null when it is not a date. */
function morningOf(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 9, 0).getTime();
  return Number.isNaN(at) ? null : at;
}

const tomorrowMorning = (now: number): number => {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 9, 0).getTime();
};

const oneLine = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

export function createEventCreateService(deps: EventCreateDeps): EventCreateService {
  const calendars = (): ConnectorAccount[] =>
    deps.connectors
      .list()
      .filter((account) =>
        (CALENDAR_CONNECTOR_IDS as readonly string[]).includes(account.connector),
      );

  const readOnly = (connector: string): boolean => {
    const entry = CONNECTOR_CATALOGUE.find((candidate) => candidate.id === connector);
    return entry ? connectorChoice(deps.settings().connectors, entry).readOnly : true;
  };

  const connected = () => calendars().filter((account) => account.status === "connected");
  const writable = () => connected().filter((account) => !readOnly(account.connector));
  /** The accounts an event can be made in: connected, not read only, and with the permission. */
  const usable = () =>
    writable().filter((account) => {
      const scope = CALENDAR_WRITE_SCOPES[account.connector];
      return scope !== undefined && hasScope(account.scopes, scope);
    });

  const state = (): CalendarEventState => {
    if (calendars().length === 0)
      return { available: false, reason: "Connect a calendar on the Connectors page first." };
    if (connected().length === 0)
      return { available: false, reason: "Your calendar needs to be connected again." };
    if (writable().length === 0)
      return {
        available: false,
        reason:
          "Your calendars are set to read only. Turn that off on the Connectors page to create events.",
      };
    if (usable().length === 0)
      return {
        available: false,
        reason:
          "Murmur does not have permission to create events yet. Give it on the Connectors page.",
      };
    return { available: true, reason: null };
  };

  const resolve = (
    source: CalendarEventSource,
  ): { task: Task | null; meeting: Meeting | null } | null => {
    if (source.kind === "task") {
      const task = deps.tasks.get(source.id);
      if (!task) return null;
      return { task, meeting: task.meetingId ? deps.meetings.get(task.meetingId) : null };
    }
    const meeting = deps.meetings.get(source.id);
    return meeting ? { task: null, meeting } : null;
  };

  const gone = (source: CalendarEventSource) =>
    source.kind === "task" ? "That task is gone." : "That meeting is gone.";

  return {
    state,

    async propose(source) {
      const current = state();
      if (!current.available)
        return { ok: false, message: current.reason ?? "Creating events is not available." };
      const account = usable()[0]!;
      const found = resolve(source);
      if (!found) return { ok: false, message: gone(source) };
      const { task, meeting } = found;
      const settings = deps.settings();

      // A task with a due day is proposed that morning; otherwise (or when it has passed) tomorrow.
      const due = task?.dueOn ? morningOf(task.dueOn) : null;
      const startMs = due !== null && due > deps.now() ? due : tomorrowMorning(deps.now());

      const mine = new Set(calendars().map((entry) => entry.email.toLowerCase()));
      const candidates: EventCandidate[] = (meeting?.attendees ?? [])
        .filter((person) => !mine.has(person.email.toLowerCase()))
        .map((person) => ({ name: person.name, email: person.email }));

      const where = meeting ? `From the meeting “${oneLine(meeting.title, 120)}”` : "";
      const description = [task?.notes.trim() ?? "", where].filter(Boolean).join("\n\n");
      return {
        ok: true,
        proposal: {
          title: oneLine(task ? task.title : `Follow-up: ${meeting?.title ?? ""}`, 200),
          startMs,
          durationMinutes: settings.automations.createEvent.defaultDuration,
          candidates,
          description,
          accountId: account.id,
          accountEmail: account.email,
          connector: account.connector,
          invitesAllowed: settings.automations.createEvent.sendInvites,
        },
      };
    },

    async create(raw) {
      const parsed = calendarEventInputSchema.safeParse(raw);
      if (!parsed.success)
        return {
          ok: false,
          message: "An event needs a title, a start and a length, within the limits.",
        };
      const input = parsed.data;
      const current = state();
      if (!current.available)
        return { ok: false, message: current.reason ?? "Creating events is not available." };
      const account = usable().find((entry) => entry.id === input.accountId);
      if (!account) return { ok: false, message: "That calendar cannot get events now." };
      if (input.startMs < deps.now() - FIVE_MINUTES)
        return { ok: false, message: "Choose a start that is not in the past." };
      const attendees = [...new Set(input.attendees.map((email) => email.toLowerCase()))];
      if (!attendees.every(isEmailAddress))
        return { ok: false, message: "Each person to invite needs one email address." };
      if (!resolve(input.source)) return { ok: false, message: gone(input.source) };

      // Invitations go out only when the setting allows them and this confirmation says so.
      const invite =
        deps.settings().automations.createEvent.sendInvites &&
        input.sendInvites &&
        attendees.length > 0;
      const origin = account.connector === GOOGLE_CALENDAR_ID ? GOOGLE_ORIGIN : GRAPH_ORIGIN;
      try {
        const make =
          account.connector === GOOGLE_CALENDAR_ID ? createGoogleEvent : createOutlookEvent;
        const made = await make({
          fetch: (url, init) => {
            // The token only ever goes to the calendar's own address.
            if (new URL(url).origin !== origin)
              throw new CalendarFetchError("Refused a request to another address.");
            return deps.connectors.authorizedFetch(account.id, url, init);
          },
          title: input.title,
          startMs: input.startMs,
          endMs: input.startMs + input.durationMinutes * 60_000,
          description: input.description,
          attendees,
          invite,
        });
        const record = deps.store.addCalendarEvent({
          id: deps.newId(),
          accountId: account.id,
          sourceKind: input.source.kind,
          sourceId: input.source.id,
          title: input.title,
          startMs: input.startMs,
          eventId: made.eventId,
          openUrl: made.openUrl,
          at: deps.now(),
        });
        deps.onCreated?.(account.id);
        return {
          ok: true,
          automationId: record.id,
          eventId: made.eventId,
          openUrl: made.openUrl,
          invited: invite,
        };
      } catch (error) {
        if (error instanceof CalendarFetchError || error instanceof ConnectorError)
          return { ok: false, message: error.message };
        return { ok: false, message: "Murmur could not reach the calendar. Nothing was created." };
      }
    },

    list: (source) => deps.store.listCalendarEvents(source),
  };
}
