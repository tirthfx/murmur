import { z } from "zod";
import type { CalendarAttendee, CalendarEvent, CalendarResponse } from "@murmur/shared";
import type { ConnectorProvider } from "../providers";

export const GOOGLE_CALENDAR_ID = "googleCalendar";
const API = "https://www.googleapis.com/calendar/v3";
/** The only place the account's token is sent for events. */
export const GOOGLE_ORIGIN = "https://www.googleapis.com";

/**
 * Google Calendar (CN-02): the owner's own OAuth client of type Desktop app, authorization code
 * with PKCE in the system browser. Reads only: `calendar.readonly`, with `email` to learn which
 * account signed in. `access_type=offline` and `prompt=consent` make Google give a refresh token.
 */
export const googleCalendarProvider: ConnectorProvider = {
  id: GOOGLE_CALENDAR_ID,
  name: "Google Calendar",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
  scopes: ["https://www.googleapis.com/auth/calendar.readonly", "openid", "email"],
  authorizeParams: { access_type: "offline", prompt: "consent" },
  loopbackPort: null,
  // Google's Desktop app clients have a client secret, which is not confidential but is sent.
  needsClientSecret: true,
  async accountLabel({ token, http }) {
    const response = await http("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${token.accessToken}` },
    });
    if (!response.ok) throw new Error("userinfo failed");
    const body = z.object({ email: z.string().min(3) }).parse(await response.json());
    return body.email;
  },
};

// ------------------------------------------------------------------ events

const attendeeSchema = z.object({
  email: z.string().optional(),
  displayName: z.string().optional(),
  responseStatus: z.string().optional(),
  self: z.boolean().optional(),
  organizer: z.boolean().optional(),
  resource: z.boolean().optional(),
});

const eventSchema = z.object({
  id: z.string().min(1),
  status: z.string().optional(),
  summary: z.string().optional(),
  location: z.string().optional(),
  start: z.object({ dateTime: z.string().optional(), date: z.string().optional() }).optional(),
  end: z.object({ dateTime: z.string().optional(), date: z.string().optional() }).optional(),
  attendees: z.array(attendeeSchema).optional(),
  hangoutLink: z.string().optional(),
  conferenceData: z
    .object({
      entryPoints: z
        .array(z.object({ entryPointType: z.string().optional(), uri: z.string().optional() }))
        .optional(),
    })
    .optional(),
  visibility: z.string().optional(),
  eventType: z.string().optional(),
});

const pageSchema = z.object({
  items: z.array(z.unknown()).optional(),
  nextPageToken: z.string().optional(),
});

const RESPONSES: Record<string, CalendarResponse> = {
  accepted: "accepted",
  declined: "declined",
  tentative: "tentative",
  needsAction: "none",
};

/** A day `YYYY-MM-DD` as the start of that day here (an all-day event has no time or zone). */
export function localDayStart(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  return Number.isNaN(at) ? null : at;
}

const http = (value: string | undefined) => (value && /^https?:\/\//i.test(value) ? value : null);

/**
 * One item of Google's event list as an event, or null for one that is not kept: cancelled, a
 * working-location note, or one without a usable start and end.
 */
export function googleEvent(
  item: unknown,
  accountEmail: string,
): Omit<CalendarEvent, "accountId" | "connector"> | null {
  const parsed = eventSchema.safeParse(item);
  if (!parsed.success) return null;
  const event = parsed.data;
  if (event.status === "cancelled" || event.eventType === "workingLocation") return null;

  const allDay = event.start?.date !== undefined && event.start.dateTime === undefined;
  const startMs = allDay
    ? localDayStart(event.start?.date ?? "")
    : Date.parse(event.start?.dateTime ?? "");
  const endMs = allDay
    ? localDayStart(event.end?.date ?? "")
    : Date.parse(event.end?.dateTime ?? "");
  if (startMs === null || endMs === null || Number.isNaN(startMs) || Number.isNaN(endMs))
    return null;

  const me = accountEmail.toLowerCase();
  const attendees: CalendarAttendee[] = (event.attendees ?? [])
    .filter((attendee) => attendee.email && attendee.resource !== true)
    .map((attendee) => ({
      name: attendee.displayName ?? null,
      email: attendee.email!.toLowerCase(),
      response: RESPONSES[attendee.responseStatus ?? ""] ?? "none",
      self: attendee.self === true || attendee.email!.toLowerCase() === me,
      organizer: attendee.organizer === true,
    }));
  const self = attendees.find((attendee) => attendee.self);

  const video = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video",
  );
  return {
    id: event.id,
    title: (event.summary ?? "").trim() || "(No title)",
    startMs,
    endMs: Math.max(endMs, startMs),
    allDay,
    location: event.location?.trim() || null,
    attendees,
    joinUrl: http(event.hangoutLink) ?? http(video?.uri),
    // Nobody invited: it is the owner's own event.
    response: self?.response ?? "accepted",
    isPrivate: event.visibility === "private" || event.visibility === "confidential",
  };
}

