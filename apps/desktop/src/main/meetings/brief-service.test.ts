import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRIEF_SETTINGS,
  type BriefSettings,
  type CalendarEvent,
  type ConnectorAccount,
  type MeetingBrief,
} from "@murmur/shared";
import { openDatabase } from "../db/database";
import { BRIEF_KEEP_MS, eventKeyOf } from "./brief-builder";
import { createBriefsStore } from "./briefs-store";
import { BRIEF_TICK_MS, RETRY_AFTER_MS, createBriefService } from "./brief-service";

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 22, 12, 0);

const event = (id: string, startMin: number, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  accountId: "cal1",
  connector: "googleCalendar",
  title: `Meeting ${id}`,
  startMs: NOW + startMin * MIN,
  endMs: NOW + (startMin + 30) * MIN,
  allDay: false,
  location: null,
  attendees: [
    {
      name: "Dana Lee",
      email: "dana@example.com",
      response: "accepted",
      self: false,
      organizer: false,
    },
    { name: "Me", email: "me@example.com", response: "accepted", self: true, organizer: false },
  ],
  joinUrl: null,
  response: "accepted",
  isPrivate: false,
  ...over,
});

const account = (
  connector: string,
  status: ConnectorAccount["status"] = "connected",
): ConnectorAccount => ({
  id: `a-${connector}`,
  connector,
  email: connector === "gmail" ? "me@example.com" : "me@x",
  scopes: [],
  status,
  statusReason: null,
  lastSyncAt: null,
  createdAt: 1,
});

function setup(
  options: {
    events?: CalendarEvent[];
    brief?: Partial<BriefSettings>;
    accounts?: ConnectorAccount[];
    fail?: boolean;
    skipDeclined?: boolean;
  } = {},
) {
  const store = createBriefsStore(openDatabase(":memory:"));
  let now = NOW;
  const built: string[] = [];
  const onBuilt: MeetingBrief[] = [];
  const timers: (() => void)[] = [];
  const events = options.events ?? [];
  const service = createBriefService({
    calendar: {
      list: ({ from, to, includeDeclined }) =>
        events.filter(
          (e) => e.endMs > from && e.startMs < to && (includeDeclined || e.response !== "declined"),
        ),
    },
    settings: () => ({
      brief: { ...DEFAULT_BRIEF_SETTINGS, ...options.brief },
      skipDeclined: options.skipDeclined ?? true,
    }),
    store,
    builder: {
      availability: () => [
        { id: "meetings", label: "Earlier meetings", state: "used", count: 0, note: null },
      ],
      build: async (e) => {
        if (options.fail) throw new Error("no model");
        built.push(eventKeyOf(e));
        return {
          eventKey: eventKeyOf(e),
          title: e.title,
          startMs: e.startMs,
          builtAt: now,
          markdown: "## Who is coming",
          sources: [],
          items: [],
          modelWrote: false,
        };
      },
    },
    accounts: () => options.accounts ?? [account("googleCalendar")],
    now: () => now,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    onBuilt: (brief) => onBuilt.push(brief),
    setTimer: (run) => {
      timers.push(run);
      return { clear: () => undefined };
    },
  });
  return { service, store, built, onBuilt, timers, advance: (ms: number) => (now += ms) };
}

