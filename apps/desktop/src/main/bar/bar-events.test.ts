import { describe, expect, it } from "vitest";
import type { BarView } from "@murmur/shared";
import type { RecorderEvent } from "../recorder";
import { INITIAL_VIEW, transition } from "./bar-machine";
import { barEventFor } from "./bar-events";

function play(events: RecorderEvent[]): BarView["state"][] {
  let view = INITIAL_VIEW;
  const states: BarView["state"][] = [];
  for (const event of events) {
    const step = transition(view, barEventFor(event));
    view = step.view;
    states.push(view.state);
  }
  return states;
}

describe("dictation steps on the Bar", () => {
  it("a normal dictation: listening, processing, done", () => {
    expect(
      play([{ type: "started", at: 1 }, { type: "stopped" }, { type: "transcribed", words: 9 }]),
    ).toEqual(["listening", "processing", "done"]);
  });

  it("a silent microphone warns while recording, then ends as no speech", () => {
    expect(
      play([
        { type: "started", at: 1 },
        { type: "silent-mic", deviceName: "Desk Mic" },
        { type: "stopped" },
        { type: "no-speech" },
      ]),
    ).toEqual(["listening", "warning", "processing", "warning"]);
  });

  it("an email that could not be translated ends as a warning, not done", () => {
    expect(
      play([
        { type: "started", at: 1 },
        { type: "stopped" },
        { type: "translation-failed" },
        { type: "transcribed", words: 9 },
      ]),
    ).toEqual(["listening", "processing", "warning", "warning"]);
    expect(barEventFor({ type: "variables-unavailable" })).toMatchObject({ type: "warn" });
    expect(barEventFor({ type: "translation-failed" })).toEqual({
      type: "warn",
      message: "Not translated: inserted as dictated",
    });
  });

  it("a failed transcription shows the retry error", () => {
    expect(
      play([{ type: "started", at: 1 }, { type: "stopped" }, { type: "transcription-failed" }]),
    ).toEqual(["listening", "processing", "error"]);
  });

  it("copying instead of pasting replaces done with a warning", () => {
    expect(
      play([
        { type: "started", at: 1 },
        { type: "stopped" },
        { type: "transcribed", words: 2 },
        { type: "copied-instead" },
      ]),
    ).toEqual(["listening", "processing", "done", "warning"]);
  });

  it("a missing microphone permission warns from idle", () => {
    expect(play([{ type: "start-failed", message: "Microphone access is not granted" }])).toEqual([
      "warning",
    ]);
  });

  it("hands-free shows locked, and Escape shows cancelled", () => {
    expect(play([{ type: "started", at: 1 }, { type: "locked" }, { type: "cancelled" }])).toEqual([
      "listening",
      "locked",
      "cancelled",
    ]);
  });
});
