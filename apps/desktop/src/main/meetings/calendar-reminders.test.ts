import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CALENDAR_SETTINGS,
  type CalendarEvent,
  type CalendarSettings,
} from "@murmur/shared";
import { createCalendarReminders } from "./calendar-reminders";

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 21, 10, 0);

const event = (id: string, startMin: number, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  accountId: "a1",
  connector: "googleCalendar",
  title: `Meeting ${id}`,
  startMs: NOW + startMin * MIN,
  endMs: NOW + (startMin + 30) * MIN,
  allDay: false,
  location: null,
  attendees: [],
  joinUrl: "https://meet.google.com/x",
  response: "accepted",
  isPrivate: false,
  ...over,
});

function setup(events: CalendarEvent[], settings: Partial<CalendarSettings> = {}) {
  let now = NOW;
  let recording = false;
  let canAsk = true;
  let open = true;
  const asked: { message: string; detail: string }[] = [];
  const record = vi.fn();
  const hide = vi.fn();
  const timers: { run: () => void; ms: number; cleared: boolean }[] = [];
  const reminders = createCalendarReminders({
    settings: () => ({ ...DEFAULT_CALENDAR_SETTINGS, ...settings }),
    events: ({ from, to }) => events.filter((e) => e.endMs > from && e.startMs < to),
    recording: () => recording,
    ask: (question) => {
      if (!canAsk) return false;
      asked.push(question);
      return true;
    },
    hide,
    stillOpen: () => open,
    record,
    now: () => now,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    setTimer: (run, ms) => {
      const timer = { run, ms, cleared: false };
      timers.push(timer);
      return { clear: () => (timer.cleared = true) };
    },
  });
  return {
    reminders,
    asked,
    record,
    hide,
    timers,
    advance: (ms: number) => (now += ms),
    set: (over: { recording?: boolean; canAsk?: boolean; open?: boolean }) => {
      if (over.open !== undefined) open = over.open;
      if (over.recording !== undefined) recording = over.recording;
      if (over.canAsk !== undefined) canAsk = over.canAsk;
    },
  };
}

describe("meeting reminders (NT-02)", () => {
  it("asks five minutes before, with Record, and records that event when answered yes", () => {
    const e = event("a", 5);
    const t = setup([e]);
    t.reminders.tick();
    expect(t.asked).toHaveLength(1);
    expect(t.asked[0]!.message).toBe("Meeting a starts in 5 min. Record it?");
    expect(t.reminders.answer("yes")).toBe(true);
    expect(t.record).toHaveBeenCalledWith(e);
    // It is not asked again.
    t.advance(MIN);
    t.reminders.tick();
    expect(t.asked).toHaveLength(1);
  });

  it("waits for the lead time, and does nothing for an event further away", () => {
    const t = setup([event("a", 8)]);
    t.reminders.tick();
    expect(t.asked).toHaveLength(0);
    t.advance(3 * MIN);
    t.reminders.tick();
    expect(t.asked).toHaveLength(1);
  });

  it("follows the lead time in the settings, and is off at 0", () => {
    const ten = setup([event("a", 10)], { reminderMinutes: 10 });
    ten.reminders.tick();
    expect(ten.asked).toHaveLength(1);
    const off = setup([event("a", 1)], { reminderMinutes: 0 });
    off.reminders.tick();
    expect(off.asked).toHaveLength(0);
  });

  it("Not now records nothing, and the answer is only taken when a question is open", () => {
    const t = setup([event("a", 5)]);
    expect(t.reminders.answer("yes")).toBe(false);
    t.reminders.tick();
    expect(t.reminders.answer("no")).toBe(true);
    expect(t.record).not.toHaveBeenCalled();
    expect(t.reminders.answer("yes")).toBe(false);
  });

  it("gives no reminder for a declined event when those are skipped, nor for all-day events", () => {
    const t = setup([event("no", 5, { response: "declined" }), event("day", 5, { allDay: true })]);
    t.reminders.tick();
    expect(t.asked).toHaveLength(0);
    const keep = setup([event("no", 5, { response: "declined" })], { skipDeclined: false });
    keep.reminders.tick();
    expect(keep.asked).toHaveLength(1);
  });

  it("does not ask while a meeting is recording, and tries again when the Bar is free, until the meeting has started", () => {
    const t = setup([event("a", 5)]);
    t.set({ recording: true });
    t.reminders.tick();
    t.set({ recording: false, canAsk: false });
    t.reminders.tick();
    expect(t.asked).toHaveLength(0);
    t.advance(MIN);
    t.set({ canAsk: true });
    t.reminders.tick();
    expect(t.asked).toHaveLength(1);
    expect(t.asked[0]!.message).toBe("Meeting a starts in 4 min. Record it?");
    // Much later than the start: no reminder for a meeting that is over.
    const late = setup([event("b", -10)]);
    late.reminders.tick();
    expect(late.asked).toHaveLength(0);
  });

  it("asks again after a question was closed without an answer", () => {
    const t = setup([event("a", 5), event("b", 5)]);
    t.reminders.tick();
    expect(t.asked).toHaveLength(1);
    // Still open: nothing new.
    t.reminders.tick();
    expect(t.asked).toHaveLength(1);
    // The Bar closed it by itself.
    t.set({ open: false });
    t.reminders.tick();
    expect(t.asked).toHaveLength(2);
    expect(t.asked[1]!.message).toContain("Meeting b");
  });

  it("asks one event at a time, earliest first", () => {
    const t = setup([event("b", 5), event("a", 4)]);
    t.reminders.tick();
    t.reminders.tick();
    expect(t.asked).toHaveLength(1);
    expect(t.asked[0]!.message).toContain("Meeting a");
    t.reminders.answer("no");
    t.reminders.tick();
    expect(t.asked[1]!.message).toContain("Meeting b");
  });

  it("with auto start on, asks at the start for an event that has no call link to detect", () => {
    const t = setup([event("x", 0, { joinUrl: null })], { autoStart: true, reminderMinutes: 0 });
    t.reminders.tick();
    expect(t.asked[0]!.message).toBe("Meeting x is starting. Record it?");
    const withLink = setup([event("y", 0)], { autoStart: true, reminderMinutes: 0 });
    withLink.reminders.tick();
    expect(withLink.asked).toHaveLength(0);
    const off = setup([event("z", 0, { joinUrl: null })], { autoStart: false, reminderMinutes: 0 });
    off.reminders.tick();
    expect(off.asked).toHaveLength(0);
  });

  it("looks every 30 seconds while started, and takes its question back when stopped", () => {
    const t = setup([event("a", 5)]);
    t.reminders.start();
    t.reminders.start();
    expect(t.timers).toHaveLength(1);
    expect(t.timers[0]!.ms).toBe(30_000);
    t.timers[0]!.run();
    expect(t.asked).toHaveLength(1);
    t.reminders.stop();
    expect(t.timers[0]!.cleared).toBe(true);
    expect(t.hide).toHaveBeenCalled();
    expect(t.reminders.answer("yes")).toBe(false);
  });
});
