import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { DictationRecord } from "../recorder";

/** How long a recording stays on disk for retry: the helper prunes its temporary audio after a day. */
export const AUDIO_RETENTION_MS = 24 * 60 * 60_000;
/** Failed and interrupted dictations keep their audio longer, so they can be retried (DC-38). */
export const FAILED_AUDIO_RETENTION_MS = 7 * 24 * 60 * 60_000;
/** Folder under the audio root for kept audio; the helper never clears it. */
export const KEPT_AUDIO_DIR = "kept";

/** A failed dictation whose audio is still on disk and that no retry has resolved. */
export interface RetryableDictation {
  historyId: string;
  sessionId: string;
  createdAt: number;
  durationMs: number;
  /** Absolute path of the 16 kHz PCM file. */
  audioPath: string;
}

export interface HistoryItem {
  id: string;
  createdAt: number;
  source: string;
  durationMs: number;
  language: string | null;
  rawText: string | null;
  finalText: string | null;
  wordCount: number;
  cleanupLevel: string | null;
  cleanupStatus: string;
  cleanupFallback: string | null;
  insertStatus: string;
  insertMethod: string | null;
  errorCode: string | null;
  audioPath: string | null;
  retryOf: string | null;
}

export interface HistoryStore {
  /** Stores one dictation and its audio chunk. Returns the new row id. */
  add(record: DictationRecord): string;
  /** Newest first, at most `limit` (200 by default). */
  list(limit?: number): HistoryItem[];
  /** The most recent dictation with text, for "paste last" and the tray. */
  lastText(): string | null;
  /** The newest failed dictation that can still be retried, or null. */
  lastRetryable(now: number): RetryableDictation | null;
  /** True once a retry of this row inserted text (or found nothing to insert). */
  isResolved(historyId: string): boolean;
  /** Notes a recording that has started; removed when its history row is written. */
  markPending(sessionId: string, createdAt: number): void;
  /** The recording stopped and its audio is in this file. */
  pendingStopped(sessionId: string, audioPath: string, durationMs: number): void;
  clearPending(sessionId: string): void;
  /**
   * Turns recordings left pending by a crash into failed history rows marked INTERRUPTED,
   * keeping their audio. `tmpDir` is where the helper writes recordings. Returns the count.
   */
  recoverInterrupted(tmpDir: string): number;
  /** Deletes audio whose retention has passed and clears its references. Returns files removed. */
  pruneAudio(now: number): number;
}

const FALLBACK: Record<string, string> = {
  "model-missing": "model_missing",
  timeout: "timeout",
  rejected: "rejected",
  error: "error",
};

function cleanupStatus(record: DictationRecord): string {
  const cleanup = record.cleanup;
  if (!cleanup) return "not_run";
  if (cleanup.source === "model") return "applied";
  if (cleanup.reason === "timeout") return "skipped_timeout";
  if (cleanup.reason === "rejected" || cleanup.reason === "error") return "failed";
  if (cleanup.reason === "model-missing") return "not_run";
  return "skipped_disabled";
}

/**
 * The `history` and `audio_chunks` tables. Audio paths are stored relative to the audio
 * folder (`<appData>/Murmur/audio`), as the data model asks.
 */
