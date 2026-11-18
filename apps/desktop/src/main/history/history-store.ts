import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  HISTORY_LIMITS,
  historyMatchQuery,
  historyQuerySchema,
  type HistoryDeleteResult,
  type HistoryFeedback,
  type HistoryPage,
  type HistoryQuery,
  type HistoryRow,
  type HistoryStatus,
} from "@murmur/shared";
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
  /** One page of the History page (HB-35), newest first. */
  page(query: HistoryQuery): HistoryPage;
  /** Moves rows out of the default list, or back. Returns rows changed. */
  setArchived(ids: string[], archived: boolean): number;
  /** Thumbs up or down and a short note, kept only here. */
  setFeedback(input: HistoryFeedback): void;
  /** Deletes rows, their audio chunks and their audio files (when nothing else uses them). */
  remove(ids: string[]): HistoryDeleteResult;
  /** A failed row whose recording is still on disk, for a retry from the Hub (HB-03). */
  retrySource(id: string): {
    audioPath: string;
    createdAt: number;
    durationMs: number;
    appBundleId: string | null;
    appName: string | null;
  } | null;
  /** Puts a retry's text into the same row; it now counts as left on the clipboard. */
  applyRetry(id: string, text: { rawText: string; finalText: string; wordCount: number }): void;
}

