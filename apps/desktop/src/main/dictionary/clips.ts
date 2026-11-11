import { promises as fs } from "node:fs";
import path from "node:path";
import type { DictionaryClipResult, PlatformHelper } from "@murmur/shared";
import type { Clock, Logger, TimerHandle } from "../helper/types";
import type { DictionaryStore } from "./dictionary-store";

// Pronunciation clips (PZ-06, experimental): up to 3 s of the owner saying a dictionary term,
// kept as a reminder to play back. It never changes recognition.

export const CLIP_MAX_MS = 3_000;
export const CLIP_MIN_MS = 300;
const SAMPLE_RATE = 16_000;
const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000;

/** 16-bit mono PCM at 16 kHz as a WAV file. */
export function pcmToWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export interface ClipRecorderDeps {
  helper: Pick<PlatformHelper, "startAudio" | "stopAudio" | "cancelAudio">;
  dictionary: Pick<DictionaryStore, "clipPath" | "setClip" | "list">;
  /** Where clips are kept: `<appData>/Murmur/clips`. */
  dir: string;
  isDictating(): boolean;
  deviceId(): string | null | Promise<string | null>;
  newSessionId(): string;
  clock: Clock;
  logger: Logger;
}

export interface ClipRecorder {
  start(entryId: string): Promise<DictionaryClipResult>;
  /** Stops and saves; also happens by itself after 3 s. */
  stop(): Promise<DictionaryClipResult>;
  /** The clip as a data URL for the Hub to play, or null. */
  play(entryId: string): Promise<string | null>;
  /** Deletes the clip file and forgets it; called before the entry is deleted. */
  remove(entryId: string): Promise<void>;
  isRecording(): boolean;
}

export function createClipRecorder(deps: ClipRecorderDeps): ClipRecorder {
  let recording: { entryId: string; sessionId: string; timer: TimerHandle } | null = null;
  let finishing: Promise<DictionaryClipResult> | null = null;
  const fileFor = (entryId: string) => path.join(deps.dir, `${entryId.replace(/[^\w-]/g, "")}.wav`);

  async function finish(): Promise<DictionaryClipResult> {
    const current = recording;
    if (!current) return { ok: false, message: "Nothing is being recorded." };
    recording = null;
    deps.clock.clearTimeout(current.timer);
    try {
      const result = await deps.helper.stopAudio(current.sessionId);
      if (!result.audioFile) return { ok: false, message: "Nothing was recorded." };
      const pcm = await fs.readFile(result.audioFile.path);
      await fs.rm(result.audioFile.path, { force: true });
      const kept = pcm.subarray(0, Math.floor(CLIP_MAX_MS * BYTES_PER_MS) & ~1);
      const durationMs = Math.round(kept.length / BYTES_PER_MS);
      if (durationMs < CLIP_MIN_MS) return { ok: false, message: "Too short. Try again." };
      if (!deps.dictionary.list().some((entry) => entry.id === current.entryId)) {
        return { ok: false, message: "This entry no longer exists." };
      }
      await fs.mkdir(deps.dir, { recursive: true });
      const file = fileFor(current.entryId);
      await fs.writeFile(file, pcmToWav(kept));
      deps.dictionary.setClip(current.entryId, file);
      deps.logger.info(`pronunciation clip saved (${durationMs} ms)`);
      return { ok: true, durationMs };
    } catch (error) {
      deps.logger.warn(
        `pronunciation clip not saved: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { ok: false, message: "The clip could not be saved." };
    }
  }

  return {
    async start(entryId) {
      if (recording) return { ok: false, message: "A clip is already being recorded." };
      if (deps.isDictating()) return { ok: false, message: "Finish the dictation first." };
      if (!deps.dictionary.list().some((entry) => entry.id === entryId)) {
        return { ok: false, message: "This entry no longer exists." };
      }
      const sessionId = deps.newSessionId();
      try {
        await deps.helper.startAudio({
          sessionId,
          deviceId: await deps.deviceId(),
          emitLevels: false,
          levelIntervalMs: 100,
        });
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        return {
          ok: false,
          message:
            code === "PERMISSION_DENIED"
              ? "Microphone access is not granted."
              : "The microphone could not start.",
        };
      }
      finishing = null;
      const timer = deps.clock.setTimeout(() => {
        finishing = finish();
      }, CLIP_MAX_MS);
      recording = { entryId, sessionId, timer };
      return { ok: true, durationMs: 0 };
    },

    stop() {
      if (recording) {
        finishing = finish();
        return finishing;
      }
      return finishing ?? Promise.resolve({ ok: false, message: "Nothing is being recorded." });
    },

    async play(entryId) {
      const file = deps.dictionary.clipPath(entryId);
      if (!file) return null;
      const data = await fs.readFile(file).catch(() => null);
      return data ? `data:audio/wav;base64,${data.toString("base64")}` : null;
    },

    async remove(entryId) {
      const file = deps.dictionary.clipPath(entryId);
      if (file) await fs.rm(file, { force: true });
      if (file) deps.dictionary.setClip(entryId, null);
    },

    isRecording: () => recording !== null,
  };
}
