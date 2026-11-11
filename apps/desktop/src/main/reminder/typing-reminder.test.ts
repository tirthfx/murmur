import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SOUNDS, type Settings } from "@murmur/shared";
import { createTypingReminder, tomorrowMorning } from "./typing-reminder";

function setup() {
  let settings = {
    sounds: DEFAULT_SOUNDS,
    typingReminder: { enabled: true, snoozedUntil: null as number | null },
  } as unknown as Settings;
  const state = { now: 1_000_000, dictating: false };
  const nudge = vi.fn();
  const reminder = createTypingReminder({
    settings: () => settings,
    update: (typingReminder) => {
      settings = { ...settings, typingReminder };
    },
    isDictating: () => state.dictating,
    now: () => state.now,
    nudge,
    holdLabel: () => "Right Option",
  });
  return { reminder, state, nudge, settings: () => settings };
}

describe("typing reminder", () => {
  it("nudges once more than 60 words are typed within two minutes", () => {
    const { reminder, state, nudge } = setup();
    reminder.record(30);
    state.now += 30_000;
    reminder.record(30);
    expect(nudge).not.toHaveBeenCalled();
    state.now += 30_000;
    reminder.record(5);
    expect(nudge).toHaveBeenCalledWith("Dictate instead? Hold Right Option.");
  });

  it("forgets words older than two minutes", () => {
    const { reminder, state, nudge } = setup();
    reminder.record(50);
    state.now += 125_000;
    reminder.record(20);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("nudges at most once an hour", () => {
    const { reminder, state, nudge } = setup();
    reminder.record(70);
    state.now += 30 * 60_000;
    reminder.record(70);
    expect(nudge).toHaveBeenCalledTimes(1);
    state.now += 31 * 60_000;
    reminder.record(70);
    expect(nudge).toHaveBeenCalledTimes(2);
  });

  it("never nudges during a dictation", () => {
    const { reminder, state, nudge } = setup();
    state.dictating = true;
    reminder.record(100);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("snoozes for an hour, until tomorrow at nine, or turns off and on", () => {
    const { reminder, state, nudge, settings } = setup();
    reminder.snooze("hour");
    expect(settings().typingReminder.snoozedUntil).toBe(state.now + 3_600_000);
    reminder.record(100);
    expect(nudge).not.toHaveBeenCalled();
    expect(reminder.isActive()).toBe(false);
    state.now += 3_600_000;
    expect(reminder.isActive()).toBe(true);
    reminder.snooze("tomorrow");
    expect(settings().typingReminder.snoozedUntil).toBe(tomorrowMorning(state.now));
    reminder.snooze("off");
    expect(settings().typingReminder.enabled).toBe(false);
    reminder.snooze("on");
    expect(settings().typingReminder).toEqual({ enabled: true, snoozedUntil: null });
  });

  it("puts tomorrow at 09:00 local time", () => {
    const at = new Date(2026, 10, 11, 22, 30).getTime();
    const next = new Date(tomorrowMorning(at));
    expect([next.getDate(), next.getHours(), next.getMinutes()]).toEqual([12, 9, 0]);
  });
});
