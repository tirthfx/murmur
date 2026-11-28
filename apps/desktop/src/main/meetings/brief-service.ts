import type {
  BriefEvent,
  BriefOverview,
  BriefResult,
  BriefSettings,
  CalendarEvent,
  ConnectorAccount,
  Meeting,
  MeetingBrief,
} from "@murmur/shared";
import { CALENDAR_CONNECTOR_IDS } from "@murmur/shared";
import type { Logger } from "../helper/types";
import { BRIEF_KEEP_MS, eventKeyOf, type BriefBuilder } from "./brief-builder";
import type { BriefsStore } from "./briefs-store";
import { STARTED_GRACE_MS, usable } from "./calendar-upcoming";

/**
 * The Brief tab and the automatic briefs (NT-11): the meetings that are coming, a brief for each
 * built when the meeting is `leadMinutes` away (and again when asked), and what to connect for
 * the sources that are missing. One brief is built at a time, so the local model is not kept
 * busy for a dictation that is waiting.
 */
export interface BriefService {
  overview(): BriefOverview;
  get(eventKey: string): MeetingBrief | null;
  /**
   * Builds the brief of an event now, replacing the old one. The key `meeting:<id>` builds one
   * for a recorded meeting that has no calendar event, from what came before it.
   */
  build(eventKey: string): Promise<BriefResult>;
  /** Builds the briefs that are due: once a minute, and once now. */
  start(): void;
  stop(): void;
  /** Builds the briefs that are due now. */
  buildDue(): Promise<void>;
}

export const BRIEF_TICK_MS = 60_000;
/** How long a meeting that failed to build is left alone before another try. */
export const RETRY_AFTER_MS = 10 * 60_000;
const LIST_AHEAD_MS = 24 * 3_600_000;
const FIND_AHEAD_MS = 7 * 24 * 3_600_000;
const MAX_EVENTS = 10;

/** The account name in the key of a brief that has no calendar event. */
export const MEETING_BRIEF_ACCOUNT = "meeting";

/** A recorded meeting as the event its brief is built for. */
const eventOfMeeting = (meeting: Meeting): CalendarEvent => ({
  id: meeting.id,
  accountId: MEETING_BRIEF_ACCOUNT,
  connector: "",
  title: meeting.title,
  startMs: meeting.startedAt,
  endMs: meeting.startedAt + meeting.durationMs,
  allDay: false,
  location: null,
  attendees: (meeting.attendees ?? []).map((person) => ({
    name: person.name,
    email: person.email,
    response: "accepted",
    self: false,
    organizer: false,
  })),
  joinUrl: null,
  response: "accepted",
  isPrivate: false,
});

export interface BriefServiceDeps {
  calendar: {
    list(range: { from: number; to: number; includeDeclined?: boolean }): CalendarEvent[];
  };
  settings(): { brief: BriefSettings; skipDeclined: boolean };
  store: BriefsStore;
  builder: BriefBuilder;
  accounts(): ConnectorAccount[];
  /** A recorded meeting, for a brief without a calendar event. */
  meeting?(id: string): Meeting | null;
  now(): number;
  logger: Logger;
  /** Called after a brief was built, so the menu bar can look again. */
  onBuilt?(brief: MeetingBrief): void;
  setTimer?(run: () => void, ms: number): { clear(): void };
}

export function createBriefService(deps: BriefServiceDeps): BriefService {
  let timer: { clear(): void } | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const running = new Map<string, Promise<BriefResult>>();
  const attempted = new Map<string, number>();

  const upcoming = (now: number, ahead: number): CalendarEvent[] =>
    deps.calendar
      .list({ from: now - STARTED_GRACE_MS, to: now + ahead })
      .filter(
        (event) =>
          usable(event, deps.settings().skipDeclined) && event.startMs >= now - STARTED_GRACE_MS,
      )
      .sort((a, b) => a.startMs - b.startMs);

  const peopleOf = (event: CalendarEvent): string[] => {
    const mine = new Set(deps.accounts().map((account) => account.email.toLowerCase()));
    return event.attendees
      .filter((person) => !person.self && !mine.has(person.email.toLowerCase()))
      .map((person) => person.name || person.email);
  };

  function buildEvent(event: CalendarEvent): Promise<BriefResult> {
    const key = eventKeyOf(event);
    const existing = running.get(key);
    if (existing) return existing;
    // One at a time: a second request waits for the one before it.
    const flight = chain
      .then(async (): Promise<BriefResult> => {
        try {
          const brief = await deps.builder.build(event);
          deps.store.put(brief);
          deps.store.prune(deps.now() - BRIEF_KEEP_MS);
          deps.onBuilt?.(brief);
          return { ok: true, brief };
        } catch {
          deps.logger.warn(`[brief] could not build ${key}`);
          return { ok: false, message: "The brief could not be built just now." };
        }
      })
      .finally(() => running.delete(key));
    chain = flight;
    running.set(key, flight);
    return flight;
  }

  const service: BriefService = {
    overview() {
      const now = deps.now();
      const events = upcoming(now, LIST_AHEAD_MS).slice(0, MAX_EVENTS);
      const built = deps.store.builtAt(events.map(eventKeyOf));
      const settings = deps.settings().brief;
      return {
        calendarConnected: deps
          .accounts()
          .some(
            (account) =>
              account.status === "connected" &&
              (CALENDAR_CONNECTOR_IDS as readonly string[]).includes(account.connector),
          ),
        events: events.map((event): BriefEvent => ({
          eventKey: eventKeyOf(event),
          title: event.title,
          startMs: event.startMs,
          endMs: event.endMs,
          people: peopleOf(event),
          builtAt: built.get(eventKeyOf(event)) ?? null,
        })),
        sources: deps.builder.availability(),
        settings,
      };
    },

    get: (eventKey) => deps.store.get(eventKey),

    async build(eventKey) {
      if (eventKey.startsWith(`${MEETING_BRIEF_ACCOUNT}:`)) {
        const meeting = deps.meeting?.(eventKey.slice(MEETING_BRIEF_ACCOUNT.length + 1));
        if (!meeting) return { ok: false, message: "That meeting is gone." };
        return buildEvent(eventOfMeeting(meeting));
      }
      const now = deps.now();
      const event = deps.calendar
        .list({ from: now - 86_400_000, to: now + FIND_AHEAD_MS, includeDeclined: true })
        .find((candidate) => eventKeyOf(candidate) === eventKey);
      if (!event) return { ok: false, message: "That meeting is not in your calendar any more." };
      return buildEvent(event);
    },

    async buildDue() {
      const settings = deps.settings().brief;
      if (!settings.auto) return;
      const now = deps.now();
      const due = upcoming(now, settings.leadMinutes * 60_000);
      const built = deps.store.builtAt(due.map(eventKeyOf));
      for (const event of due) {
        const key = eventKeyOf(event);
        if (built.has(key)) continue;
        const last = attempted.get(key);
        if (last !== undefined && now - last < RETRY_AFTER_MS) continue;
        attempted.set(key, now);
        await buildEvent(event);
      }
    },

    start() {
      if (timer) return;
      const schedule =
        deps.setTimer ??
        ((run, ms) => {
          const handle = setInterval(run, ms);
          return { clear: () => clearInterval(handle) };
        });
      timer = schedule(() => void service.buildDue(), BRIEF_TICK_MS);
      void service.buildDue();
    },

    stop() {
      timer?.clear();
      timer = null;
    },
  };
  return service;
}
