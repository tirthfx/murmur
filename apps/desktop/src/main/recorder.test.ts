import { describe, expect, it, vi } from "vitest";
import type {
  AudioLevel,
  AudioSilent,
  AudioRouteChanged,
  AudioStartInput,
  AudioStopResult,
  HelperStatus,
  HotkeyEvent,
} from "@murmur/shared";
import { FakeClock, createTestLogger } from "./helper/fakes";
import { HelperError } from "./helper/types";
import { createRecorder, type DictationRecord } from "./recorder";

const stopResult: AudioStopResult = {
  durationMs: 10020,
  samples: 160320,
  peakDb: -6.4,
  meanDb: -28.1,
  silent: false,
  audioFile: { path: "/tmp/a.pcm", codec: "pcm_s16le", bytes: 320640 },
};

/** A long press by default (down at 0, up at 1 s), so it is push-to-talk, not a tap. */
function key(
  state: HotkeyEvent["state"],
  action: HotkeyEvent["action"] = "dictate.hold",
  at = state === "up" ? 1_000 : 0,
): HotkeyEvent {
  return { bindingId: "dictate-hold", action, state, at };
}

function setup(options: Partial<Parameters<typeof createRecorder>[0]> = {}) {
  const levelHandlers = new Set<(level: AudioLevel) => void>();
  const silentHandlers = new Set<(silent: AudioSilent) => void>();
  const statusHandlers = new Set<(status: HelperStatus) => void>();
  const routeHandlers = new Set<(change: AudioRouteChanged) => void>();
  const calls: string[] = [];
  const helper = {
    startAudio: vi.fn(async (input: AudioStartInput) => {
      calls.push(`start ${input.sessionId}`);
      return {
        startedAt: 1,
        sampleRate: 16000 as const,
        channels: 1 as const,
        deviceName: "Desk Mic",
      };
    }),
    stopAudio: vi.fn(async (sessionId: string) => {
      calls.push(`stop ${sessionId}`);
      return stopResult;
    }),
    cancelAudio: vi.fn(async (sessionId: string) => {
      calls.push(`cancel ${sessionId}`);
      return { discarded: true };
    }),
    onAudioLevel: (handler: (level: AudioLevel) => void) => {
      levelHandlers.add(handler);
      return () => levelHandlers.delete(handler);
    },
    onAudioSilent: (handler: (silent: AudioSilent) => void) => {
      silentHandlers.add(handler);
      return () => silentHandlers.delete(handler);
    },
    onAudioRouteChanged: (handler: (change: AudioRouteChanged) => void) => {
      routeHandlers.add(handler);
      return () => routeHandlers.delete(handler);
    },
    onStatusChange: (handler: (status: HelperStatus) => void) => {
      statusHandlers.add(handler);
      return () => statusHandlers.delete(handler);
    },
  };
  let counter = 0;
  const logger = createTestLogger();
  const recorder = createRecorder({
    helper,
    logger,
    newSessionId: () => `s${++counter}`,
    ...options,
  });
  recorder.start();
  return {
    helper,
    logger,
    recorder,
    calls,
    level: (sessionId: string) => {
      for (const handler of levelHandlers)
        handler({ sessionId, source: "mic", rmsDb: -30, peakDb: -10, at: 1 });
    },
    route: (payload: AudioRouteChanged) => {
      for (const handler of routeHandlers) handler(payload);
    },
    silent: (payload: AudioSilent) => {
      for (const handler of silentHandlers) handler(payload);
    },
    status: (state: HelperStatus["state"]) => {
      for (const handler of statusHandlers) handler({ state, helperVersion: null, message: null });
    },
  };
}

const transcript = { text: "", language: "en", segments: [], decodeMs: 1, audioMs: 1000 };

