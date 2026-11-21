import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@murmur/shared";
import {
  eventForCall,
  linkHost,
  menuBarText,
  nextMeeting,
  truncateTitle,
  untilText,
} from "./calendar-upcoming";

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 21, 10, 0);

const event = (id: string, startMin: number, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  accountId: "a1",
  connector: "googleCalendar",
  title: `Event ${id}`,
  startMs: NOW + startMin * MIN,
  endMs: NOW + (startMin + 30) * MIN,
  allDay: false,
  location: null,
  attendees: [],
  joinUrl: null,
  response: "accepted",
  isPrivate: false,
  ...over,
});

const OPTIONS = { lookaheadHours: 4, skipDeclined: true };

describe("the next meeting (NT-29)", () => {
  it("is the earliest event that has not begun more than five minutes ago, within the look-ahead", () => {
    const events = [event("late", 90), event("soon", 12), event("old", -20), event("far", 600)];
    expect(nextMeeting(events, NOW, OPTIONS)?.id).toBe("soon");
    expect(nextMeeting([event("old", -20), event("far", 600)], NOW, OPTIONS)).toBeNull();
    expect(nextMeeting([event("started", -4)], NOW, OPTIONS)?.id).toBe("started");
    expect(nextMeeting([event("edge", 240)], NOW, OPTIONS)?.id).toBe("edge");
    expect(nextMeeting([event("edge", 241)], NOW, OPTIONS)).toBeNull();
    expect(nextMeeting([event("edge", 241)], NOW, { ...OPTIONS, lookaheadHours: 8 })?.id).toBe(
      "edge",
    );
  });

  it("skips all-day events, and declined ones when asked", () => {
    const events = [
      event("day", 5, { allDay: true }),
      event("no", 6, { response: "declined" }),
      event("ok", 30),
    ];
    expect(nextMeeting(events, NOW, OPTIONS)?.id).toBe("ok");
    expect(nextMeeting(events, NOW, { ...OPTIONS, skipDeclined: false })?.id).toBe("no");
  });

  it("says how long until it starts", () => {
    expect(untilText(NOW + 12 * MIN, NOW)).toBe("in 12 min");
    expect(untilText(NOW + 30_000, NOW)).toBe("in 1 min");
    expect(untilText(NOW + 60 * MIN, NOW)).toBe("in 1 h");
    expect(untilText(NOW + 65 * MIN, NOW)).toBe("in 1 h 5 min");
    expect(untilText(NOW - MIN, NOW)).toBe("now");
  });

  it("shows the name and the time until, and only the name from ten minutes before; long titles are cut at 24", () => {
    expect(menuBarText(event("a", 12, { title: "Design sync" }), NOW)).toBe(
      "Design sync in 12 min",
    );
    expect(menuBarText(event("a", 9, { title: "Design sync" }), NOW)).toBe("Design sync");
    expect(menuBarText(event("a", -2, { title: "Design sync" }), NOW)).toBe("Design sync");
    const long = "Quarterly planning with the whole leadership team";
    expect(truncateTitle(long)).toBe("Quarterly planning with…");
    expect(truncateTitle(long)).toHaveLength(24);
    expect(truncateTitle("Short")).toBe("Short");
  });
});

describe("the event of a detected call (NT-02)", () => {
  it("is an event on now whose link is on the app's host", () => {
    const meet = event("meet", -3, { joinUrl: "https://meet.google.com/abc-defg-hij" });
    const zoom = event("zoom", -3, { joinUrl: "https://acme.zoom.us/j/123" });
    expect(eventForCall([meet, zoom], NOW, ["meet.google.com"], true)?.id).toBe("meet");
    expect(eventForCall([meet, zoom], NOW, ["zoom.us"], true)?.id).toBe("zoom");
    expect(eventForCall([meet, zoom], NOW, ["teams.microsoft.com"], true)).toBeNull();
  });

  it("counts from ten minutes before the start to the end, and takes the latest start", () => {
    const link = "https://meet.google.com/x";
    expect(
      eventForCall([event("e", 9, { joinUrl: link })], NOW, ["meet.google.com"], true)?.id,
    ).toBe("e");
    expect(
      eventForCall([event("e", 11, { joinUrl: link })], NOW, ["meet.google.com"], true),
    ).toBeNull();
    expect(
      eventForCall([event("e", -31, { joinUrl: link })], NOW, ["meet.google.com"], true),
    ).toBeNull();
    const both = [
      event("early", -20, { joinUrl: link, endMs: NOW + 5 * MIN }),
      event("late", -2, { joinUrl: link }),
    ];
    expect(eventForCall(both, NOW, ["meet.google.com"], true)?.id).toBe("late");
  });

  it("ignores events with no link, all-day events, declined ones, and a host that only looks alike", () => {
    expect(eventForCall([event("a", -1)], NOW, ["meet.google.com"], true)).toBeNull();
    expect(
      eventForCall(
        [event("a", -1, { allDay: true, joinUrl: "https://meet.google.com/x" })],
        NOW,
        ["meet.google.com"],
        true,
      ),
    ).toBeNull();
    expect(
      eventForCall(
        [event("a", -1, { response: "declined", joinUrl: "https://meet.google.com/x" })],
        NOW,
        ["meet.google.com"],
        true,
      ),
    ).toBeNull();
    expect(
      eventForCall(
        [event("a", -1, { joinUrl: "https://evilmeet.google.com.attacker.example/x" })],
        NOW,
        ["meet.google.com"],
        true,
      ),
    ).toBeNull();
    expect(linkHost("nope")).toBeNull();
    expect(linkHost(null)).toBeNull();
    expect(linkHost("https://Meet.Google.com/x")).toBe("meet.google.com");
  });
});