export function createHistoryStore(
  db: DatabaseSync,
  audioRoot: string,
  id: () => string = randomUUID,
): HistoryStore {
  const insertHistory = db.prepare(`INSERT INTO history (
      id, created_at, session_id, source, language, duration_ms, raw_text, final_text, word_count,
      cleanup_level, cleanup_status, cleanup_fallback, insert_status, insert_method, error_code,
      press_enter, app_bundle_id, audio_path, audio_expires_at, retry_of, app_name, style_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertChunk = db.prepare(`INSERT INTO audio_chunks
      (id, history_id, seq, path, codec, duration_ms, gain_db, expires_at, created_at)
      VALUES (?, ?, 0, ?, ?, ?, NULL, ?, ?)`);
  const select =
    db.prepare(`SELECT id, created_at, source, duration_ms, language, raw_text, final_text,
      word_count, cleanup_level, cleanup_status, cleanup_fallback, insert_status, insert_method,
      error_code, audio_path, retry_of
    FROM history ORDER BY created_at DESC, rowid DESC LIMIT ?`);
  const selectLast = db.prepare(
    "SELECT final_text FROM history WHERE final_text IS NOT NULL AND final_text != '' ORDER BY created_at DESC, rowid DESC LIMIT 1",
  );

  const selectRetryable =
    db.prepare(`SELECT h.id, h.session_id, h.created_at, h.duration_ms, h.audio_path
    FROM history h
    WHERE h.insert_status = 'failed' AND h.audio_path IS NOT NULL AND h.audio_expires_at >= ?
      AND NOT EXISTS (SELECT 1 FROM history r WHERE r.retry_of = h.id
        AND r.insert_status IN ('inserted', 'clipboard_only', 'empty'))
    ORDER BY h.created_at DESC, h.rowid DESC LIMIT 1`);
  const selectResolved = db.prepare(`SELECT 1 FROM history WHERE retry_of = ?
    AND insert_status IN ('inserted', 'clipboard_only', 'empty') LIMIT 1`);
  const upsertPending = db.prepare(`INSERT INTO pending_sessions (session_id, created_at, source)
    VALUES (?, ?, 'hold') ON CONFLICT(session_id) DO NOTHING`);
  const stopPending = db.prepare(
    "UPDATE pending_sessions SET audio_path = ?, duration_ms = ? WHERE session_id = ?",
  );
  const deletePending = db.prepare("DELETE FROM pending_sessions WHERE session_id = ?");
  const selectPending = db.prepare(
    "SELECT session_id, created_at, audio_path, duration_ms FROM pending_sessions ORDER BY created_at",
  );
  const selectExpired = db.prepare(
    "SELECT DISTINCT audio_path FROM history WHERE audio_path IS NOT NULL AND audio_expires_at < ?",
  );
  const selectStillKept = db.prepare(
    "SELECT 1 FROM history WHERE audio_path = ? AND audio_expires_at >= ? LIMIT 1",
  );
  const clearExpired = db.prepare(
    "UPDATE history SET audio_path = NULL WHERE audio_path IS NOT NULL AND audio_expires_at < ?",
  );
  const deleteExpiredChunks = db.prepare("DELETE FROM audio_chunks WHERE expires_at < ?");

  function relative(file: string): string {
    const inside = path.relative(audioRoot, file);
    return inside.startsWith("..") || path.isAbsolute(inside) ? file : inside;
  }

  function absolute(stored: string): string {
    return path.isAbsolute(stored) ? stored : path.join(audioRoot, stored);
  }

  /** Inside the audio root only: a stored path never removes anything else. */
  function insideRoot(file: string): boolean {
    const inside = path.relative(audioRoot, file);
    return inside !== "" && !inside.startsWith("..") && !path.isAbsolute(inside);
  }

  /**
   * Moves a failed dictation's audio out of the helper's temporary folder, which it clears
   * after a day, into the kept folder. Leaves it where it is if the move fails.
   */
  function keep(file: string, sessionId: string): string {
    const target = path.join(audioRoot, KEPT_AUDIO_DIR, `${sessionId}.pcm`);
    if (path.resolve(file) === path.resolve(target) || !existsSync(file)) return file;
    try {
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      renameSync(file, target);
      return target;
    } catch {
      return file;
    }
  }

  const store: HistoryStore = {
    add(record) {
      const rowId = id();
      const failed = record.insertStatus === "failed";
      const file = record.audio
        ? failed
          ? keep(record.audio.path, record.sessionId)
          : record.audio.path
        : null;
      const audioPath = file ? relative(file) : null;
      const expires = record.audio
        ? record.createdAt + (failed ? FAILED_AUDIO_RETENTION_MS : AUDIO_RETENTION_MS)
        : null;
      db.exec("BEGIN IMMEDIATE");
      try {
        insertHistory.run(
          rowId,
          record.createdAt,
          record.sessionId,
          record.source,
          record.language,
          record.durationMs,
          record.rawText,
          record.finalText,
          record.wordCount,
          record.cleanup ? "standard" : null,
          cleanupStatus(record),
          record.cleanup?.reason ? (FALLBACK[record.cleanup.reason] ?? null) : null,
          record.insertStatus,
          record.insertMethod,
          record.errorCode,
          record.pressEnter ? 1 : 0,
          record.appBundleId ?? null,
          audioPath,
          expires,
          record.retryOf,
          record.appName ?? null,
          record.styleId ?? null,
        );
        if (record.audio && audioPath) {
          insertChunk.run(
            id(),
            rowId,
            audioPath,
            record.audio.codec,
            record.audio.durationMs,
            expires,
            record.createdAt,
          );
        }
        deletePending.run(record.sessionId);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return rowId;
    },
    lastRetryable(now) {
      const row = selectRetryable.get(now) as
        | {
            id: string;
            session_id: string;
            created_at: number;
            duration_ms: number;
            audio_path: string;
          }
        | undefined;
      if (!row) return null;
      const audioPath = absolute(row.audio_path);
      if (!existsSync(audioPath)) return null;
      return {
        historyId: row.id,
        sessionId: row.session_id,
        createdAt: row.created_at,
        durationMs: row.duration_ms,
        audioPath,
      };
    },
    isResolved(historyId) {
      return selectResolved.get(historyId) !== undefined;
    },
    markPending(sessionId, createdAt) {
      upsertPending.run(sessionId, createdAt);
    },
    pendingStopped(sessionId, audioPath, durationMs) {
      stopPending.run(audioPath, durationMs, sessionId);
    },
    clearPending(sessionId) {
      deletePending.run(sessionId);
    },
    recoverInterrupted(tmpDir) {
      const rows = selectPending.all() as {
        session_id: string;
        created_at: number;
        audio_path: string | null;
        duration_ms: number;
      }[];
      for (const row of rows) {
        const candidate = row.audio_path ?? path.join(tmpDir, `${row.session_id}.pcm`);
        const present = existsSync(candidate) ? candidate : null;
        // 16 kHz mono 16-bit: 32 bytes per millisecond.
        const durationMs =
          row.duration_ms > 0
            ? row.duration_ms
            : present
              ? Math.floor(statSync(present).size / 32)
              : 0;
        store.add({
          sessionId: row.session_id,
          source: "hold",
          createdAt: row.created_at,
          durationMs,
          language: null,
          rawText: null,
          finalText: null,
          wordCount: 0,
          cleanup: null,
          insertStatus: "failed",
          insertMethod: null,
          errorCode: "INTERRUPTED",
          audio: present ? { path: present, codec: "pcm_s16le", durationMs } : null,
          retryOf: null,
        });
      }
      return rows.length;
    },
    pruneAudio(now) {
      let removed = 0;
      for (const row of selectExpired.all(now) as { audio_path: string }[]) {
        if (selectStillKept.get(row.audio_path, now) !== undefined) continue;
        const file = absolute(row.audio_path);
        if (!insideRoot(file) || !existsSync(file)) continue;
        rmSync(file, { force: true });
        removed++;
      }
      clearExpired.run(now);
      deleteExpiredChunks.run(now);
      return removed;
    },
    list(limit = 200) {
      return (select.all(limit) as Record<string, unknown>[]).map((row) => ({
        id: row.id as string,
        createdAt: row.created_at as number,
        source: row.source as string,
        durationMs: row.duration_ms as number,
        language: row.language as string | null,
        rawText: row.raw_text as string | null,
        finalText: row.final_text as string | null,
        wordCount: row.word_count as number,
        cleanupLevel: row.cleanup_level as string | null,
        cleanupStatus: row.cleanup_status as string,
        cleanupFallback: row.cleanup_fallback as string | null,
        insertStatus: row.insert_status as string,
        insertMethod: row.insert_method as string | null,
        errorCode: row.error_code as string | null,
        audioPath: row.audio_path as string | null,
        retryOf: row.retry_of as string | null,
      }));
    },
    lastText() {
      const row = selectLast.get() as { final_text: string } | undefined;
      return row?.final_text ?? null;
    },
  };
  return store;
}
