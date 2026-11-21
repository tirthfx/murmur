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
