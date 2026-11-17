import { describe, expect, it, vi } from "vitest";
import { FOCUS_LIMITS, FOCUS_MESSAGES, type FocusDuration, type FocusRule } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createTestLogger, FakeClock } from "../helper/fakes";
import { BACK_WAIT_MS, createFocusController } from "./focus-controller";
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
  const pressBack = vi.fn(async () => true);
  const focus = createFocusController({
    rules: (): FocusRule[] => store.all(),
    sessions: store,
    enabled: () => enabled,
    lastDuration: () => duration,
    saveDuration: (value) => (duration = value),
    watchFrontApp,
    overlay,
    say,
    activateApp,
    pressBack,
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
    pressBack,
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

  describe("sites", () => {
    const chrome = (host: string | null, path = "/") => ({
      bundleId: "com.google.Chrome",
      name: "Google Chrome",
      pid: 4,
      site: host ? { host, path } : null,
      siteStatus: "ok" as const,
    });

    it("covers a blocked site and its subdomains, and hides it on another site", () => {
      const { focus, overlay, store } = setup();
      store.addSite("example.com");
      focus.start(25);
      focus.frontApp(chrome("news.example.com", "/today"));
      expect(overlay.show).toHaveBeenCalledWith("example.com");
      focus.frontApp(chrome("www.example.com", "/other"));
      expect(overlay.show).toHaveBeenCalledTimes(1);
      focus.frontApp(chrome("docs.murmur.test"));
      expect(overlay.hide).toHaveBeenCalledTimes(1);
    });

    it("blocks only under a path when the entry has one", () => {
      const { focus, overlay, store } = setup();
      store.addSite("youtube.com/shorts");
      focus.start(25);
      focus.frontApp(chrome("www.youtube.com", "/watch"));
      expect(overlay.show).not.toHaveBeenCalled();
      focus.frontApp(chrome("www.youtube.com", "/shorts/abc"));
      expect(overlay.show).toHaveBeenCalledWith("youtube.com/shorts");
    });

    it("Go back presses Back in the browser, then switches app if the page stays blocked", async () => {
      const { focus, clock, store, activateApp, pressBack } = setup();
      store.addSite("example.com");
      focus.start(25);
      focus.frontApp(notes);
      focus.frontApp(chrome("example.com"));
      const going = focus.goBack();
      await clock.advance(200);
      await going;
      expect(activateApp).toHaveBeenCalledWith("com.google.Chrome");
      expect(pressBack).toHaveBeenCalledWith("com.google.Chrome");
      await clock.advance(BACK_WAIT_MS);
      expect(activateApp).toHaveBeenLastCalledWith("com.apple.Notes");
    });

    it("Go back stays in the browser when Back left the blocked site", async () => {
      const { focus, clock, store, activateApp } = setup();
      store.addSite("example.com");
      focus.start(25);
      focus.frontApp(notes);
      focus.frontApp(chrome("example.com"));
      const going = focus.goBack();
      await clock.advance(200);
      await going;
      focus.frontApp(chrome("search.murmur.test"));
      await clock.advance(BACK_WAIT_MS);
      expect(activateApp).toHaveBeenCalledTimes(1);
    });

    it("remembers browsers whose page cannot be read, without storing them", () => {
      const { focus } = setup();
      focus.start(25);
      focus.frontApp({ ...safari, site: null, siteStatus: "unavailable" });
      focus.frontApp({ ...safari, site: null, siteStatus: "unavailable" });
      expect(focus.unavailableBrowsers()).toEqual(["Safari"]);
    });
  });
});
