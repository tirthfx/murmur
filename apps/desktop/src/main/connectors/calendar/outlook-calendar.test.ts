import { describe, expect, it, vi } from "vitest";
import { CalendarFetchError } from "./google-calendar";
import {
  fetchOutlookEvents,
  graphUtc,
  outlookCalendarProvider,
  outlookEvent,
} from "./outlook-calendar";

const ME = "me@work.example";

const teams = {
  id: "AAMk1",
  subject: "Customer call",
  start: { dateTime: "2026-11-21T18:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-11-21T18:30:00.0000000", timeZone: "UTC" },
  isAllDay: false,
  isCancelled: false,
  location: { displayName: "Microsoft Teams Meeting" },
  organizer: { emailAddress: { name: "Dana", address: "Dana@Work.example" } },
  attendees: [
    {
      emailAddress: { name: "Me", address: "me@work.example" },
      status: { response: "tentativelyAccepted" },
    },
    {
      emailAddress: { name: "Sam", address: "sam@work.example" },
      status: { response: "notResponded" },
    },
  ],
  onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting" },
  responseStatus: { response: "tentativelyAccepted" },
  sensitivity: "normal",
};

describe("Outlook calendar provider (CN-03)", () => {
  it("is a read-only public client with a localhost redirect and no revoke", () => {
    expect(outlookCalendarProvider).toMatchObject({
      id: "outlookCalendar",
      authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      revokeUrl: null,
      redirectHost: "localhost",
    });
    expect(outlookCalendarProvider.needsClientSecret).toBeFalsy();
    // Delegated, read-only permissions: no ReadWrite.
    expect(outlookCalendarProvider.scopes).toEqual([
      "Calendars.Read",
      "User.Read",
      "offline_access",
    ]);
  });

  it("learns the account from Graph: the mail address, else the user name", async () => {
    const label = (body: object) =>
      outlookCalendarProvider.accountLabel({
        token: { accessToken: "a", refreshToken: null, expiresIn: 1, scopes: [] },
        http: async () => Response.json(body),
      });
    expect(await label({ mail: "me@work.example", userPrincipalName: "upn@work.example" })).toBe(
      "me@work.example",
    );
    expect(await label({ mail: null, userPrincipalName: "upn@work.example" })).toBe(
      "upn@work.example",
    );
    await expect(label({ mail: null })).rejects.toThrow();
  });
});

