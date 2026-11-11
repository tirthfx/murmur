import { describe, expect, it, vi } from "vitest";
import type { AudioLevel, AudioStopResult } from "@murmur/shared";
import { createTestLogger } from "../helper/fakes";
import { HelperError } from "../helper/types";
import { createMicCheck } from "./mic-check";

const stopResult: AudioStopResult = {
  durationMs: 8000,
  samples: 128000,
  peakDb: -6,
  meanDb: -30,
  silent: false,
  audioFile: null,
  inputNoiseDb: -62,
  inputSpeechDb: -24,
};

function setup(options: { dictating?: boolean; startError?: Error } = {}) {
  const levels = new Set<(level: AudioLevel) => void>();
  const helper = {
    startAudio: vi.fn(async () => {
      if (options.startError) throw options.startError;
      return {
        startedAt: 1,
        sampleRate: 16000 as const,
        channels: 1 as const,
        deviceName: "Desk Mic",
      };
    }),
    stopAudio: vi.fn(async () => stopResult),
    cancelAudio: vi.fn(async () => ({ discarded: true })),
    onAudioLevel: (handler: (level: AudioLevel) => void) => {
      levels.add(handler);
      return () => levels.delete(handler);
    },
  };
  const sent: number[] = [];
  const check = createMicCheck({
    helper,
    logger: createTestLogger(),
    newSessionId: () => "check-1",
    deviceId: () => "USB-1",
    whisper: () => true,
    isDictating: () => options.dictating ?? false,
    sendLevel: (rmsDb) => sent.push(rmsDb),
  });
  const level = (sessionId: string, rmsDb: number) => {
    for (const handler of levels)
      handler({ sessionId, source: "mic", rmsDb, peakDb: rmsDb + 6, at: 1 });
  };
  return { check, helper, sent, level, levels };
}

describe("microphone check", () => {
  it("starts a test session that writes nothing, and streams its levels", async () => {
    const { check, helper, sent, level } = setup();
    expect(await check.start()).toEqual({ ok: true, deviceName: "Desk Mic" });
    expect(helper.startAudio).toHaveBeenCalledWith({
      sessionId: "check-1",
      deviceId: "USB-1",
      emitLevels: true,
      levelIntervalMs: 50,
      whisper: true,
      test: true,
    });
    level("check-1", -30);
    level("dictation", -10);
    expect(sent).toEqual([-30]);
  });

  it("gives advice from the input levels and stops listening", async () => {
    const { check, levels } = setup();
    await check.start();
    expect(await check.stop()).toEqual({
      deviceName: "Desk Mic",
      speechDb: -24,
      noiseDb: -62,
      advice: "close-talk",
      adviceText: expect.stringContaining("Headset"),
    });
    expect(levels.size).toBe(0);
    expect(check.isRunning()).toBe(false);
    expect(await check.stop()).toBeNull();
  });

  it("refuses during a dictation and explains a microphone that cannot start", async () => {
    expect(await setup({ dictating: true }).check.start()).toEqual({
      ok: false,
      message: "Finish the dictation first.",
    });
    const denied = setup({ startError: new HelperError("PERMISSION_DENIED", "no") });
    expect(await denied.check.start()).toEqual({
      ok: false,
      message: "Microphone access is not granted.",
    });
    expect(denied.levels.size).toBe(0);
  });
});
