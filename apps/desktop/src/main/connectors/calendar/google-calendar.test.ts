import { describe, expect, it, vi } from "vitest";
import {
  CalendarFetchError,
  fetchGoogleEvents,
  googleCalendarProvider,
  googleEvent,
  localDayStart,
} from "./google-calendar";

const ME = "me@example.com";

const meeting = {
  id: "evt1",
  status: "confirmed",
  summary: "Launch sync",
  location: "Room 4",
  start: { dateTime: "2026-11-21T15:30:00+05:30", timeZone: "Asia/Kolkata" },
  end: { dateTime: "2026-11-21T16:00:00+05:30" },
  hangoutLink: "https://meet.google.com/abc-defg-hij",
  visibility: "default",
  attendees: [
    { email: "Dana@Example.com", displayName: "Dana", responseStatus: "accepted", organizer: true },
    { email: "me@example.com", responseStatus: "tentative", self: true },
    { email: "room-4@resource.calendar.google.com", resource: true, responseStatus: "accepted" },
    { email: "sam@example.com", displayName: "Sam", responseStatus: "needsAction" },
  ],
};

describe("Google Calendar provider (CN-02)", () => {
  it("is a read-only OAuth client with a refresh token and a secret", () => {
    expect(googleCalendarProvider).toMatchObject({
      id: "googleCalendar",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      revokeUrl: "https://oauth2.googleapis.com/revoke",
      authorizeParams: { access_type: "offline", prompt: "consent" },
      needsClientSecret: true,
    });
    // Reading only: no write scope is asked for.
    expect(googleCalendarProvider.scopes).toEqual([
      "https://www.googleapis.com/auth/calendar.readonly",
      "openid",
      "email",
    ]);
  });

  it("learns the account's email from Google", async () => {
    const http = vi.fn(async () => Response.json({ email: "me@example.com", sub: "1" }));
    const label = await googleCalendarProvider.accountLabel({
      token: { accessToken: "a", refreshToken: null, expiresIn: 1, scopes: [] },
      http,
    });
    expect(label).toBe("me@example.com");
    expect(http).toHaveBeenCalledWith("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: "Bearer a" },
    });
    await expect(
      googleCalendarProvider.accountLabel({
        token: { accessToken: "a", refreshToken: null, expiresIn: 1, scopes: [] },
        http: async () => new Response("no", { status: 401 }),
      }),
    ).rejects.toThrow();
  });
});

describe("Google event mapping (CN-02)", () => {
  it("maps a timed event: UTC times, attendees, the meeting link, and the owner's answer", () => {
    expect(googleEvent(meeting, ME)).toEqual({
      id: "evt1",
      title: "Launch sync",
      // 15:30 in India (+05:30) is 10:00 UTC.
      startMs: Date.UTC(2026, 10, 21, 10, 0),
      endMs: Date.UTC(2026, 10, 21, 10, 30),
      allDay: false,
      location: "Room 4",
      attendees: [
        {
          name: "Dana",
          email: "dana@example.com",
          response: "accepted",
          self: false,
          organizer: true,
        },
        {
          name: null,
          email: "me@example.com",
          response: "tentative",
          self: true,
          organizer: false,
        },
        { name: "Sam", email: "sam@example.com", response: "none", self: false, organizer: false },
      ],
      joinUrl: "https://meet.google.com/abc-defg-hij",
      response: "tentative",
      isPrivate: false,
    });
  });

  it("finds the call link in the conference data when there is no Meet link", () => {
    const event = googleEvent(
      {
        ...meeting,
        hangoutLink: undefined,
        conferenceData: {
          entryPoints: [
            { entryPointType: "phone", uri: "tel:+1555" },
            { entryPointType: "video", uri: "https://zoom.us/j/123" },
          ],
        },
      },
      ME,
    );
    expect(event?.joinUrl).toBe("https://zoom.us/j/123");
    expect(googleEvent({ ...meeting, hangoutLink: "javascript:alert(1)" }, ME)?.joinUrl).toBeNull();
  });

  it("maps an all-day event to whole days here, and an event nobody was invited to as accepted", () => {
    const event = googleEvent(
      { id: "d", summary: "Offsite", start: { date: "2026-11-23" }, end: { date: "2026-11-25" } },
      ME,
    );
    expect(event).toMatchObject({
      allDay: true,
      startMs: new Date(2026, 10, 23).getTime(),
      endMs: new Date(2026, 10, 25).getTime(),
      attendees: [],
      response: "accepted",
      joinUrl: null,
    });
    expect(localDayStart("2026-11-23")).toBe(new Date(2026, 10, 23).getTime());
    expect(localDayStart("23 Nov")).toBeNull();
  });

  it("notes a declined event and a private one, and names an event with no title", () => {
    const declined = googleEvent(
      {
        ...meeting,
        visibility: "private",
        summary: "  ",
        attendees: [{ email: ME, self: true, responseStatus: "declined" }],
      },
      ME,
    );
    expect(declined).toMatchObject({ response: "declined", isPrivate: true, title: "(No title)" });
  });

  it("does not keep a cancelled event, a working-location note, or one with no time", () => {
    expect(googleEvent({ ...meeting, status: "cancelled" }, ME)).toBeNull();
    expect(googleEvent({ ...meeting, eventType: "workingLocation" }, ME)).toBeNull();
    expect(googleEvent({ id: "x", summary: "?" }, ME)).toBeNull();
    expect(
      googleEvent({ id: "x", start: { dateTime: "nope" }, end: { dateTime: "nope" } }, ME),
    ).toBeNull();
    expect(googleEvent("not an event", ME)).toBeNull();
  });
});