const FIELDS =
  "nextPageToken,items(id,status,summary,location,start,end,eventType,visibility,hangoutLink," +
  "conferenceData(entryPoints(entryPointType,uri)),attendees(email,displayName,responseStatus,self,organizer,resource))";

export class CalendarFetchError extends Error {}

/**
 * The events of the primary calendar from `from` to `to`, repeats expanded into their own
 * events, by start. `fetch` carries the account's token (and renews it); a failure that is not
 * the token's is a `CalendarFetchError`.
 */
export async function fetchGoogleEvents(options: {
  fetch(url: string): Promise<Response>;
  accountEmail: string;
  from: number;
  to: number;
  maxEvents: number;
}): Promise<Omit<CalendarEvent, "accountId" | "connector">[]> {
  const events: Omit<CalendarEvent, "accountId" | "connector">[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10 && events.length < options.maxEvents; page++) {
    const query = new URLSearchParams({
      timeMin: new Date(options.from).toISOString(),
      timeMax: new Date(options.to).toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      fields: FIELDS,
    });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await options.fetch(`${API}/calendars/primary/events?${query}`);
    if (!response.ok) throw new CalendarFetchError(`Google Calendar answered ${response.status}.`);
    const body = pageSchema.safeParse(await response.json().catch(() => null));
    if (!body.success)
      throw new CalendarFetchError("Google Calendar sent an answer Murmur cannot read.");
    for (const item of body.data.items ?? []) {
      const event = googleEvent(item, options.accountEmail);
      if (event) events.push(event);
    }
    pageToken = body.data.nextPageToken;
    if (!pageToken) break;
  }
  return events.slice(0, options.maxEvents);
}

// ------------------------------------------------------------------ creating an event (NT-28)

const createdSchema = z.object({ id: z.string().min(1), htmlLink: z.string().optional() });

/**
 * Creates an event in the primary calendar. `invite` decides whether the people added are told:
 * with it off they are listed on the event and nobody is notified (`sendUpdates=none`).
 */
export async function createGoogleEvent(options: {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  title: string;
  startMs: number;
  endMs: number;
  description: string;
  attendees: readonly string[];
  invite: boolean;
}): Promise<{ eventId: string; openUrl: string }> {
  const response = await options.fetch(
    `${API}/calendars/primary/events?${new URLSearchParams({
      sendUpdates: options.invite ? "all" : "none",
    })}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summary: options.title,
        description: options.description,
        start: { dateTime: new Date(options.startMs).toISOString() },
        end: { dateTime: new Date(options.endMs).toISOString() },
        ...(options.attendees.length > 0
          ? { attendees: options.attendees.map((email) => ({ email })) }
          : {}),
      }),
    },
  );
  if (response.status === 403)
    throw new CalendarFetchError(
      "Google did not allow an event to be created. Give Murmur permission to create events and try again.",
    );
  if (!response.ok) throw new CalendarFetchError(`Google Calendar answered ${response.status}.`);
  const body = createdSchema.safeParse(await response.json().catch(() => null));
  if (!body.success)
    throw new CalendarFetchError("Google Calendar sent an answer Murmur cannot read.");
  return {
    eventId: body.data.id,
    openUrl: https(body.data.htmlLink) ?? "https://calendar.google.com/calendar/",
  };
}

const https = (value: string | undefined) => (value && /^https:\/\//i.test(value) ? value : null);
