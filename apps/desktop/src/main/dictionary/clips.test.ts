import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { FakeClock, createTestLogger, flush } from "../helper/fakes";
import { openDatabase } from "../db/database";
import { createDictionaryStore } from "./dictionary-store";
import { CLIP_MAX_MS, createClipRecorder, pcmToWav } from "./clips";

const dir = mkdtempSync(path.join(os.tmpdir(), "murmur-clips-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function setup(recordedMs: number) {
  const clock = new FakeClock();
  const dictionary = createDictionaryStore(openDatabase(":memory:"));
  const saved = dictionary.save({
    term: "Kubernetes",
    replacement: null,
    caseSensitive: false,
    starred: false,
  });
  const entryId = saved.ok ? saved.entry.id : "";
  let session = 0;
  const helper = {
    startAudio: vi.fn(async () => ({
      startedAt: 1,
      sampleRate: 16000 as const,
      channels: 1 as const,
      deviceName: "Mic",
    })),
    stopAudio: vi.fn(async () => {
      const file = path.join(dir, `raw-${++session}.pcm`);
      writeFileSync(file, Buffer.alloc(recordedMs * 32, 1));
      return {
        durationMs: recordedMs,
        samples: recordedMs * 16,
        peakDb: -6,
        meanDb: -20,
        silent: false,
        audioFile: { path: file, codec: "pcm_s16le" as const, bytes: recordedMs * 32 },
      };
    }),
    cancelAudio: vi.fn(async () => ({ discarded: true })),
  };
  const clips = createClipRecorder({
    helper,
    dictionary,
    dir: path.join(dir, `clips-${recordedMs}`),
    isDictating: () => false,
    deviceId: () => null,
    newSessionId: () => "clip-1",
    clock,
    logger: createTestLogger(),
  });
  return { clips, dictionary, entryId, clock, helper };
}

describe("pronunciation clips", () => {
  it("writes a valid WAV header", () => {
    const wav = pcmToWav(Buffer.alloc(320));
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt32LE(40)).toBe(320);
  });

  it("stops by itself at 3 s, keeps at most 3 s, and plays back", async () => {
    const { clips, dictionary, entryId, clock, helper } = setup(4_000);
    expect(await clips.start(entryId)).toEqual({ ok: true, durationMs: 0 });
    await clock.advance(CLIP_MAX_MS);
    await flush();
    expect(helper.stopAudio).toHaveBeenCalledOnce();
    expect(await clips.stop()).toEqual({ ok: true, durationMs: 3000 });
    const file = dictionary.clipPath(entryId)!;
    expect(readFileSync(file).length).toBe(44 + 3000 * 32);
    expect(dictionary.list()[0]!.hasClip).toBe(true);
    expect(await clips.play(entryId)).toMatch(/^data:audio\/wav;base64,/);
  });

  it("deletes the file with its entry, and refuses a clip that is too short", async () => {
    const { clips, dictionary, entryId } = setup(1_500);
    await clips.start(entryId);
    expect(await clips.stop()).toEqual({ ok: true, durationMs: 1500 });
    const file = dictionary.clipPath(entryId)!;
    await clips.remove(entryId);
    expect(existsSync(file)).toBe(false);
    expect(dictionary.clipPath(entryId)).toBeNull();

    const short = setup(100);
    await short.clips.start(short.entryId);
    expect(await short.clips.stop()).toEqual({ ok: false, message: "Too short. Try again." });
  });
});