describe("fetching Google events (CN-02)", () => {
  const range = { from: Date.UTC(2026, 10, 20), to: Date.UTC(2026, 10, 28) };

  it("asks for the window, with repeats expanded, in order, and only the fields it needs", async () => {
    const fetch = vi.fn(async (_url: string) => Response.json({ items: [meeting] }));
    const events = await fetchGoogleEvents({ fetch, accountEmail: ME, ...range, maxEvents: 500 });
    expect(events).toHaveLength(1);
    const url = new URL(fetch.mock.calls[0]![0] as string);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      timeMin: "2026-11-20T00:00:00.000Z",
      timeMax: "2026-11-28T00:00:00.000Z",
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    // Not the description or the attachments.
    expect(url.searchParams.get("fields")).not.toContain("description");
    expect(url.searchParams.get("fields")).not.toContain("attachments");
  });

  it("follows the pages, and stops at the most it keeps", async () => {
    const pages = [
      { items: [meeting], nextPageToken: "p2" },
      { items: [{ ...meeting, id: "evt2" }] },
    ];
    const fetch = vi.fn(async (_url: string) => Response.json(pages.shift()!));
    const events = await fetchGoogleEvents({ fetch, accountEmail: ME, ...range, maxEvents: 500 });
    expect(events.map((event) => event.id)).toEqual(["evt1", "evt2"]);
    expect(new URL(fetch.mock.calls[1]![0] as string).searchParams.get("pageToken")).toBe("p2");

    const many = vi.fn(async () =>
      Response.json({
        items: Array.from({ length: 250 }, (_, i) => ({ ...meeting, id: `e${i}` })),
        nextPageToken: "more",
      }),
    );
    const capped = await fetchGoogleEvents({
      fetch: many,
      accountEmail: ME,
      ...range,
      maxEvents: 300,
    });
    expect(capped).toHaveLength(300);
    expect(many).toHaveBeenCalledTimes(2);
  });

  it("says what went wrong when Google does not answer well", async () => {
    await expect(
      fetchGoogleEvents({
        fetch: async () => new Response("no", { status: 503 }),
        accountEmail: ME,
        ...range,
        maxEvents: 10,
      }),
    ).rejects.toThrow(new CalendarFetchError("Google Calendar answered 503."));
    await expect(
      fetchGoogleEvents({
        fetch: async () => new Response("<html>", { status: 200 }),
        accountEmail: ME,
        ...range,
        maxEvents: 10,
      }),
    ).rejects.toThrow("cannot read");
  });
});
