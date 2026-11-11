import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import type { DictationRecord } from "../recorder";
import {
  AUDIO_RETENTION_MS,
  FAILED_AUDIO_RETENTION_MS,
  KEPT_AUDIO_DIR,
  createHistoryStore,
} from "./history-store";

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

describe("retry and recovery", () => {
  function onDisk() {
    const root = mkdtempSync(path.join(os.tmpdir(), "murmur-history-"));
    const tmp = path.join(root, "tmp");
    mkdirSync(tmp, { recursive: true });
    const db = openDatabase(":memory:");
    let n = 0;
    const store = createHistoryStore(db, root, () => `id-${++n}`);
    const recording = (name: string, bytes = 3_200) => {
      const file = path.join(tmp, `${name}.pcm`);
      writeFileSync(file, Buffer.alloc(bytes));
      return file;
    };
    return {
      root,
      tmp,
      db,
      store,
      recording,
      done: () => rmSync(root, { recursive: true, force: true }),
    };
  }

  it("keeps a failed dictation's audio for a week, outside the helper's folder", () => {
    const { root, store, recording, db, done } = onDisk();
    const file = recording("s1");
    const historyId = store.add(
      record({
        insertStatus: "failed",
        errorCode: "TRANSCRIPTION_FAILED",
        audio: { path: file, codec: "pcm_s16le", durationMs: 100 },
      }),
    );
    const kept = path.join(root, KEPT_AUDIO_DIR, "s1.pcm");
    expect(existsSync(kept)).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(db.prepare("SELECT audio_path, audio_expires_at FROM history").get()).toEqual({
      audio_path: path.join(KEPT_AUDIO_DIR, "s1.pcm"),
      audio_expires_at: 1_000 + FAILED_AUDIO_RETENTION_MS,
    });
    expect(store.lastRetryable(2_000)).toEqual({
      historyId,
      sessionId: "s1",
      createdAt: 1_000,
      durationMs: 4_200,
      audioPath: kept,
    });
    done();
  });

  it("stops offering a row once a retry inserted it, but not after a failed retry", () => {
    const { store, recording, done } = onDisk();
    const failed = store.add(
      record({
        insertStatus: "failed",
        audio: { path: recording("s1"), codec: "pcm_s16le", durationMs: 100 },
      }),
    );
    store.add(
      record({
        sessionId: "s1-r1",
        source: "retry",
        insertStatus: "failed",
        retryOf: failed,
        audio: null,
      }),
    );
    expect(store.isResolved(failed)).toBe(false);
    expect(store.lastRetryable(2_000)?.historyId).toBe(failed);
    store.add(record({ sessionId: "s1-r2", source: "retry", retryOf: failed, audio: null }));
    expect(store.isResolved(failed)).toBe(true);
    expect(store.lastRetryable(2_000)).toBeNull();
    done();
  });

  it("turns recordings left pending by a crash into interrupted rows that can be retried", () => {
    const { root, tmp, store, recording, db, done } = onDisk();
    // Crashed while recording: the helper's file is there, main never heard of a stop.
    store.markPending("live", 5_000);
    recording("live", 64_000);
    // Crashed while transcribing: main knew the file and the length.
    store.markPending("stopped", 6_000);
    store.pendingStopped("stopped", recording("stopped"), 900);
    // Finished normally: nothing to recover.
    store.markPending("done", 7_000);
    store.add(record({ sessionId: "done", audio: null }));

    expect(store.recoverInterrupted(tmp)).toBe(2);
    const rows = db
      .prepare(
        "SELECT session_id, insert_status, error_code, duration_ms, audio_path FROM history ORDER BY created_at",
      )
      .all();
    expect(rows).toEqual([
      expect.objectContaining({ session_id: "done", insert_status: "inserted" }),
      {
        session_id: "live",
        insert_status: "failed",
        error_code: "INTERRUPTED",
        duration_ms: 2_000,
        audio_path: path.join(KEPT_AUDIO_DIR, "live.pcm"),
      },
      {
        session_id: "stopped",
        insert_status: "failed",
        error_code: "INTERRUPTED",
        duration_ms: 900,
        audio_path: path.join(KEPT_AUDIO_DIR, "stopped.pcm"),
      },
    ]);
    expect(existsSync(path.join(root, KEPT_AUDIO_DIR, "live.pcm"))).toBe(true);
    expect(store.recoverInterrupted(tmp)).toBe(0);
    expect(store.lastRetryable(8_000)?.sessionId).toBe("stopped");
    done();
  });

  it("removes audio whose retention passed, and only inside the audio folder", () => {
    const { store, recording, db, done } = onDisk();
    const ok = recording("ok");
    store.add(
      record({ sessionId: "ok", audio: { path: ok, codec: "pcm_s16le", durationMs: 100 } }),
    );
    const outside = path.join(os.tmpdir(), `murmur-outside-${Date.now()}.pcm`);
    writeFileSync(outside, "x");
    store.add(
      record({ sessionId: "out", audio: { path: outside, codec: "pcm_s16le", durationMs: 100 } }),
    );

    expect(store.pruneAudio(1_000 + AUDIO_RETENTION_MS - 1)).toBe(0);
    expect(store.pruneAudio(1_000 + AUDIO_RETENTION_MS + 1)).toBe(1);
    expect(existsSync(ok)).toBe(false);
    expect(existsSync(outside)).toBe(true);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM history WHERE audio_path IS NOT NULL").get(),
    ).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audio_chunks").get()).toEqual({ n: 0 });
    rmSync(outside, { force: true });
    done();
  });
});