describe("recorder", () => {
  it("starts on key down and stops on key up, then logs a summary", async () => {
    const { recorder, helper, logger, level } = setup();
    recorder.handleHotkey(key("down"));
    await recorder.idle();
    expect(helper.startAudio).toHaveBeenCalledWith({
      sessionId: "s1",
      emitLevels: true,
      levelIntervalMs: 100,
      deviceId: null,
    });
    level("s1");
    level("s1");
    level("other");
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(helper.stopAudio).toHaveBeenCalledWith("s1");
    expect(logger.lines).toContain("info: recording from Desk Mic");
    expect(logger.lines).toContain(
      "info: captured 10.02 s (160320 samples at 16 kHz), peak -6.4 dB, mean -28.1 dB, 2 level events, 320640 bytes",
    );
  });

  it("keeps start and stop in order when the key is tapped quickly", async () => {
    const { recorder, calls } = setup();
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(calls).toEqual(["start s1", "stop s1", "start s2", "stop s2"]);
  });

  it("warns with the device name when the microphone is silent", async () => {
    const { recorder, logger, silent } = setup();
    recorder.handleHotkey(key("down"));
    await recorder.idle();
    silent({ sessionId: "s1", elapsedMs: 3000, deviceName: "USB Mic" });
    silent({ sessionId: "old", elapsedMs: 3000, deviceName: "Other" });
    expect(logger.lines.filter((line) => line.includes("No sound from"))).toEqual([
      "warn: No sound from USB Mic. Check the input in System Settings.",
    ]);
  });

  it("explains a missing microphone permission and never asks for it", async () => {
    const { recorder, helper, logger } = setup();
    helper.startAudio.mockRejectedValueOnce(new HelperError("PERMISSION_DENIED", "microphone"));
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(helper.stopAudio).not.toHaveBeenCalled();
    expect(logger.lines.join("\n")).toContain("Microphone access is not granted");
    expect(Object.keys(helper)).not.toContain("requestPermission");
  });

  it("ignores other actions and forgets the session when the helper restarts", async () => {
    const { recorder, helper, status } = setup();
    recorder.handleHotkey(key("press", "paste.last"));
    await recorder.idle();
    expect(helper.startAudio).not.toHaveBeenCalled();

    recorder.handleHotkey(key("down"));
    await recorder.idle();
    status("starting");
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(helper.stopAudio).not.toHaveBeenCalled();
  });

  it("logs when a session heard nothing", async () => {
    const { recorder, helper, logger } = setup();
    helper.stopAudio.mockResolvedValueOnce({ ...stopResult, silent: true, audioFile: null });
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(logger.lines).toContain("warn: nothing above the silence threshold was heard");
  });

  it("transcribes each recording and logs the word count, not the words", async () => {
    const transcribe = vi.fn(async () => ({
      text: "Move the review to Thursday.",
      language: "en",
      segments: [],
      decodeMs: 640,
      audioMs: 10020,
    }));
    const { recorder, logger } = setup({ transcribe });
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(transcribe).toHaveBeenCalledWith("/tmp/a.pcm", { prompt: "" });
    expect(logger.lines).toContain("info: transcribed 10.02 s in 640 ms: 5 words, language en");
    expect(logger.lines.join("\n")).not.toContain("Thursday");
  });

  it("logs the words only when asked to", async () => {
    const transcribe = vi.fn(async () => ({
      text: "Hello.",
      language: "en",
      segments: [],
      decodeMs: 1,
      audioMs: 1,
    }));
    const { recorder, logger } = setup({ transcribe, logTranscripts: true });
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(logger.lines).toContain("info: text: Hello.");
  });

  it("does not transcribe a silent recording, and survives a failed transcription", async () => {
    const transcribe = vi.fn(async () => {
      throw new Error("The speech model is not ready (missing)");
    });
    const { recorder, helper, logger } = setup({ transcribe });
    helper.stopAudio.mockResolvedValueOnce({ ...stopResult, silent: true });
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(transcribe).not.toHaveBeenCalled();
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(logger.lines).toContain(
      "warn: could not transcribe: The speech model is not ready (missing)",
    );
  });

  it("inserts the recognised text into the focused field", async () => {
    const transcribe = vi.fn(async () => ({
      text: " Hello there. ",
      language: "en",
      segments: [],
      decodeMs: 600,
      audioMs: 2000,
    }));
    const insert = vi.fn(async () => ({
      method: "paste_cmd_v" as const,
      delivered: true,
      clipboardRestored: true,
    }));
    const { recorder, logger } = setup({ transcribe, insert });
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(insert).toHaveBeenCalledWith("Hello there.", { pressEnter: false });
    expect(
      logger.lines.some((line) =>
        /inserted by paste_cmd_v in \d+ ms, clipboard restored/.test(line),
      ),
    ).toBe(true);
  });

  it("copies instead when Accessibility is missing, and never inserts empty text", async () => {
    const texts = ["Hello.", "  "];
    const transcribe = vi.fn(async () => ({
      text: texts.shift() ?? "",
      language: "en",
      segments: [],
      decodeMs: 1,
      audioMs: 1,
    }));
    const insert = vi.fn(async () => {
      throw new HelperError("PERMISSION_DENIED", "accessibility: Accessibility is not granted");
    });
    const copy = vi.fn(async () => {});
    const { recorder, logger } = setup({ transcribe, insert, copy });
    for (let i = 0; i < 2; i++) {
      recorder.handleHotkey(key("down"));
      recorder.handleHotkey(key("up"));
    }
    await recorder.idle();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith("Hello.");
    expect(logger.lines.join("\n")).toContain("copied to the clipboard instead");
  });

  it("reports each step for the Bar, without the words", async () => {
    const events: unknown[] = [];
    const transcribe = vi.fn(async () => ({
      text: "Three little words",
      language: "en",
      segments: [],
      decodeMs: 1,
      audioMs: 1,
    }));
    const { recorder } = setup({ transcribe, onEvent: (event) => events.push(event) });
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(events).toEqual([
      { type: "started", at: 1 },
      { type: "stopped" },
      { type: "transcribed", words: 3 },
    ]);
  });

  it("retries the last failed transcription once asked", async () => {
    const events: { type: string }[] = [];
    const transcribe = vi
      .fn()
      .mockRejectedValueOnce(new HelperError("TRANSCRIPTION_FAILED", "bad audio"))
      .mockResolvedValueOnce({ text: "ok", language: "en", segments: [], decodeMs: 1, audioMs: 1 });
    const { recorder } = setup({ transcribe, onEvent: (event) => events.push(event) });
    expect(recorder.retryLast()).toBe(false);
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(events.at(-1)).toEqual({ type: "transcription-failed" });
    expect(recorder.retryLast()).toBe(true);
    await recorder.idle();
    expect(transcribe).toHaveBeenLastCalledWith("/tmp/a.pcm", { prompt: "" });
    expect(events.at(-1)).toEqual({ type: "transcribed", words: 1 });
    expect(recorder.retryLast()).toBe(false);
  });

  it("retries once by itself after a timeout, and records only the outcome", async () => {
    const records: DictationRecord[] = [];
    const sleeps: number[] = [];
    const waitForSpeech = vi.fn(async () => {});
    const transcribe = vi
      .fn()
      .mockRejectedValueOnce(new HelperError("TRANSCRIPTION_TIMEOUT", "slow"))
      .mockResolvedValueOnce({ text: "ok", language: "en", segments: [], decodeMs: 1, audioMs: 1 });
    const insert = vi.fn(async () => ({
      method: "paste_cmd_v" as const,
      delivered: true,
      clipboardRestored: true,
    }));
    const { recorder } = setup({
      transcribe,
      insert,
      waitForSpeech,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      record: (record) => {
        records.push(record);
        return "h1";
      },
    });
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(sleeps).toEqual([2000]);
    expect(waitForSpeech).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledOnce();
    expect(records.map((record) => record.insertStatus)).toEqual(["inserted"]);
  });

  it("gives up after one automatic retry", async () => {
    const records: DictationRecord[] = [];
    const transcribe = vi.fn().mockRejectedValue(new HelperError("HELPER_RESTARTED", "gone"));
    const { recorder } = setup({
      transcribe,
      sleep: async () => {},
      record: (record) => {
        records.push(record);
        return "h1";
      },
    });
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(records.map((record) => [record.insertStatus, record.errorCode])).toEqual([
      ["failed", "HELPER_RESTARTED"],
    ]);
  });

  it("notes each recording until its history row exists, and drops it when cancelled", async () => {
    const calls: string[] = [];
    const pending = {
      start: (id: string) => calls.push(`start ${id}`),
      stopped: (id: string, file: string, ms: number) => calls.push(`stopped ${id} ${file} ${ms}`),
      clear: (id: string) => calls.push(`clear ${id}`),
    };
    const { recorder } = setup({
      clock: new FakeClock(),
      pending,
      transcribe: async () => ({ ...transcript, text: "hi" }),
    });
    recorder.toggle();
    await recorder.idle();
    recorder.toggle();
    await recorder.idle();
    recorder.toggle();
    await recorder.idle();
    recorder.handleHotkey({ bindingId: "c", action: "dictate.cancel", state: "press", at: 1 });
    await recorder.idle();
    expect(calls).toEqual(["start s1", "stopped s1 /tmp/a.pcm 10020", "start s2", "clear s2"]);
  });

  it("retries a failed dictation from history after a restart, and never twice", async () => {
    const events: string[] = [];
    let resolved = false;
    const transcribe = vi.fn(async () => ({ ...transcript, text: "found it" }));
    const insert = vi.fn(async () => ({
      method: "paste_cmd_v" as const,
      delivered: true,
      clipboardRestored: true,
    }));
    const records: DictationRecord[] = [];
    const { recorder } = setup({
      transcribe,
      insert,
      onEvent: (event) => events.push(event.type),
      lastRetryable: () => ({
        historyId: "h-old",
        sessionId: "s-old",
        createdAt: 5,
        durationMs: 3000,
        audioPath: "/kept/s-old.pcm",
      }),
      isResolved: () => resolved,
      record: (record) => {
        records.push(record);
        resolved = true;
        return "h-new";
      },
    });
    expect(recorder.canRetry()).toBe(true);
    expect(recorder.retryLast()).toBe(true);
    // A second press while the first retry runs does nothing.
    expect(recorder.retryLast()).toBe(false);
    await recorder.idle();
    expect(events[0]).toBe("retrying");
    expect(transcribe).toHaveBeenCalledWith("/kept/s-old.pcm", { prompt: "" });
    expect(insert).toHaveBeenCalledOnce();
    expect(records[0]).toMatchObject({ source: "retry", retryOf: "h-old", sessionId: "s-old" });
    expect(recorder.retryLast()).toBe(false);
  });

  it("splits a dictation with long pauses into messages, each sent with Return", async () => {
    const insert = vi.fn(async () => ({
      method: "paste_cmd_v" as const,
      delivered: true,
      clipboardRestored: true,
      enterPressed: true,
    }));
    const records: DictationRecord[] = [];
    const segment = (startMs: number, endMs: number, text: string) => ({
      startMs,
      endMs,
      text,
      confidence: 0.9,
    });
    const { recorder } = setup({
      clock: new FakeClock(),
      insert,
      splitMessages: () => true,
      pressEnterCommand: () => true,
      transcribe: async () => ({
        ...transcript,
        text: "Are you free this afternoon? I wanted to go over the plan. Let me know what time works.",
        segments: [
          segment(0, 2000, "Are you free this afternoon?"),
          segment(5000, 7000, "I wanted to go over the plan."),
          segment(10_000, 12_000, "Let me know what time works."),
        ],
      }),
      record: (record) => {
        records.push(record);
        return "h1";
      },
    });
    recorder.toggle();
    await recorder.idle();
    recorder.toggle();
    await recorder.idle();
    expect(insert.mock.calls).toEqual([
      ["Are you free this afternoon?", { pressEnter: true }],
      ["I wanted to go over the plan.", { pressEnter: true }],
      ["Let me know what time works.", { pressEnter: false }],
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]!.finalText).toBe(
      "Are you free this afternoon?\nI wanted to go over the plan.\nLet me know what time works.",
    );
  });

  it("reports a silent recording as no speech", async () => {
    const events: { type: string }[] = [];
    const { recorder, helper } = setup({ onEvent: (event) => events.push(event) });
    helper.stopAudio.mockResolvedValueOnce({ ...stopResult, silent: true });
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(events.map((event) => event.type)).toEqual(["started", "stopped", "no-speech"]);
  });

  it("cleans the transcript before inserting it, and warms cleanup when recording starts", async () => {
    const transcribe = vi.fn(async () => ({
      text: "Um, so we go.",
      language: "en",
      segments: [],
      decodeMs: 1,
      audioMs: 1,
    }));
    const clean = vi.fn(async () => ({
      text: "So we go.",
      source: "model" as const,
      fallback: false,
      reason: null,
      modelMs: 420,
    }));
    const prepareCleanup = vi.fn();
    const insert = vi.fn(async () => ({
      method: "paste_cmd_v" as const,
      delivered: true,
      clipboardRestored: true,
    }));
    const events: { type: string; words?: number }[] = [];
    const { recorder, logger } = setup({
      transcribe,
      clean,
      prepareCleanup,
      insert,
      onEvent: (event) => events.push(event),
    });
    recorder.handleHotkey(key("down"));
    await recorder.idle();
    expect(prepareCleanup).toHaveBeenCalledOnce();
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(clean).toHaveBeenCalledWith("Um, so we go.", { terms: [] });
    expect(insert).toHaveBeenCalledWith("So we go.", { pressEnter: false });
    expect(events.at(-1)).toEqual({ type: "transcribed", words: 3 });
    expect(logger.lines).toContain("info: cleanup: model in 420 ms");
  });

  it("hands every finished dictation to history: inserted, failed, retried and empty", async () => {
    const records: DictationRecord[] = [];
    const transcribe = vi
      .fn()
      .mockRejectedValueOnce(new HelperError("TRANSCRIPTION_FAILED", "bad audio"))
      .mockResolvedValue({
        text: "Hello there",
        language: "en",
        segments: [],
        decodeMs: 1,
        audioMs: 1,
      });
    const insert = vi.fn(async () => ({
      method: "paste_cmd_v" as const,
      delivered: true,
      clipboardRestored: true,
    }));
    let id = 0;
    const { recorder, helper } = setup({
      transcribe,
      insert,
      now: () => 5_000,
      record: (dictation) => {
        records.push(dictation);
        return `h${++id}`;
      },
    });
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    recorder.retryLast();
    await recorder.idle();
    helper.stopAudio.mockResolvedValueOnce({ ...stopResult, silent: true });
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();

    expect(records.map((r) => [r.source, r.insertStatus, r.errorCode, r.retryOf])).toEqual([
      ["hold", "failed", "TRANSCRIPTION_FAILED", null],
      ["retry", "inserted", null, "h1"],
      ["hold", "empty", null, null],
    ]);
    expect(records[1]).toMatchObject({
      rawText: "Hello there",
      finalText: "Hello there",
      wordCount: 2,
      language: "en",
      insertMethod: "paste_cmd_v",
      durationMs: 10020,
      createdAt: 5_000,
      audio: { path: "/tmp/a.pcm", codec: "pcm_s16le", durationMs: 10020 },
    });
  });

  it("records from the chosen microphone, and from the default when it is gone", async () => {
    let chosen: string | null = "USB-1";
    const { recorder, helper, logger } = setup({ deviceId: () => chosen });
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(helper.startAudio.mock.calls[0]![0]).toMatchObject({ deviceId: "USB-1" });

    helper.startAudio.mockRejectedValueOnce(new HelperError("DEVICE_NOT_FOUND", "gone"));
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(helper.startAudio.mock.calls.slice(1).map((call) => call[0].deviceId)).toEqual([
      "USB-1",
      null,
    ]);
    expect(logger.lines).toContain(
      "warn: the chosen microphone is not connected; using the system default",
    );

    chosen = null;
    recorder.handleHotkey(key("down"));
    await recorder.idle();
    expect(helper.startAudio.mock.calls.at(-1)![0]).toMatchObject({ deviceId: null });
  });

  it("hands-free: double tap locks, the next tap stops and inserts exactly once", async () => {
    const events: { type: string }[] = [];
    const transcribe = vi.fn(async () => ({
      text: "Hi",
      language: "en",
      segments: [],
      decodeMs: 1,
      audioMs: 1,
    }));
    const insert = vi.fn(async () => ({
      method: "paste_cmd_v" as const,
      delivered: true,
      clipboardRestored: true,
    }));
    const clock = new FakeClock();
    const { recorder, calls } = setup({
      transcribe,
      insert,
      clock,
      onEvent: (event) => events.push(event),
    });
    recorder.handleHotkey(key("down", "dictate.hold", 0));
    recorder.handleHotkey(key("up", "dictate.hold", 100));
    recorder.handleHotkey(key("down", "dictate.hold", 250));
    recorder.handleHotkey(key("up", "dictate.hold", 320));
    await clock.advance(5_000);
    await recorder.idle();
    expect(calls).toEqual(["start s1"]);
    expect(events.map((event) => event.type)).toEqual(["started", "locked"]);

    recorder.handleHotkey(key("down", "dictate.hold", 9_000));
    recorder.handleHotkey(key("up", "dictate.hold", 9_080));
    await clock.advance(1_000);
    await recorder.idle();
    expect(calls).toEqual(["start s1", "stop s1"]);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("the hands-free shortcut starts locked and stops on the next press", async () => {
    const clock = new FakeClock();
    const { recorder, calls } = setup({ clock });
    recorder.handleHotkey({
      bindingId: "dictate-toggle",
      action: "dictate.toggle",
      state: "press",
      at: 0,
    });
    await recorder.idle();
    recorder.handleHotkey({
      bindingId: "dictate-toggle",
      action: "dictate.toggle",
      state: "press",
      at: 5_000,
    });
    await recorder.idle();
    expect(calls).toEqual(["start s1", "stop s1"]);
  });

  it("toggle starts hands-free and stops it, for the tray menu", async () => {
    const events: string[] = [];
    const clock = new FakeClock();
    const { recorder, calls } = setup({ clock, onEvent: (event) => events.push(event.type) });
    recorder.toggle();
    await recorder.idle();
    expect(events).toEqual(["started", "locked"]);
    recorder.toggle();
    await recorder.idle();
    expect(calls).toEqual(["start s1", "stop s1"]);
  });

  it("does not record while setup is unfinished, and says why", async () => {
    const events: unknown[] = [];
    let reason: string | null = "Open Murmur to finish setup: the speech model is not ready";
    const { recorder, calls } = setup({
      clock: new FakeClock(),
      blocked: async () => reason,
      onEvent: (event) => events.push(event),
    });
    recorder.toggle();
    await recorder.idle();
    expect(calls).toEqual([]);
    expect(events).toEqual([{ type: "start-failed", message: reason }]);
    // Once the missing piece is there, the very next press records.
    reason = null;
    recorder.toggle();
    await recorder.idle();
    expect(calls).toEqual(["start s1"]);
  });

  it("takes press enter off the end, before cleanup, and asks for Return", async () => {
    const insert = vi.fn(async () => ({
      method: "paste_cmd_v" as const,
      delivered: true,
      clipboardRestored: true,
      appBundleId: "com.tinyspeck.slackmacgap",
      enterPressed: true,
    }));
    const clean = vi.fn(async (text: string) => ({ text, source: "rules" as const }));
    const records: DictationRecord[] = [];
    const { recorder } = setup({
      clock: new FakeClock(),
      transcribe: async () => ({ ...transcript, text: "Send the file, press enter." }),
      insert,
      clean: clean as never,
      pressEnterCommand: () => true,
      record: (record) => {
        records.push(record);
        return "h1";
      },
    });
    recorder.toggle();
    await recorder.idle();
    recorder.toggle();
    await recorder.idle();
    expect(clean).toHaveBeenCalledWith("Send the file.", { terms: [] });
    expect(insert).toHaveBeenCalledWith("Send the file.", { pressEnter: true });
    expect(records[0]).toMatchObject({
      finalText: "Send the file.",
      pressEnter: true,
      appBundleId: "com.tinyspeck.slackmacgap",
    });
  });

  it("warns when Return was skipped, and leaves the phrase alone when the command is off", async () => {
    const events: string[] = [];
    const insert = vi.fn(async () => ({
      method: "paste_cmd_v" as const,
      delivered: true,
      clipboardRestored: true,
      enterPressed: false,
    }));
    let enabled = true;
    const { recorder } = setup({
      clock: new FakeClock(),
      transcribe: async () => ({ ...transcript, text: "Done. Press enter." }),
      insert,
      pressEnterCommand: () => enabled,
      onEvent: (event) => events.push(event.type),
    });
    recorder.toggle();
    await recorder.idle();
    recorder.toggle();
    await recorder.idle();
    expect(events).toContain("enter-skipped");
    enabled = false;
    recorder.toggle();
    await recorder.idle();
    recorder.toggle();
    await recorder.idle();
    expect(insert).toHaveBeenLastCalledWith("Done. Press enter.", { pressEnter: false });
  });

  it("reads the focused field at the start and uses it for the prompt and spelling only", async () => {
    const transcribe = vi.fn(async () => ({ ...transcript, text: "send it to priya ragunathan" }));
    const clean = vi.fn(async (text: string) => ({ text, source: "rules" as const }));
    const records: DictationRecord[] = [];
    const readContext = vi.fn(async () => ({
      appName: "Slack",
      bundleId: "com.tinyspeck.slackmacgap",
      windowTitle: null,
      role: "AXTextArea",
      subrole: null,
      editable: true,
      secure: false,
      textBefore: "Thanks Priya Raghunathan for the notes. ",
      textAfter: "",
    }));
    const { recorder, logger } = setup({
      clock: new FakeClock(),
      transcribe,
      clean: clean as never,
      readContext,
      record: (record) => {
        records.push(record);
        return "h1";
      },
    });
    recorder.toggle();
    await recorder.idle();
    recorder.toggle();
    await recorder.idle();
    expect(readContext).toHaveBeenCalledOnce();
    expect(transcribe).toHaveBeenCalledWith("/tmp/a.pcm", {
      prompt: "Thanks Priya Raghunathan for the notes.",
    });
    expect(clean).toHaveBeenCalledWith("send it to priya ragunathan", {
      terms: ["Priya", "Raghunathan"],
    });
    // Nothing from the screen is kept with the dictation or written to the log.
    expect(JSON.stringify(records)).not.toContain("Raghunathan");
    expect(logger.lines.join("\n")).not.toContain("Raghunathan");
  });

  it("goes ahead without context when reading it fails", async () => {
    const transcribe = vi.fn(async () => ({ ...transcript, text: "hello" }));
    const { recorder } = setup({
      clock: new FakeClock(),
      transcribe,
      readContext: async () => {
        throw new Error("PERMISSION_DENIED");
      },
    });
    recorder.toggle();
    await recorder.idle();
    recorder.toggle();
    await recorder.idle();
    expect(transcribe).toHaveBeenCalledWith("/tmp/a.pcm", { prompt: "" });
  });

  it("tells the Bar once when the microphone changes mid-recording, and only for this session", async () => {
    const events: unknown[] = [];
    const { recorder, route, logger } = setup({
      clock: new FakeClock(),
      onEvent: (event) => events.push(event),
    });
    recorder.toggle();
    await recorder.idle();
    route({ sessionId: "other", reason: "device-removed", deviceName: "X" });
    route({ sessionId: "s1", reason: "device-removed", deviceName: "MacBook Air Microphone" });
    route({ sessionId: "s1", reason: "interrupted", deviceName: "MacBook Air Microphone" });
    expect(events.filter((event) => (event as { type: string }).type === "mic-switched")).toEqual([
      { type: "mic-switched", deviceName: "MacBook Air Microphone" },
    ]);
    expect(logger.lines.filter((line) => line.includes("microphone changed"))).toHaveLength(2);
  });

  it("rewrites the recognised text first, and keeps the raw text as heard", async () => {
    const insert = vi.fn(async () => ({
      method: "paste_cmd_v" as const,
      delivered: true,
      clipboardRestored: true,
    }));
    const records: DictationRecord[] = [];
    const { recorder } = setup({
      clock: new FakeClock(),
      transcribe: async () => ({ ...transcript, text: "ठीक है" }),
      rewriteText: (text) => (text === "ठीक है" ? "theek hai" : text),
      insert,
      record: (record) => {
        records.push(record);
        return "h1";
      },
    });
    recorder.toggle();
    await recorder.idle();
    recorder.toggle();
    await recorder.idle();
    expect(insert).toHaveBeenCalledWith("theek hai", { pressEnter: false });
    expect(records[0]).toMatchObject({ rawText: "ठीक है", finalText: "theek hai" });
  });

  it("Escape discards the recording and inserts nothing", async () => {
    const events: { type: string }[] = [];
    const transcribe = vi.fn();
    const clock = new FakeClock();
    const { recorder, calls } = setup({
      transcribe,
      clock,
      onEvent: (event) => events.push(event),
    });
    recorder.handleHotkey({
      bindingId: "dictate-cancel",
      action: "dictate.cancel",
      state: "press",
      at: 0,
    });
    recorder.handleHotkey(key("down"));
    await recorder.idle();
    recorder.handleHotkey({
      bindingId: "dictate-cancel",
      action: "dictate.cancel",
      state: "press",
      at: 500,
    });
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(calls).toEqual(["start s1", "cancel s1"]);
    expect(transcribe).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(["started", "cancelled"]);
  });

  it("runs the start effects before the microphone and restores after stop, cancel and failed starts", async () => {
    const order: string[] = [];
    const clock = new FakeClock();
    const { recorder, helper, calls } = setup({
      clock,
      beforeStart: async () => {
        order.push("before");
      },
      afterEnd: async () => {
        order.push("after");
      },
    });
    helper.startAudio.mockImplementation(async (input) => {
      order.push("mic on");
      calls.push(`start ${input.sessionId}`);
      return { startedAt: 1, sampleRate: 16000, channels: 1, deviceName: "Desk Mic" };
    });
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    recorder.handleHotkey(key("down"));
    await recorder.idle();
    recorder.handleHotkey({ bindingId: "c", action: "dictate.cancel", state: "press", at: 500 });
    await recorder.idle();
    helper.startAudio.mockRejectedValueOnce(new HelperError("PERMISSION_DENIED", "microphone"));
    recorder.handleHotkey(key("down"));
    await recorder.idle();
    expect(order).toEqual([
      "before",
      "mic on",
      "after",
      "before",
      "mic on",
      "after",
      "before",
      "after",
    ]);
  });
});
