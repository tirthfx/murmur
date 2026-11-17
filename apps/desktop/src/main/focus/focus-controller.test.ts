import { describe, expect, it, vi } from "vitest";
import { FOCUS_LIMITS, FOCUS_MESSAGES, type FocusDuration, type FocusRule } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createTestLogger, FakeClock } from "../helper/fakes";
import { createFocusController } from "./focus-controller";
import { createFocusStore } from "./focus-store";

const OWN_PID = 999;
const app = (bundleId: string, name: string, pid = 10) => ({ bundleId, name, pid });
const notes = app("com.apple.Notes", "Notes", 1);
const safari = app("com.apple.Safari", "Safari", 2);
const music = app("com.apple.Music", "Music", 3);

function setup(options: { enabled?: boolean; duration?: FocusDuration } = {}) {
  const db = openDatabase(":memory:");
  const clock = new FakeClock();
  const store = createFocusStore(db, () => clock.now());
  store.addApp("com.apple.Safari", "Safari");
  let enabled = options.enabled ?? true;
  let duration: FocusDuration = options.duration ?? 25;
  const overlay = { show: vi.fn(), hide: vi.fn() };
  const say = vi.fn();
  const watchFrontApp = vi.fn(async () => {});
  const activateApp = vi.fn(async () => {});
  const focus = createFocusController({
    rules: (): FocusRule[] => store.apps(),
    sessions: store,
    enabled: () => enabled,
    lastDuration: () => duration,
    saveDuration: (value) => (duration = value),
    watchFrontApp,
    overlay,
    say,
    activateApp,
    ownPid: OWN_PID,
    clock,
    logger: createTestLogger(),
  });
  const sessions = () =>
    db.prepare("SELECT planned_ms, end_reason FROM focus_sessions ORDER BY started_at").all();
  return {
    focus,
    clock,
    store,
    overlay,
    say,
    watchFrontApp,
    activateApp,
    sessions,
    disable: () => (enabled = false),
    duration: () => duration,
  };
}

describe("focus controller", () => {
  it("the shortcut starts Focus with the last duration and it ends on time", async () => {
    const { focus, clock, say, watchFrontApp, sessions } = setup({ duration: 50 });
    focus.toggle();
    expect(focus.state()).toEqual({ status: "on", endsAt: 50 * 60_000 });
    expect(watchFrontApp).toHaveBeenLastCalledWith(true);
    await clock.advance(50 * 60_000);
    expect(focus.state()).toEqual({ status: "off" });
    expect(say).toHaveBeenCalledWith(FOCUS_MESSAGES.ended);
    expect(watchFrontApp).toHaveBeenLastCalledWith(false);
    expect(sessions()).toEqual([{ planned_ms: 50 * 60_000, end_reason: "timer" }]);
  });

  it("remembers a chosen duration, and until-off has no timer", async () => {
    const { focus, clock, duration } = setup();
    focus.start("untilOff");
    expect(duration()).toBe("untilOff");
    expect(focus.state()).toEqual({ status: "on", endsAt: null });
    await clock.advance(24 * 60 * 60_000);
    expect(focus.state().status).toBe("on");
    focus.toggle();
    expect(focus.state()).toEqual({ status: "off" });
  });

  it("shows the overlay for a blocked app, hides it on switching away, not when off", () => {
    const { focus, overlay } = setup();
    focus.frontApp(safari);
    expect(overlay.show).not.toHaveBeenCalled();
    focus.start(25);
    focus.frontApp(notes);
    focus.frontApp(safari);
    expect(overlay.show).toHaveBeenCalledWith("Safari");
    // The overlay taking the front is Murmur itself: nothing changes.
    focus.frontApp(app("com.github.Electron", "Murmur", OWN_PID));
    expect(overlay.hide).not.toHaveBeenCalled();
    focus.frontApp(music);
    expect(overlay.hide).toHaveBeenCalledTimes(1);
  });

  it("Go back activates the app used before the blocked one", async () => {
    const { focus, activateApp } = setup();
    focus.start(25);
    focus.frontApp(notes);
    focus.frontApp(safari);
    await focus.goBack();
    expect(activateApp).toHaveBeenCalledWith("com.apple.Notes");
  });

  it("Go back falls back to the Finder when nothing came before", async () => {
    const { focus, activateApp } = setup();
    focus.start(25);
    focus.frontApp(safari);
    await focus.goBack();
    expect(activateApp).toHaveBeenCalledWith("com.apple.finder");
  });

  it("pauses for 10 minutes, logs paused, then resumes with the time left", async () => {
    const { focus, clock, overlay, sessions } = setup();
    focus.start(25);
    focus.frontApp(safari);
    await clock.advance(5 * 60_000);
    focus.pause();
    expect(overlay.hide).toHaveBeenCalled();
    expect(focus.state()).toEqual({
      status: "paused",
      resumeAt: 5 * 60_000 + FOCUS_LIMITS.pauseMs,
      remainingMs: 20 * 60_000,
    });
    focus.frontApp(safari);
    expect(overlay.show).toHaveBeenCalledTimes(1);
    await clock.advance(FOCUS_LIMITS.pauseMs);
    expect(focus.state()).toEqual({ status: "on", endsAt: 15 * 60_000 + 20 * 60_000 });
    expect(sessions()).toEqual([
      { planned_ms: 25 * 60_000, end_reason: "paused" },
      { planned_ms: 20 * 60_000, end_reason: null },
    ]);
  });

  it("logs quit for an open session", () => {
    const { focus, sessions } = setup();
    focus.start(90);
    focus.quit();
    expect(sessions()).toEqual([{ planned_ms: 90 * 60_000, end_reason: "quit" }]);
  });

  it("does nothing while Focus Mode is off in Experimental, and stops when it is turned off", () => {
    const off = setup({ enabled: false });
    off.focus.toggle();
    expect(off.focus.state()).toEqual({ status: "off" });

    const on = setup();
    on.focus.start(25);
    on.disable();
    on.focus.refresh();
    expect(on.focus.state()).toEqual({ status: "off" });
    expect(on.sessions()).toEqual([{ planned_ms: 25 * 60_000, end_reason: "user" }]);
  });

  it("hides the overlay when the blocked app is removed from the list", () => {
    const { focus, overlay, store } = setup();
    focus.start(25);
    focus.frontApp(safari);
    store.remove(store.apps()[0]!.id);
    focus.refresh();
    expect(overlay.hide).toHaveBeenCalled();
  });
});
