import { describe, expect, it } from "vitest";
import { BAR_ERROR_TEXT, BAR_STATES, type BarState, type BarView } from "@murmur/shared";
import {
  ASK_MS,
  CANCELLED_MS,
  DONE_MS,
  WARNING_MS,
  transition,
  type BarEvent,
} from "./bar-machine";

function at(state: BarState, fields: Partial<BarView> = {}): BarView {
  return { state, startedAt: null, words: null, message: null, ...fields };
}

const recordingWarning = at("warning", { startedAt: 1000, message: "No sound from Mic" });
const plainWarning = at("warning", { message: "Copied to clipboard" });
const asking = at("ask", { message: "Save to Memory?", detail: "I prefer metric units." });

/** Every state, with both kinds of warning. */
const views: Record<string, BarView> = {
  hidden: at("hidden"),
  idle: at("idle"),
  listening: at("listening", { startedAt: 1000 }),
  locked: at("locked", { startedAt: 1000 }),
  processing: at("processing"),
  done: at("done", { words: 4 }),
  "warning (recording)": recordingWarning,
  "warning (after)": plainWarning,
  error: at("error", { message: BAR_ERROR_TEXT }),
  cancelled: at("cancelled"),
  ask: asking,
};

const events: Record<string, BarEvent> = {
  show: { type: "show" },
  hide: { type: "hide" },
  start: { type: "start", at: 5000 },
  lock: { type: "lock" },
  stop: { type: "stop" },
  cancel: { type: "cancel" },
  transcribed: { type: "transcribed", words: 7 },
  failed: { type: "failed" },
  retry: { type: "retry" },
  warn: { type: "warn", message: "No sound from Mic" },
  timeout: { type: "timeout" },
  ask: { type: "ask", message: "Save to Memory?", detail: "I prefer metric units." },
  answered: { type: "answered" },
};

