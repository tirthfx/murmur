import {
  micAdvice,
  micAdviceText,
  type MicCheckResult,
  type MicCheckStartResult,
  type PlatformHelper,
  type Unsubscribe,
} from "@murmur/shared";
import type { Logger } from "../helper/types";

export interface MicCheckDeps {
  helper: Pick<PlatformHelper, "startAudio" | "stopAudio" | "cancelAudio" | "onAudioLevel">;
  logger: Logger;
  newSessionId(): string;
  /** The chosen microphone, or null for the system default. */
  deviceId(): string | null;
  whisper(): boolean;
  /** A dictation is recording or being processed. */
  isDictating(): boolean;
  /** Sends one input level to the Hub. */
  sendLevel(rmsDb: number): void;
}

export interface MicCheck {
  start(): Promise<MicCheckStartResult>;
  stop(): Promise<MicCheckResult | null>;
  isRunning(): boolean;
}

/** Levels often enough for the meter to answer within 200 ms. */
export const MIC_CHECK_LEVEL_MS = 50;

/**
 * The microphone check (DC-13): a test session that writes no audio file and no history
 * row. Levels go to the Hub's meter; at the end the helper's input statistics become advice.
 */
export function createMicCheck(deps: MicCheckDeps): MicCheck {
  let running: { id: string; deviceName: string; unsubscribe: Unsubscribe } | null = null;

  return {
    async start() {
      if (running) return { ok: true, deviceName: running.deviceName };
      if (deps.isDictating()) return { ok: false, message: "Finish the dictation first." };
      const id = deps.newSessionId();
      const unsubscribe = deps.helper.onAudioLevel((level) => {
        if (level.sessionId === id) deps.sendLevel(level.rmsDb);
      });
      try {
        const started = await deps.helper.startAudio({
          sessionId: id,
          deviceId: deps.deviceId(),
          emitLevels: true,
          levelIntervalMs: MIC_CHECK_LEVEL_MS,
          whisper: deps.whisper(),
          test: true,
        });
        running = { id, deviceName: started.deviceName, unsubscribe };
        deps.logger.info(`microphone check started on ${started.deviceName}`);
        return { ok: true, deviceName: started.deviceName };
      } catch (error) {
        unsubscribe();
        const code = (error as { code?: unknown } | null)?.code;
        return {
          ok: false,
          message:
            code === "PERMISSION_DENIED"
              ? "Microphone access is not granted."
              : code === "BUSY"
                ? "The microphone is in use by a dictation."
                : "The microphone could not start.",
        };
      }
    },
    async stop() {
      const current = running;
      if (!current) return null;
      running = null;
      current.unsubscribe();
      const result = await deps.helper.stopAudio(current.id);
      const speechDb = result.inputSpeechDb ?? null;
      const noiseDb = result.inputNoiseDb ?? null;
      const advice = micAdvice(result.silent ? null : speechDb, noiseDb);
      deps.logger.info(
        `microphone check: speech ${speechDb} dB, background ${noiseDb} dB, ${advice}`,
      );
      return {
        deviceName: current.deviceName,
        speechDb,
        noiseDb,
        advice,
        adviceText: micAdviceText(advice),
      };
    },
    isRunning: () => running !== null,
  };
}
