import type { BarAnswer, CalendarEvent, CalendarSettings } from "@murmur/shared";
import type { Logger } from "../helper/types";
import { untilText, usable } from "./calendar-upcoming";

const MIN = 60_000;
export const REMINDER_TICK_MS = 30_000;
/** A reminder is not shown once the meeting is this far past its start. */
const LATE_MS = 2 * MIN;

export interface CalendarReminders {
  /** Looks for an event that is due a reminder, once. */
  tick(): void;
  /** The Bar question was answered. False when it was not this one. */
  answer(answer: BarAnswer): boolean;
  start(): void;
  stop(): void;
}

/**
 * Reminders before a meeting (NT-02): at the lead time from the owner's settings, the Bar asks
 * "<title> starts in 5 min. Record?" with Record and Not now. An event is reminded once. Nothing
 * is shown while a meeting is recording or the Bar is busy (the next tick tries again until the
 * meeting has started), for an all-day event, or for a declined one when those are skipped.
 * With auto start on and an event that has no call link, a question also appears at the start,
 * since there is no call to detect.
 */
export function createCalendarReminders(deps: {
  settings(): CalendarSettings;
  /** Upcoming events from the local cache. */
  events(range: { from: number; to: number }): CalendarEvent[];
  recording(): boolean;
  /** Asks on the Bar; false when it could not (something else is on it). */
  ask(question: { message: string; detail: string }): boolean;
  /** Takes the question off the Bar. */
  hide(): void;
  /** Whether the question is still on the Bar (it closes by itself when nobody answers). */
  stillOpen(): boolean;
  /** The owner pressed Record. */
  record(event: CalendarEvent): void;
  now(): number;
  logger: Logger;
  setTimer?(run: () => void, ms: number): { clear(): void };
}): CalendarReminders {
  const done = new Set<string>();
  let asking: CalendarEvent | null = null;
  let timer: { clear(): void } | null = null;

  const key = (event: CalendarEvent, kind: "lead" | "start") =>
    `${event.accountId}|${event.id}|${event.startMs}|${kind}`;

  function ask(event: CalendarEvent, kind: "lead" | "start", now: number): void {
    const message =
      kind === "start" || event.startMs <= now
        ? `${event.title} is starting`
        : `${event.title} starts ${untilText(event.startMs, now)}`;
    const detail = new Date(event.startMs).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    if (!deps.ask({ message: `${message}. Record it?`, detail })) return;
    done.add(key(event, kind));
    asking = event;
  }

  return {
    tick() {
      const settings = deps.settings();
      const now = deps.now();
      if (asking !== null && !deps.stillOpen()) asking = null;
      if (asking !== null || deps.recording()) return;
      const lead = settings.reminderMinutes * MIN;
      const events = deps
        .events({ from: now - LATE_MS, to: now + Math.max(lead, 0) + MIN })
        .filter((event) => usable(event, settings.skipDeclined))
        .sort((a, b) => a.startMs - b.startMs);
      for (const event of events) {
        if (event.startMs < now - LATE_MS) continue;
        if (
          settings.reminderMinutes > 0 &&
          now >= event.startMs - lead &&
          now < event.startMs + LATE_MS
        ) {
          if (!done.has(key(event, "lead"))) return ask(event, "lead", now);
        }
        // No call link to detect: the question comes at the start instead.
        if (
          settings.autoStart &&
          event.joinUrl === null &&
          now >= event.startMs &&
          now < event.startMs + LATE_MS &&
          !done.has(key(event, "start")) &&
          !done.has(key(event, "lead"))
        )
          return ask(event, "start", now);
      }
      // Forget what is long past, so the set stays small.
      if (done.size > 200) done.clear();
    },

    answer(answer) {
      const event = asking;
      if (event === null) return false;
      asking = null;
      if (answer === "yes") deps.record(event);
      else deps.logger.info("calendar reminder: not recording");
      return true;
    },

    start() {
      if (timer) return;
      const set =
        deps.setTimer ??
        ((run, ms) => {
          const handle = setInterval(run, ms);
          handle.unref();
          return { clear: () => clearInterval(handle) };
        });
      timer = set(() => this.tick(), REMINDER_TICK_MS);
    },
    stop() {
      timer?.clear();
      timer = null;
      if (asking !== null) deps.hide();
      asking = null;
    },
  };
}
