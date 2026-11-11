import { describe, expect, it } from "vitest";
import { DOUBLE_TAP_MS, DictationGesture, TAP_MAX_MS, type GestureCommand } from "./gesture";
import { FakeClock } from "./helper/fakes";

function setup() {
  const clock = new FakeClock();
  const commands: GestureCommand[] = [];
  const gesture = new DictationGesture(clock, (command) => commands.push(command));
  return { clock, commands, gesture };
}

describe("dictation gesture", () => {
  it("hold to talk: start on press, stop on a long release", () => {
    const { gesture, commands } = setup();
    gesture.holdDown(0);
    gesture.holdUp(2_000);
    expect(commands).toEqual(["start", "stop"]);
    expect(gesture.recording).toBe(false);
  });

  it("double tap then release keeps recording, locked", () => {
    const { gesture, commands } = setup();
    gesture.holdDown(0);
    gesture.holdUp(120);
    gesture.holdDown(250);
    gesture.holdUp(330);
    expect(commands).toEqual(["start", "lock"]);
    expect(gesture.locked).toBe(true);
  });

  it("while locked, the next tap stops once and its release does nothing", () => {
    const { gesture, commands } = setup();
    gesture.holdDown(0);
    gesture.holdUp(100);
    gesture.holdDown(200);
    gesture.holdUp(260);
    gesture.holdDown(9_000);
    gesture.holdUp(9_080);
    expect(commands).toEqual(["start", "lock", "stop"]);
    expect(gesture.recording).toBe(false);
  });

  it("a double tap to stop hands-free stops once and starts nothing", () => {
    const { gesture, commands } = setup();
    gesture.holdDown(0);
    gesture.holdUp(80);
    gesture.holdDown(170);
    gesture.holdUp(260);
    // Locked; now the user double-taps to stop, as seen in the owner's test.
    gesture.holdDown(5_000);
    gesture.holdUp(5_040);
    gesture.holdDown(5_120);
    gesture.holdUp(5_210);
    expect(commands).toEqual(["start", "lock", "stop"]);
    expect(gesture.recording).toBe(false);
    // A press after the window is a new dictation again.
    gesture.holdDown(6_000);
    expect(commands.at(-1)).toBe("start");
  });

  it("a press well after stopping hands-free starts a new dictation", () => {
    const { gesture, commands } = setup();
    gesture.holdDown(0);
    gesture.holdUp(80);
    gesture.holdDown(170);
    gesture.holdUp(260);
    gesture.holdDown(5_000);
    gesture.holdUp(5_040);
    gesture.holdDown(5_000 + DOUBLE_TAP_MS + 1);
    expect(commands).toEqual(["start", "lock", "stop", "start"]);
  });

  it("a single short tap ends after the double-tap window", async () => {
    const { gesture, commands, clock } = setup();
    gesture.holdDown(0);
    gesture.holdUp(100);
    await clock.advance(DOUBLE_TAP_MS - 101);
    expect(commands).toEqual(["start"]);
    await clock.advance(1);
    expect(commands).toEqual(["start", "stop"]);
  });

  it("a second press after the window is a new dictation", () => {
    const { gesture, commands } = setup();
    gesture.holdDown(0);
    gesture.holdUp(100);
    gesture.holdDown(DOUBLE_TAP_MS + 50);
    expect(commands).toEqual(["start", "stop", "start"]);
  });

  it("a slow first press is not a tap", () => {
    const { gesture, commands } = setup();
    gesture.holdDown(0);
    gesture.holdUp(TAP_MAX_MS);
    gesture.holdDown(TAP_MAX_MS + 50);
    expect(commands).toEqual(["start", "stop", "start"]);
  });

  it("the hands-free shortcut toggles the lock on and off", () => {
    const { gesture, commands } = setup();
    gesture.toggle();
    expect(gesture.locked).toBe(true);
    gesture.toggle();
    expect(commands).toEqual(["start", "lock", "stop"]);
    expect(gesture.recording).toBe(false);
  });

  it("the shortcut while holding locks without restarting", () => {
    const { gesture, commands } = setup();
    gesture.holdDown(0);
    gesture.toggle();
    gesture.holdUp(5_000);
    expect(commands).toEqual(["start", "lock"]);
    expect(gesture.locked).toBe(true);
  });

  it("Escape cancels while holding, tapped or locked, and is ignored when idle", async () => {
    const { gesture, commands, clock } = setup();
    gesture.cancel();
    gesture.holdDown(0);
    gesture.cancel();
    gesture.toggle();
    gesture.cancel();
    gesture.holdDown(10_000);
    gesture.holdUp(10_100);
    gesture.cancel();
    await clock.advance(1_000);
    expect(commands).toEqual(["start", "cancel", "start", "lock", "cancel", "start", "cancel"]);
  });

  it("starts idle every time, so a lock never survives a restart", () => {
    const { gesture } = setup();
    gesture.toggle();
    expect(setup().gesture.recording).toBe(false);
    gesture.reset();
    expect(gesture.recording).toBe(false);
  });
});
