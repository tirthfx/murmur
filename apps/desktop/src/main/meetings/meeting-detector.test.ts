import { describe, expect, it, vi } from "vitest";
import type { DetectSettings, MeetingMatcher, RecordingState } from "@murmur/shared";
import { DEFAULT_DETECT, DEFAULT_MEETING_MATCHERS } from "@murmur/shared";
import { FakeClock } from "../helper/fakes";
import { createMeetingDetector, DEBOUNCE_MS, ENDING_MS } from "./meeting-detector";

const silent = { info() {}, warn() {}, error() {} };

function setup(
  overrides: Partial<DetectSettings> = {},
  matchers: MeetingMatcher[] = DEFAULT_MEETING_MATCHERS,
) {
  const clock = new FakeClock();
  let settings: DetectSettings = { ...DEFAULT_DETECT, ...overrides };
  let state: RecordingState = { status: "idle" };
  let shows = true;
  const recording = (): RecordingState => ({
    status: "recording",
    meetingId: "m-1",
    title: "Meeting",
    startedAt: 0,
    channels: ["mic"],
    warnings: [],
  });
  const calls = {
    showPrompt: vi.fn((_app: { id: string; name: string }) => shows),
    hidePrompt: vi.fn(),
    start: vi.fn(async () => {
      state = recording();
      return { ok: true as const, meetingId: "m-1" };
    }),
    stop: vi.fn(async () => {
      state = { status: "idle" };
    }),
    neverFor: vi.fn(),
  };
  const detector = createMeetingDetector({
    clock,
    matchers: () => matchers,
    settings: () => settings,
    recording: () => state,
    ...calls,
    logger: silent,
  });
  return {
    detector,
    clock,
    calls,
    setSettings: (next: Partial<DetectSettings>) => (settings = { ...settings, ...next }),
    setState: (next: RecordingState) => (state = next),
    barBusy: () => (shows = false),
    recordingState: recording,
    start: async (id = "zoom") => {
      detector.event({ matcherId: id, active: true });
      await clock.advance(DEBOUNCE_MS);
    },
  };
}

describe("meeting detector", () => {
  it("asks once a call has lasted the debounce, and a flicker asks nothing", async () => {
    const t = setup();
    t.detector.event({ matcherId: "zoom", active: true });
    await t.clock.advance(DEBOUNCE_MS - 1);
    t.detector.event({ matcherId: "zoom", active: false });
    await t.clock.advance(5_000);
    expect(t.calls.showPrompt).not.toHaveBeenCalled();
    await t.start();
    expect(t.calls.showPrompt).toHaveBeenCalledWith({ id: "zoom", name: "Zoom" });
    expect(t.calls.start).not.toHaveBeenCalled();
  });

  it("Record starts a recording, and it stops a minute after the call ends", async () => {
    const t = setup();
    await t.start();
    expect(t.detector.answer("yes")).toBe(true);
    await t.clock.advance(0);
    expect(t.calls.start).toHaveBeenCalledTimes(1);
    t.detector.event({ matcherId: "zoom", active: false });
    await t.clock.advance(ENDING_MS - 1);
    expect(t.calls.stop).not.toHaveBeenCalled();
    await t.clock.advance(1);
    expect(t.calls.stop).toHaveBeenCalledTimes(1);
  });

  it("a call that comes back within the minute keeps the recording", async () => {
    const t = setup();
    await t.start();
    t.detector.answer("yes");
    await t.clock.advance(0);
    t.detector.event({ matcherId: "zoom", active: false });
    await t.clock.advance(30_000);
    t.detector.event({ matcherId: "zoom", active: true });
    await t.clock.advance(ENDING_MS * 2);
    expect(t.calls.stop).not.toHaveBeenCalled();
  });

  it("Not now and a timeout ask nothing more until the call ends", async () => {
    const t = setup();
    await t.start();
    t.detector.answer("no");
    t.detector.event({ matcherId: "zoom", active: true });
    await t.clock.advance(DEBOUNCE_MS * 3);
    expect(t.calls.showPrompt).toHaveBeenCalledTimes(1);
    t.detector.event({ matcherId: "zoom", active: false });
    await t.start();
    expect(t.calls.showPrompt).toHaveBeenCalledTimes(2);
  });

  it("Never for this app stops its prompts", async () => {
    const t = setup();
    await t.start();
    t.detector.answer("never");
    expect(t.calls.neverFor).toHaveBeenCalledWith("zoom");
    t.setSettings({ neverApps: ["zoom"] });
    t.detector.event({ matcherId: "zoom", active: false });
    await t.start();
    expect(t.calls.showPrompt).toHaveBeenCalledTimes(1);
    // Another app still asks.
    await t.start("meet");
    expect(t.calls.showPrompt).toHaveBeenCalledTimes(2);
  });

  it("auto record starts without a prompt", async () => {
    const t = setup({ autoRecord: true });
    await t.start();
    expect(t.calls.showPrompt).not.toHaveBeenCalled();
    expect(t.calls.start).toHaveBeenCalledTimes(1);
  });

  it("does nothing when detection or the app is off, or a recording already runs", async () => {
    const off = setup({ enabled: false });
    await off.start();
    const appOff = setup({ apps: { zoom: false } });
    await appOff.start();
    const busy = setup();
    busy.setState(busy.recordingState());
    await busy.start();
    for (const t of [off, appOff, busy]) {
      expect(t.calls.showPrompt).not.toHaveBeenCalled();
      expect(t.calls.start).not.toHaveBeenCalled();
    }
  });

  it("closes the prompt when the call ends before an answer, and ignores unknown matchers", async () => {
    const t = setup();
    t.detector.event({ matcherId: "unknown", active: true });
    await t.clock.advance(DEBOUNCE_MS);
    expect(t.calls.showPrompt).not.toHaveBeenCalled();
    await t.start();
    t.detector.event({ matcherId: "zoom", active: false });
    expect(t.calls.hidePrompt).toHaveBeenCalledTimes(1);
    expect(t.detector.answer("yes")).toBe(false);
  });

  it("a stop by the owner during the call does not ask again for that call", async () => {
    const t = setup({ autoRecord: true });
    await t.start();
    await t.clock.advance(0);
    t.setState({ status: "idle" });
    t.detector.recordingChanged({ status: "idle" });
    t.detector.event({ matcherId: "zoom", active: true });
    await t.clock.advance(DEBOUNCE_MS * 3);
    expect(t.calls.start).toHaveBeenCalledTimes(1);
    expect(t.calls.showPrompt).not.toHaveBeenCalled();
  });

  it("asks nothing more for a call the Bar could not show a prompt for", async () => {
    const t = setup();
    t.barBusy();
    await t.start();
    expect(t.calls.showPrompt).toHaveBeenCalledTimes(1);
    expect(t.detector.answer("yes")).toBe(false);
    t.detector.event({ matcherId: "zoom", active: true });
    await t.clock.advance(DEBOUNCE_MS * 2);
    expect(t.calls.showPrompt).toHaveBeenCalledTimes(1);
  });

  it("reset forgets calls and closes the prompt", async () => {
    const t = setup();
    await t.start();
    t.detector.reset();
    expect(t.calls.hidePrompt).toHaveBeenCalledTimes(1);
    expect(t.detector.answer("yes")).toBe(false);
  });
});