/** SQL for a row's status, matching `HistoryStatus`. */
const STATUS_SQL = `CASE
  WHEN h.error_code = 'INTERRUPTED' THEN 'interrupted'
  WHEN h.insert_status = 'failed' THEN 'failed'
  WHEN h.insert_status = 'empty' THEN 'empty'
  ELSE 'done' END`;

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
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
      press_enter, app_bundle_id, audio_path, audio_expires_at, retry_of, app_name, style_id,
      auto_rewrite_id, auto_rewrite_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
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

  function removeFile(stored: string): boolean {
    const file = absolute(stored);
    if (!insideRoot(file) || !existsSync(file)) return false;
    rmSync(file, { force: true });
    return true;
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
          record.autoRewrite?.rewriteId ?? null,
          record.autoRewrite?.status ?? null,
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
    page(input) {
      const query = historyQuerySchema.parse(input);
      const where: string[] = ["h.archived = ?"];
      const args: (string | number)[] = [query.archived ? 1 : 0];
      const match = historyMatchQuery(query.text);
      if (match) {
        where.push("h.rowid IN (SELECT rowid FROM history_fts WHERE history_fts MATCH ?)");
        args.push(match);
      }
      if (query.from !== null) {
        where.push("h.created_at >= ?");
        args.push(query.from);
      }
      if (query.to !== null) {
        where.push("h.created_at < ?");
        args.push(query.to);
      }
      if (query.app !== null) {
        where.push("h.app_bundle_id = ?");
        args.push(query.app);
      }
      if (query.language !== null) {
        where.push("h.language = ?");
        args.push(query.language);
      }
      if (query.status !== null) {
        where.push(`${STATUS_SQL} = ?`);
        args.push(query.status);
      }
      const clause = where.join(" AND ");
      const total = (
        db.prepare(`SELECT COUNT(*) AS n FROM history h WHERE ${clause}`).get(...args) as {
          n: number;
        }
      ).n;
      const rows = db
        .prepare(
          `SELECT h.id, h.created_at, h.app_name, h.app_bundle_id, ${STATUS_SQL} AS status,
            h.language, h.duration_ms, h.word_count, h.raw_text, h.final_text, h.archived,
            h.feedback, h.feedback_note, h.audio_path
          FROM history h WHERE ${clause}
          ORDER BY h.created_at DESC, h.rowid DESC LIMIT ? OFFSET ?`,
        )
        .all(...args, HISTORY_LIMITS.pageSize, query.offset) as Record<string, unknown>[];
      const apps = db
        .prepare(
          `SELECT app_bundle_id AS bundleId, MAX(COALESCE(app_name, app_bundle_id)) AS name
          FROM history WHERE app_bundle_id IS NOT NULL
          GROUP BY app_bundle_id ORDER BY name COLLATE NOCASE LIMIT 200`,
        )
        .all() as { bundleId: string; name: string }[];
      const languages = (
        db
          .prepare(
            "SELECT DISTINCT language FROM history WHERE language IS NOT NULL ORDER BY language LIMIT 50",
          )
          .all() as { language: string }[]
      ).map((row) => row.language);
      return {
        rows: rows.map((row): HistoryRow => ({
          id: row.id as string,
          createdAt: row.created_at as number,
          appName: (row.app_name as string | null) ?? null,
          appBundleId: (row.app_bundle_id as string | null) ?? null,
          status: row.status as HistoryStatus,
          language: (row.language as string | null) ?? null,
          durationMs: row.duration_ms as number,
          wordCount: row.word_count as number,
          rawText: (row.raw_text as string | null) ?? null,
          finalText: (row.final_text as string | null) ?? null,
          archived: row.archived === 1,
          feedback: (row.feedback as "good" | "bad" | null) ?? null,
          feedbackNote: (row.feedback_note as string | null) ?? null,
          hasAudio: row.audio_path !== null,
        })),
        total,
        apps,
        languages,
      };
    },
    setArchived(ids, archived) {
      if (ids.length === 0) return 0;
      const result = db
        .prepare(`UPDATE history SET archived = ? WHERE id IN (${placeholders(ids.length)})`)
        .run(archived ? 1 : 0, ...ids);
      return Number(result.changes);
    },
    setFeedback({ id: rowId, feedback, note }) {
      db.prepare("UPDATE history SET feedback = ?, feedback_note = ? WHERE id = ?").run(
        feedback,
        note && note !== "" ? note : null,
        rowId,
      );
    },
    remove(ids) {
      if (ids.length === 0) return { rows: 0, files: 0 };
      const list = placeholders(ids.length);
      const paths = new Set<string>();
      for (const row of db
        .prepare(
          `SELECT audio_path AS path FROM history WHERE id IN (${list}) AND audio_path IS NOT NULL
          UNION SELECT path FROM audio_chunks WHERE history_id IN (${list})`,
        )
        .all(...ids, ...ids) as { path: string }[]) {
        paths.add(row.path);
      }
      // One statement: audio_chunks rows go with it (ON DELETE CASCADE).
      const rows = Number(
        db.prepare(`DELETE FROM history WHERE id IN (${list})`).run(...ids).changes,
      );
      // Files after the commit; one still used by another row (a retry) stays.
      const used = db.prepare(
        "SELECT 1 FROM history WHERE audio_path = ? UNION SELECT 1 FROM audio_chunks WHERE path = ? LIMIT 1",
      );
      let files = 0;
      for (const stored of paths) {
        if (used.get(stored, stored) !== undefined) continue;
        if (removeFile(stored)) files++;
      }
      return { rows, files };
    },
    retrySource(rowId) {
      const row = db
        .prepare(
          `SELECT audio_path, created_at, duration_ms, app_bundle_id, app_name FROM history
          WHERE id = ? AND insert_status = 'failed' AND audio_path IS NOT NULL`,
        )
        .get(rowId) as Record<string, unknown> | undefined;
      if (!row) return null;
      const audioPath = absolute(row.audio_path as string);
      if (!insideRoot(audioPath) || !existsSync(audioPath)) return null;
      return {
        audioPath,
        createdAt: row.created_at as number,
        durationMs: row.duration_ms as number,
        appBundleId: (row.app_bundle_id as string | null) ?? null,
        appName: (row.app_name as string | null) ?? null,
      };
    },
    applyRetry(rowId, text) {
      db.prepare(
        `UPDATE history SET raw_text = ?, final_text = ?, word_count = ?,
          insert_status = 'clipboard_only', insert_method = 'clipboard', error_code = NULL
        WHERE id = ?`,
      ).run(text.rawText, text.finalText, text.wordCount, rowId);
    },
    lastText() {
      const row = selectLast.get() as { final_text: string } | undefined;
      return row?.final_text ?? null;
    },
  };
  return store;
}
