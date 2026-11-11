import { describe, expect, it, vi } from "vitest";
import type { DictationBlocker } from "@murmur/shared";
import type { RecorderEvent } from "./recorder";
import { createSmokeRun, SMOKE_PAGE, type SmokeRun } from "./smoke";

function setup(options: {
  blockers?: DictationBlocker[];
  focused?: boolean;
  onKeyDown?: RecorderEvent[];
  onSettled?: RecorderEvent[];
  field?: string;
}) {
  const state = { field: "", focused: options.focused ?? true };
  const calls: string[] = [];
  const emit = (events: RecorderEvent[]) => {
    for (const event of events) smoke.handleRecorderEvent(event);
  };
  const smoke: SmokeRun = createSmokeRun({
    sleep: async (ms) => {
      calls.push(`sleep ${ms}`);
    },
    blockers: () => options.blockers ?? [],
    focusField: async () => {
      calls.push("focus");
    },
    isFieldFocused: () => state.focused,
    readField: async () => state.field,
    keyDown: () => {
      calls.push("down");
      emit(options.onKeyDown ?? [{ type: "started", at: 1 }]);
    },
    keyUp: () => {
      calls.push("up");
    },
    settled: async () => {
      emit(options.onSettled ?? [{ type: "stopped" }, { type: "transcribed", words: 9 }]);
      state.field = options.field ?? "The quick brown fox.";
    },
    holdMs: 3000,
    readyTimeoutMs: 500,
    log: vi.fn(),
  });
  return { smoke, calls, state };
}

describe("smoke run", () => {
  it("presses the key for the length of the clip and reports the inserted text", async () => {
    const { smoke, calls } = setup({});
    const result = await smoke.run();
    expect(result).toEqual({
      ok: true,
      reason: null,
      fieldText: "The quick brown fox.",
      events: ["started", "stopped", "transcribed"],
    });
    expect(calls.filter((call) => !call.startsWith("sleep 250"))).toEqual([
      "focus",
      "down",
      "sleep 3000",
      "up",
    ]);
  });

  it("fails without pressing the key when dictation is blocked", async () => {
    const { smoke, calls } = setup({ blockers: ["accessibility", "speechModel"] });
    const result = await smoke.run();
    expect(result.reason).toBe("dictation is not ready: accessibility, speechModel");
    expect(calls).not.toContain("down");
  });

  it("does nothing when the test window is not in front", async () => {
    const { smoke, calls } = setup({ focused: false });
    const result = await smoke.run();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not in front");
    expect(calls).not.toContain("down");
    expect(() => smoke.assertFieldFocused()).toThrow("lost the focus");
  });

  it("reports a recording that did not start, and releases the key", async () => {
    const { smoke, calls } = setup({
      onKeyDown: [{ type: "start-failed", message: "The microphone could not start" }],
    });
    const result = await smoke.run();
    expect(result.reason).toBe("recording did not start: The microphone could not start");
    expect(calls).toContain("up");
  });

  it("reports a missing transcript, a failed paste and an empty box", async () => {
    const none = await setup({
      onSettled: [{ type: "stopped" }, { type: "no-speech" }],
    }).smoke.run();
    expect(none.reason).toBe("no transcript was produced");
    const failed = await setup({
      onSettled: [{ type: "transcribed", words: 2 }, { type: "insert-failed" }],
    }).smoke.run();
    expect(failed.reason).toBe("the text could not be inserted");
    const copied = await setup({
      onSettled: [{ type: "transcribed", words: 2 }, { type: "copied-instead" }],
    }).smoke.run();
    expect(copied.reason).toContain("copied, not pasted");
    const empty = await setup({ field: "  " }).smoke.run();
    expect(empty.reason).toBe("the test box is empty");
  });

  it("has a page with one focused text box", () => {
    const html = decodeURIComponent(SMOKE_PAGE.split(",")[1]!);
    expect(html).toContain('<textarea id="field"');
    expect(html).toContain("autofocus");
  });
});
