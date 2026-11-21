import type { CalendarEvent } from "@murmur/shared";

const MIN = 60_000;

/** An event that began no more than this long ago still counts as the one that is next. */
export const STARTED_GRACE_MS = 5 * MIN;
/** The menu bar shows only the name from this close to the start (NT-29). */
export const NAME_ONLY_MS = 10 * MIN;
export const TITLE_MAX = 24;

/** Events worth a reminder or a place in the menu bar: not all-day, and not declined when asked. */
export function usable(event: CalendarEvent, skipDeclined: boolean): boolean {
  return !event.allDay && !(skipDeclined && event.response === "declined");
}

/**
 * The next meeting (NT-29): the earliest usable event that has not started more than five
 * minutes ago and starts within the look-ahead. `events` may be in any order.
 */
export function nextMeeting(
  events: readonly CalendarEvent[],
  now: number,
  options: { lookaheadHours: number; skipDeclined: boolean },
): CalendarEvent | null {
  const limit = now + options.lookaheadHours * 60 * MIN;
  let best: CalendarEvent | null = null;
  for (const event of events) {
    if (!usable(event, options.skipDeclined)) continue;
    if (event.startMs < now - STARTED_GRACE_MS || event.startMs > limit) continue;
    if (best === null || event.startMs < best.startMs) best = event;
  }
  return best;
}

/** "in 12 min", "in 1 h 5 min", "now". */
export function untilText(startMs: number, now: number): string {
  const minutes = Math.ceil((startMs - now) / MIN);
  if (minutes <= 0) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${hours} h` : `in ${hours} h ${rest} min`;
}

export function truncateTitle(title: string): string {
  return title.length <= TITLE_MAX ? title : `${title.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

/**
 * The text next to the menu bar icon: "Design sync in 12 min", or just the name from ten minutes
 * before the start, with long titles cut at 24 characters.
 */
export function menuBarText(event: CalendarEvent, now: number): string {
  const name = truncateTitle(event.title);
  return event.startMs - now < NAME_ONLY_MS ? name : `${name} ${untilText(event.startMs, now)}`;
}

/** The hosts of a call link, lower case; null when it is not an address. */
export function linkHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The calendar event a detected call belongs to: an event on now (from ten minutes before its
 * start to its end) whose call link is on one of the app's hosts. When several fit, the one
 * that started most recently.
 */
export function eventForCall(
  events: readonly CalendarEvent[],
  now: number,
  hosts: readonly string[],
  skipDeclined: boolean,
): CalendarEvent | null {
  let best: CalendarEvent | null = null;
  for (const event of events) {
    if (!usable(event, skipDeclined)) continue;
    if (now < event.startMs - NAME_ONLY_MS || now >= event.endMs) continue;
    const host = linkHost(event.joinUrl);
    if (host === null || !hosts.some((wanted) => host === wanted || host.endsWith(`.${wanted}`)))
      continue;
    if (best === null || event.startMs > best.startMs) best = event;
  }
  return best;
}