/** Expected result for every state and event: the next view and timer, or "same". */
const expected: Record<string, Record<string, [BarView, number | null] | "same">> = {
  hidden: {
    show: [at("idle"), null],
    hide: "same",
    start: "same",
    lock: "same",
    stop: "same",
    cancel: "same",
    transcribed: "same",
    failed: "same",
    retry: "same",
    warn: "same",
    timeout: "same",
    ask: "same",
    answered: "same",
  },
  idle: {
    show: "same",
    hide: [at("hidden"), null],
    start: [at("listening", { startedAt: 5000 }), null],
    lock: "same",
    stop: "same",
    cancel: "same",
    transcribed: "same",
    failed: "same",
    retry: [at("processing"), null],
    warn: [at("warning", { message: "No sound from Mic" }), WARNING_MS],
    timeout: "same",
    ask: [asking, ASK_MS],
    answered: "same",
  },
  listening: {
    show: "same",
    hide: [at("hidden"), null],
    start: "same",
    lock: [at("locked", { startedAt: 1000 }), null],
    stop: [at("processing"), null],
    cancel: [at("cancelled"), CANCELLED_MS],
    transcribed: "same",
    failed: "same",
    retry: "same",
    warn: [recordingWarning, null],
    timeout: "same",
    ask: "same",
    answered: "same",
  },
  locked: {
    show: "same",
    hide: [at("hidden"), null],
    start: "same",
    lock: "same",
    stop: [at("processing"), null],
    cancel: [at("cancelled"), CANCELLED_MS],
    transcribed: "same",
    failed: "same",
    retry: "same",
    warn: [recordingWarning, null],
    timeout: "same",
    ask: "same",
    answered: "same",
  },
  processing: {
    show: "same",
    hide: [at("hidden"), null],
    start: "same",
    lock: "same",
    stop: "same",
    cancel: [at("cancelled"), CANCELLED_MS],
    transcribed: [at("done", { words: 7 }), DONE_MS],
    failed: [at("error", { message: BAR_ERROR_TEXT }), null],
    retry: "same",
    warn: [at("warning", { message: "No sound from Mic" }), WARNING_MS],
    timeout: "same",
    ask: [asking, ASK_MS],
    answered: "same",
  },
  done: {
    show: "same",
    hide: [at("hidden"), null],
    start: [at("listening", { startedAt: 5000 }), null],
    lock: "same",
    stop: "same",
    cancel: [at("cancelled"), CANCELLED_MS],
    transcribed: "same",
    failed: "same",
    retry: [at("processing"), null],
    warn: [at("warning", { message: "No sound from Mic" }), WARNING_MS],
    timeout: [at("idle"), null],
    ask: [asking, ASK_MS],
    answered: "same",
  },
  "warning (recording)": {
    show: "same",
    hide: [at("hidden"), null],
    start: "same",
    lock: "same",
    stop: [at("processing"), null],
    cancel: [at("cancelled"), CANCELLED_MS],
    transcribed: "same",
    failed: "same",
    retry: "same",
    warn: [recordingWarning, null],
    timeout: "same",
    ask: "same",
    answered: "same",
  },
  "warning (after)": {
    show: "same",
    hide: [at("hidden"), null],
    start: [at("listening", { startedAt: 5000 }), null],
    lock: "same",
    stop: "same",
    cancel: [at("cancelled"), CANCELLED_MS],
    transcribed: "same",
    failed: "same",
    retry: [at("processing"), null],
    warn: [at("warning", { message: "No sound from Mic" }), WARNING_MS],
    timeout: [at("idle"), null],
    ask: [asking, ASK_MS],
    answered: "same",
  },
  error: {
    show: "same",
    hide: [at("hidden"), null],
    start: [at("listening", { startedAt: 5000 }), null],
    lock: "same",
    stop: "same",
    cancel: [at("cancelled"), CANCELLED_MS],
    transcribed: "same",
    failed: "same",
    retry: [at("processing"), null],
    warn: [at("warning", { message: "No sound from Mic" }), WARNING_MS],
    timeout: "same",
    ask: [asking, ASK_MS],
    answered: "same",
  },
  cancelled: {
    show: "same",
    hide: [at("hidden"), null],
    start: [at("listening", { startedAt: 5000 }), null],
    lock: "same",
    stop: "same",
    cancel: "same",
    transcribed: "same",
    failed: "same",
    retry: "same",
    warn: [at("warning", { message: "No sound from Mic" }), WARNING_MS],
    timeout: [at("idle"), null],
    ask: [asking, ASK_MS],
    answered: "same",
  },
  ask: {
    show: "same",
    hide: [at("hidden"), null],
    start: [at("listening", { startedAt: 5000 }), null],
    lock: "same",
    stop: "same",
    cancel: [at("cancelled"), CANCELLED_MS],
    transcribed: "same",
    failed: "same",
    retry: "same",
    warn: [at("warning", { message: "No sound from Mic" }), WARNING_MS],
    timeout: [at("idle"), null],
    ask: [asking, ASK_MS],
    answered: [at("idle"), null],
  },
};

describe("bar state machine", () => {
  it("has an expectation for every state and every event", () => {
    expect(Object.keys(expected).sort()).toEqual(Object.keys(views).sort());
    for (const row of Object.values(expected)) {
      expect(Object.keys(row).sort()).toEqual(Object.keys(events).sort());
    }
    const covered = new Set(Object.values(views).map((view) => view.state));
    expect([...covered].sort()).toEqual([...BAR_STATES].sort());
  });

  for (const [stateName, current] of Object.entries(views)) {
    for (const [eventName, event] of Object.entries(events)) {
      const want = expected[stateName]![eventName]!;
      it(`${stateName} + ${eventName}`, () => {
        const step = transition(current, event);
        if (want === "same") {
          expect(step).toEqual({ view: current, changed: false, timeoutMs: null });
        } else {
          expect(step).toEqual({ view: want[0], changed: true, timeoutMs: want[1] });
        }
      });
    }
  }

  it("uses the given message for a failure, or the standard retry text", () => {
    expect(
      transition(at("processing"), { type: "failed", message: "Model missing" }).view.message,
    ).toBe("Model missing");
    expect(BAR_ERROR_TEXT).toBe("Transcription failed. Tap to retry.");
  });
});