describe("Outlook event mapping (CN-03)", () => {
  it("reads Graph's zone-less times as UTC, and accepts a mark or an offset", () => {
    expect(graphUtc("2026-11-21T18:00:00.0000000")).toBe(Date.UTC(2026, 10, 21, 18));
    expect(graphUtc("2026-11-21T18:00:00Z")).toBe(Date.UTC(2026, 10, 21, 18));
    expect(graphUtc("2026-11-21T23:30:00+05:30")).toBe(Date.UTC(2026, 10, 21, 18));
  });

  it("maps a Teams meeting: the join link, attendees with the organizer first, and the owner's answer", () => {
    expect(outlookEvent(teams, ME)).toEqual({
      id: "AAMk1",
      title: "Customer call",
      startMs: Date.UTC(2026, 10, 21, 18),
      endMs: Date.UTC(2026, 10, 21, 18, 30),
      allDay: false,
      location: "Microsoft Teams Meeting",
      attendees: [
        {
          name: "Dana",
          email: "dana@work.example",
          response: "accepted",
          self: false,
          organizer: true,
        },
        {
          name: "Me",
          email: "me@work.example",
          response: "tentative",
          self: true,
          organizer: false,
        },
        { name: "Sam", email: "sam@work.example", response: "none", self: false, organizer: false },
      ],
      joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting",
      response: "tentative",
      isPrivate: false,
    });
  });

  it("does not move an event whose own time zone is changed: the same moment starts at the same time", () => {
    const sameMoment = (zone: string) =>
      outlookEvent(
        {
          ...teams,
          start: { ...teams.start, timeZone: zone },
          end: { ...teams.end, timeZone: zone },
        },
        ME,
      )!;
    const utc = sameMoment("UTC");
    expect(sameMoment("Pacific Standard Time").startMs).toBe(utc.startMs);
    expect(sameMoment("India Standard Time").endMs).toBe(utc.endMs);
  });

  it("uses the older Skype link when there is no Teams one, and refuses a link that is not http", () => {
    expect(
      outlookEvent(
        { ...teams, onlineMeeting: null, onlineMeetingUrl: "https://join.example/x" },
        ME,
      )?.joinUrl,
    ).toBe("https://join.example/x");
    expect(
      outlookEvent({ ...teams, onlineMeeting: { joinUrl: "file:///etc/passwd" } }, ME)?.joinUrl,
    ).toBeNull();
  });

  it("maps an all-day event to whole days here", () => {
    const event = outlookEvent(
      {
        ...teams,
        isAllDay: true,
        start: { dateTime: "2026-11-23T00:00:00.0000000", timeZone: "UTC" },
        end: { dateTime: "2026-11-24T00:00:00.0000000", timeZone: "UTC" },
      },
      ME,
    );
    expect(event).toMatchObject({
      allDay: true,
      startMs: new Date(2026, 10, 23).getTime(),
      endMs: new Date(2026, 10, 24).getTime(),
    });
  });

  it("notes a declined or private event, and keeps an organizer who is not in the list", () => {
    const event = outlookEvent(
      {
        ...teams,
        sensitivity: "private",
        responseStatus: { response: "declined" },
        attendees: [],
        organizer: { emailAddress: { name: "Me", address: "me@work.example" } },
      },
      ME,
    );
    expect(event).toMatchObject({
      response: "declined",
      isPrivate: true,
      attendees: [{ email: "me@work.example", self: true, organizer: true }],
    });
  });

  it("does not keep a cancelled event or one with no time", () => {
    expect(outlookEvent({ ...teams, isCancelled: true }, ME)).toBeNull();
    expect(outlookEvent({ id: "x", subject: "?" }, ME)).toBeNull();
    expect(outlookEvent("nope", ME)).toBeNull();
    expect(outlookEvent({ ...teams, subject: null }, ME)?.title).toBe("(No title)");
  });
});

describe("fetching Outlook events (CN-03)", () => {
  const range = { from: Date.UTC(2026, 10, 20), to: Date.UTC(2026, 10, 28) };

  it("asks for the window through calendarView, with times in UTC", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ value: [teams] }),
    );
    const events = await fetchOutlookEvents({ fetch, accountEmail: ME, ...range, maxEvents: 500 });
    expect(events).toHaveLength(1);
    const [url, init] = fetch.mock.calls[0]!;
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      "https://graph.microsoft.com/v1.0/me/calendarView",
    );
    expect(parsed.searchParams.get("startDateTime")).toBe("2026-11-20T00:00:00.000Z");
    expect(parsed.searchParams.get("endDateTime")).toBe("2026-11-28T00:00:00.000Z");
    // No body text is asked for.
    expect(parsed.searchParams.get("$select")).not.toContain("body");
    expect(new Headers(init?.headers).get("prefer")).toBe('outlook.timezone="UTC"');
  });

  it("follows the next page on Graph, and refuses one that names another address", async () => {
    const next = "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=abc";
    const pages = [
      { value: [teams], "@odata.nextLink": next },
      { value: [{ ...teams, id: "AAMk2" }] },
    ];
    const fetch = vi.fn(async (_url: string) => Response.json(pages.shift()!));
    const events = await fetchOutlookEvents({ fetch, accountEmail: ME, ...range, maxEvents: 500 });
    expect(events.map((event) => event.id)).toEqual(["AAMk1", "AAMk2"]);
    expect(fetch.mock.calls[1]![0]).toBe(next);

    const evil = vi.fn(async () =>
      Response.json({ value: [teams], "@odata.nextLink": "https://evil.example/steal" }),
    );
    await expect(
      fetchOutlookEvents({ fetch: evil, accountEmail: ME, ...range, maxEvents: 500 }),
    ).rejects.toThrow(CalendarFetchError);
    expect(evil).toHaveBeenCalledTimes(1);
  });

  it("says what went wrong when Graph does not answer well", async () => {
    await expect(
      fetchOutlookEvents({
        fetch: async () => new Response("no", { status: 500 }),
        accountEmail: ME,
        ...range,
        maxEvents: 10,
      }),
    ).rejects.toThrow("Outlook answered 500.");
  });
});
