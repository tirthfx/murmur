import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { DictationRecord } from "../recorder";

/** How long a recording stays on disk for retry: the helper prunes its temporary audio after a day. */
export const AUDIO_RETENTION_MS = 24 * 60 * 60_000;

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
      press_enter, audio_path, audio_expires_at, retry_of
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`);
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

  function relative(file: string): string {
    const inside = path.relative(audioRoot, file);
    return inside.startsWith("..") || path.isAbsolute(inside) ? file : inside;
  }

  return {
    add(record) {
      const rowId = id();
      const audioPath = record.audio ? relative(record.audio.path) : null;
      const expires = record.audio ? record.createdAt + AUDIO_RETENTION_MS : null;
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
          audioPath,
          expires,
          record.retryOf,
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
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return rowId;
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
}
