import { describe, expect, it, vi } from "vitest";
import type {
  AudioLevel,
  AudioSilent,
  AudioStartInput,
  AudioStopResult,
  HelperStatus,
  HotkeyEvent,
} from "@murmur/shared";
import { createTestLogger } from "./helper/fakes";
import { HelperError } from "./helper/types";
import { createRecorder } from "./recorder";

const stopResult: AudioStopResult = {
  durationMs: 10020,
  samples: 160320,
  peakDb: -6.4,
  meanDb: -28.1,
  silent: false,
  audioFile: { path: "/tmp/a.pcm", codec: "pcm_s16le", bytes: 320640 },
};

function key(
  state: HotkeyEvent["state"],
  action: HotkeyEvent["action"] = "dictate.hold",
): HotkeyEvent {
  return { bindingId: "dictate-hold", action, state, at: 1 };
}

function setup(options: Partial<Parameters<typeof createRecorder>[0]> = {}) {
  const levelHandlers = new Set<(level: AudioLevel) => void>();
  const silentHandlers = new Set<(silent: AudioSilent) => void>();
  const statusHandlers = new Set<(status: HelperStatus) => void>();
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
    onAudioLevel: (handler: (level: AudioLevel) => void) => {
      levelHandlers.add(handler);
      return () => levelHandlers.delete(handler);
    },
    onAudioSilent: (handler: (silent: AudioSilent) => void) => {
      silentHandlers.add(handler);
      return () => silentHandlers.delete(handler);
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
    silent: (payload: AudioSilent) => {
      for (const handler of silentHandlers) handler(payload);
    },
    status: (state: HelperStatus["state"]) => {
      for (const handler of statusHandlers) handler({ state, helperVersion: null, message: null });
    },
  };
}

describe("recorder", () => {
  it("starts on key down and stops on key up, then logs a summary", async () => {
    const { recorder, helper, logger, level } = setup();
    recorder.handleHotkey(key("down"));
    await recorder.idle();
    expect(helper.startAudio).toHaveBeenCalledWith({
      sessionId: "s1",
      emitLevels: true,
      levelIntervalMs: 100,
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
    expect(transcribe).toHaveBeenCalledWith("/tmp/a.pcm");
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
    expect(insert).toHaveBeenCalledWith("Hello there.");
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
      .mockRejectedValueOnce(new HelperError("TRANSCRIPTION_TIMEOUT", "slow"))
      .mockResolvedValueOnce({ text: "ok", language: "en", segments: [], decodeMs: 1, audioMs: 1 });
    const { recorder } = setup({ transcribe, onEvent: (event) => events.push(event) });
    expect(recorder.retryLast()).toBe(false);
    recorder.handleHotkey(key("down"));
    recorder.handleHotkey(key("up"));
    await recorder.idle();
    expect(events.at(-1)).toEqual({ type: "transcription-failed" });
    expect(recorder.retryLast()).toBe(true);
    await recorder.idle();
    expect(transcribe).toHaveBeenLastCalledWith("/tmp/a.pcm");
    expect(events.at(-1)).toEqual({ type: "transcribed", words: 1 });
    expect(recorder.retryLast()).toBe(false);
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
});
