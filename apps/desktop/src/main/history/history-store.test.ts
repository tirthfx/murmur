import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import type { DictationRecord } from "../recorder";
import { AUDIO_RETENTION_MS, createHistoryStore } from "./history-store";

const audioRoot = "/Users/you/Library/Application Support/Murmur/audio";

function record(overrides: Partial<DictationRecord> = {}): DictationRecord {
  return {
    sessionId: "s1",
    source: "hold",
    createdAt: 1_000,
    durationMs: 4_200,
    language: "en",
    rawText: "Um, so we go at two, actually three.",
    finalText: "So we go at three.",
    wordCount: 5,
    cleanup: {
      text: "So we go at three.",
      source: "model",
      fallback: false,
      reason: null,
      modelMs: 600,
    },
    insertStatus: "inserted",
    insertMethod: "paste_cmd_v",
    errorCode: null,
    audio: { path: `${audioRoot}/tmp/s1.pcm`, codec: "pcm_s16le", durationMs: 4_200 },
    retryOf: null,
    ...overrides,
  };
}

function setup() {
  const db = openDatabase(":memory:");
  let n = 0;
  return { db, store: createHistoryStore(db, audioRoot, () => `id-${++n}`) };
}

describe("history store", () => {
  it("keeps raw and final text, the cleanup outcome and the audio reference", () => {
    const { db, store } = setup();
    const id = store.add(record());
    const [item] = store.list();
    expect(item).toMatchObject({
      id,
      rawText: "Um, so we go at two, actually three.",
      finalText: "So we go at three.",
      wordCount: 5,
      cleanupLevel: "standard",
      cleanupStatus: "applied",
      cleanupFallback: null,
      insertStatus: "inserted",
      insertMethod: "paste_cmd_v",
      audioPath: "tmp/s1.pcm",
    });
    expect(
      db.prepare("SELECT seq, path, codec, duration_ms, expires_at FROM audio_chunks").get(),
    ).toEqual({
      seq: 0,
      path: "tmp/s1.pcm",
      codec: "pcm_s16le",
      duration_ms: 4_200,
      expires_at: 1_000 + AUDIO_RETENTION_MS,
    });
  });

  it("lists the last 200, newest first", () => {
    const { store } = setup();
    for (let i = 0; i < 205; i++)
      store.add(record({ createdAt: i, sessionId: `s${i}`, audio: null }));
    const items = store.list();
    expect(items).toHaveLength(200);
    expect(items[0]!.createdAt).toBe(204);
    expect(items.at(-1)!.createdAt).toBe(5);
    expect(store.list(3).map((item) => item.createdAt)).toEqual([204, 203, 202]);
  });

  it("records a cleanup fallback and its reason", () => {
    const { store } = setup();
    store.add(
      record({
        cleanup: { text: "x", source: "rules", fallback: true, reason: "timeout", modelMs: 1500 },
      }),
    );
    expect(store.list()[0]).toMatchObject({
      cleanupStatus: "skipped_timeout",
      cleanupFallback: "timeout",
    });
  });

  it("records failures and links a retry to the row it retries", () => {
    const { store } = setup();
    const failed = store.add(
      record({
        rawText: null,
        finalText: null,
        cleanup: null,
        insertStatus: "failed",
        errorCode: "TRANSCRIPTION_TIMEOUT",
      }),
    );
    store.add(record({ source: "retry", retryOf: failed, createdAt: 2_000 }));
    const [retry, original] = store.list();
    expect(original).toMatchObject({
      insertStatus: "failed",
      errorCode: "TRANSCRIPTION_TIMEOUT",
      cleanupStatus: "not_run",
    });
    expect(retry).toMatchObject({ source: "retry", retryOf: failed });
  });

  it("gives the last dictated text for paste-last, skipping empty ones", () => {
    const { store } = setup();
    expect(store.lastText()).toBeNull();
    store.add(record());
    store.add(record({ createdAt: 2_000, finalText: "", insertStatus: "empty", wordCount: 0 }));
    expect(store.lastText()).toBe("So we go at three.");
  });

  it("refuses values outside the allowed sets", () => {
    const { store } = setup();
    expect(() => store.add(record({ insertStatus: "teleported" as never }))).toThrow();
    expect(store.list()).toHaveLength(0);
  });
});
