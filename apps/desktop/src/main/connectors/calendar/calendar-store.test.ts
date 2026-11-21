import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@murmur/shared";
import { openDatabase } from "../../db/database";
import { createConnectorStore } from "../connector-store";
import { createCalendarStore } from "./calendar-store";

type Input = Omit<CalendarEvent, "accountId" | "connector">;
const HOUR = 3_600_000;

const event = (id: string, startMs: number, over: Partial<Input> = {}): Input => ({
  id,
  title: `Event ${id}`,
  startMs,
  endMs: startMs + HOUR,
  allDay: false,
  location: null,
  attendees: [
    { name: "Dana", email: "dana@example.com", response: "accepted", self: false, organizer: true },
  ],
  joinUrl: null,
  response: "accepted",
  isPrivate: false,
  ...over,
});

function setup() {
  const db = openDatabase(":memory:");
  const connectors = createConnectorStore(db);
  const calendar = createCalendarStore(db);
  for (const [id, email, connector] of [
    ["a1", "a@example.com", "googleCalendar"],
    ["a2", "b@example.com", "outlookCalendar"],
  ] as const)
    connectors.upsertAccount({ id, connector, email, scopes: [], at: 1 });
  return { db, connectors, calendar };
}

const WINDOW = { from: 0, to: 100 * HOUR };

describe("calendar events store (CN-02, CN-03)", () => {
  it("keeps the events of a window and lists them in order with their account and attendees", () => {
    const t = setup();
    expect(
      t.calendar.replaceWindow("a1", WINDOW, [
        event("b", 5 * HOUR),
        event("a", 2 * HOUR, { joinUrl: "https://meet.example/x" }),
      ]),
    ).toBe(2);
    const list = t.calendar.list({ from: 0, to: 10 * HOUR });
    expect(list.map((e) => [e.id, e.connector, e.accountId])).toEqual([
      ["a", "googleCalendar", "a1"],
      ["b", "googleCalendar", "a1"],
    ]);
    expect(list[0]).toMatchObject({
      joinUrl: "https://meet.example/x",
      attendees: [expect.objectContaining({ email: "dana@example.com", organizer: true })],
    });
  });

  it("a sync makes the window exactly what the provider says: moved, changed and gone events", () => {
    const t = setup();
    t.calendar.replaceWindow("a1", WINDOW, [
      event("keep", 2 * HOUR),
      event("move", 3 * HOUR),
      event("gone", 4 * HOUR),
    ]);
    t.calendar.replaceWindow("a1", WINDOW, [
      event("keep", 2 * HOUR, { title: "Renamed" }),
      event("move", 8 * HOUR),
    ]);
    const list = t.calendar.list({ from: 0, to: 100 * HOUR });
    expect(list.map((e) => [e.id, e.title, e.startMs / HOUR])).toEqual([
      ["keep", "Renamed", 2],
      ["move", "Event move", 8],
    ]);
  });

  it("leaves other accounts and events outside the window alone", () => {
    const t = setup();
    t.calendar.replaceWindow("a1", { from: 0, to: 10 * HOUR }, [event("early", HOUR)]);
    t.calendar.replaceWindow("a1", { from: 20 * HOUR, to: 30 * HOUR }, [event("late", 25 * HOUR)]);
    t.calendar.replaceWindow("a2", WINDOW, [event("other", HOUR)]);
    // A sync of the later window does not touch the earlier one.
    t.calendar.replaceWindow("a1", { from: 20 * HOUR, to: 30 * HOUR }, []);
    expect(t.calendar.list(WINDOW).map((e) => e.id)).toEqual(["early", "other"]);
    expect(t.calendar.count("a1")).toBe(1);
    expect(t.calendar.count("a2")).toBe(1);
  });

  it("finds events that overlap a range, and leaves out declined ones unless asked for", () => {
    const t = setup();
    t.calendar.replaceWindow("a1", WINDOW, [
      event("long", 0, { endMs: 10 * HOUR }),
      event("later", 12 * HOUR),
      event("no", 3 * HOUR, { response: "declined" }),
    ]);
    expect(t.calendar.list({ from: 5 * HOUR, to: 6 * HOUR }).map((e) => e.id)).toEqual(["long"]);
    expect(
      t.calendar.list({ from: 2 * HOUR, to: 13 * HOUR, includeDeclined: true }).map((e) => e.id),
    ).toEqual(["long", "no", "later"]);
    expect(t.calendar.list({ from: 2 * HOUR, to: 13 * HOUR }).map((e) => e.id)).toEqual([
      "long",
      "later",
    ]);
  });

  it("lists only the events of accounts that are connected", () => {
    const t = setup();
    t.calendar.replaceWindow("a1", WINDOW, [event("one", HOUR)]);
    t.calendar.replaceWindow("a2", WINDOW, [event("two", HOUR)]);
    t.connectors.setStatus("a1", "needs_attention", "Gone.");
    expect(t.calendar.list(WINDOW).map((e) => e.id)).toEqual(["two"]);
    t.connectors.setStatus("a2", "disabled", null);
    expect(t.calendar.list(WINDOW)).toEqual([]);
  });

  it("deletes an account's events with the account, and no one else's", () => {
    const t = setup();
    t.calendar.replaceWindow("a1", WINDOW, [event("one", HOUR)]);
    t.calendar.replaceWindow("a2", WINDOW, [event("two", HOUR)]);
    t.connectors.remove("a1");
    expect(t.calendar.count("a1")).toBe(0);
    expect(t.calendar.count("a2")).toBe(1);
  });

  it("keeps the old events when a sync fails half way", () => {
    const t = setup();
    t.calendar.replaceWindow("a1", WINDOW, [event("old", HOUR)]);
    const bad = {
      ...event("bad", 2 * HOUR),
      attendees: {
        toJSON: () => {
          throw new Error("boom");
        },
      },
    } as unknown as Input;
    expect(() => t.calendar.replaceWindow("a1", WINDOW, [event("new", 3 * HOUR), bad])).toThrow(
      "boom",
    );
    expect(t.calendar.list(WINDOW).map((e) => e.id)).toEqual(["old"]);
  });
});