describe("brief service (NT-11)", () => {
  it("lists the meetings of the next day with who is coming and whether they have a brief", () => {
    const t = setup({
      events: [
        event("b", 90),
        event("a", 20),
        event("far", 3000),
        event("all", 10, { allDay: true }),
      ],
    });
    const view = t.service.overview();
    expect(view.calendarConnected).toBe(true);
    expect(view.events.map((e) => [e.eventKey, e.people, e.builtAt])).toEqual([
      ["cal1:a", ["Dana Lee"], null],
      ["cal1:b", ["Dana Lee"], null],
    ]);
    expect(view.settings).toEqual(DEFAULT_BRIEF_SETTINGS);
    expect(view.sources[0]).toMatchObject({ id: "meetings" });
  });

  it("says no calendar is connected, and leaves out declined meetings", () => {
    const none = setup({ accounts: [account("gmail")] });
    expect(none.service.overview().calendarConnected).toBe(false);
    const needs = setup({ accounts: [account("googleCalendar", "needs_attention")] });
    expect(needs.service.overview().calendarConnected).toBe(false);
    const declined = setup({ events: [event("d", 20, { response: "declined" })] });
    expect(declined.service.overview().events).toEqual([]);
  });

  it("builds a brief on request, keeps it, and builds again on demand", async () => {
    const t = setup({ events: [event("a", 20)] });
    expect(t.service.get("cal1:a")).toBeNull();
    const first = await t.service.build("cal1:a");
    expect(first.ok && first.brief.eventKey).toBe("cal1:a");
    expect(t.service.get("cal1:a")).toMatchObject({ title: "Meeting a" });
    expect(t.service.overview().events[0]!.builtAt).toBe(NOW);
    t.advance(5 * MIN);
    await t.service.build("cal1:a");
    expect(t.built).toEqual(["cal1:a", "cal1:a"]);
    expect(t.onBuilt).toHaveLength(2);
  });

  it("says so when the meeting is not in the calendar, and when the brief could not be built", async () => {
    const t = setup({ events: [event("a", 20)] });
    expect(await t.service.build("cal1:nope")).toEqual({
      ok: false,
      message: "That meeting is not in your calendar any more.",
    });
    const failing = setup({ events: [event("a", 20)], fail: true });
    expect(await failing.service.build("cal1:a")).toEqual({
      ok: false,
      message: "The brief could not be built just now.",
    });
  });

  it("builds only one brief at a time, and a second request for the same meeting shares the first", async () => {
    const t = setup({ events: [event("a", 20)] });
    const [x, y] = await Promise.all([t.service.build("cal1:a"), t.service.build("cal1:a")]);
    expect(x).toBe(y);
    expect(t.built).toEqual(["cal1:a"]);
  });

  describe("automatic briefs", () => {
    it("builds the brief of a meeting that is within the lead time, once", async () => {
      const t = setup({ events: [event("soon", 25), event("later", 45), event("past", -2)] });
      await t.service.buildDue();
      expect(t.built).toEqual(["cal1:past", "cal1:soon"].sort());
      await t.service.buildDue();
      expect(t.built).toHaveLength(2);
    });

    it("follows the lead time the owner chose", async () => {
      const t = setup({ events: [event("a", 45)], brief: { leadMinutes: 60 } });
      await t.service.buildDue();
      expect(t.built).toEqual(["cal1:a"]);
    });

    it("builds nothing when automatic briefs are off, for declined meetings or for all-day events", async () => {
      const off = setup({ events: [event("a", 20)], brief: { auto: false } });
      await off.service.buildDue();
      expect(off.built).toEqual([]);
      const skipped = setup({
        events: [event("d", 20, { response: "declined" }), event("w", 20, { allDay: true })],
      });
      await skipped.service.buildDue();
      expect(skipped.built).toEqual([]);
    });

    it("tries again after a failure only after a while", async () => {
      const t = setup({ events: [event("a", 25)], fail: true });
      await t.service.buildDue();
      await t.service.buildDue();
      expect(t.store.get("cal1:a")).toBeNull();
      // One attempt only so far: the second call found it was tried a moment ago.
      t.advance(RETRY_AFTER_MS + MIN);
      await t.service.buildDue();
      expect(t.store.get("cal1:a")).toBeNull();
    });

    it("runs from a schedule that looks every minute, and once at the start", async () => {
      const t = setup({ events: [event("a", 20)] });
      t.service.start();
      t.service.start();
      expect(t.timers).toHaveLength(1);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(t.built).toEqual(["cal1:a"]);
      expect(BRIEF_TICK_MS).toBe(60_000);
      t.service.stop();
    });
  });

  it("drops the briefs of meetings long past when it builds", async () => {
    const t = setup({ events: [event("a", 20)] });
    t.store.put({
      eventKey: "cal1:old",
      title: "Old",
      startMs: NOW - BRIEF_KEEP_MS - MIN,
      builtAt: 1,
      markdown: "x",
      sources: [],
      items: [],
      modelWrote: false,
    });
    await t.service.build("cal1:a");
    expect(t.store.get("cal1:old")).toBeNull();
  });
});
