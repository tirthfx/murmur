import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  INSTRUCT_LIMITS,
  type InstructOutcome,
  type InstructThread,
  type InstructThreadSummary,
} from "@murmur/shared";

export interface InstructTurnInput {
  instruction: string;
  draft: string | null;
  modelId: string;
  appBundleId: string | null;
  durationMs: number | null;
}

export interface InstructThreadStore {
  /** A new thread, empty until its first turn. */
  create(appBundleId: string | null): string;
  /** Saves a request and its draft; the thread's title is its first request. */
  addTurn(threadId: string, turn: InstructTurnInput): void;
  /** Regenerate, or a context chip: the last turn's draft is replaced. */
  updateLastDraft(threadId: string, draft: string): void;
  /** What became of the thread's last draft. */
  setOutcome(threadId: string, outcome: InstructOutcome): void;
  /** Newest first. An empty query lists all; otherwise any request or draft containing it. */
  list(query: string, limit?: number): InstructThreadSummary[];
  get(id: string): InstructThread | null;
  delete(id: string): void;
  deleteAll(): void;
  /**
   * Removes the text of threads older than 30 days (their counts stay), then the oldest
   * threads beyond 1,000. Returns how many threads lost their text and how many were deleted.
   */
  applyRetention(): { textRemoved: number; deleted: number };
}

interface ThreadRow {
  id: string;
  created_at: number;
  updated_at: number;
  app_bundle_id: string | null;
  title: string;
  final_draft: string | null;
  turn_count: number;
  outcome: InstructOutcome;
  text_removed: number;
}

interface TurnRow {
  seq: number;
  created_at: number;
  instruction_text: string;
  draft_text: string | null;
}

function summary(row: ThreadRow): InstructThreadSummary {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appBundleId: row.app_bundle_id,
    title: row.title,
    finalDraft: row.final_draft,
    turnCount: row.turn_count,
    outcome: row.outcome,
    textRemoved: row.text_removed === 1,
  };
}

/** Instruct threads and their turns (RW-12, RW-14). Text never goes to the log. */
export function createInstructThreadStore(
  db: DatabaseSync,
  now: () => number = Date.now,
  newId: () => string = randomUUID,
): InstructThreadStore {
  const insertThread = db.prepare(
    "INSERT INTO instruct_threads (id, created_at, updated_at, app_bundle_id) VALUES (?, ?, ?, ?)",
  );
  const insertTurn = db.prepare(
    `INSERT INTO instruct_history (id, thread_id, seq, created_at, instruction_text, model_id,
       draft_text, app_bundle_id, duration_ms)
     VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM instruct_history WHERE thread_id = ?),
       ?, ?, ?, ?, ?, ?)`,
  );
  const touchThread = db.prepare(
    `UPDATE instruct_threads SET updated_at = ?, turn_count = turn_count + 1, final_draft = ?,
       title = CASE WHEN turn_count = 0 THEN ? ELSE title END, outcome = 'pending'
     WHERE id = ?`,
  );
  const lastDraft = db.prepare(
    `UPDATE instruct_history SET draft_text = ?
     WHERE thread_id = ? AND seq = (SELECT MAX(seq) FROM instruct_history WHERE thread_id = ?)`,
  );
  const threadDraft = db.prepare(
    "UPDATE instruct_threads SET final_draft = ?, updated_at = ? WHERE id = ?",
  );
  const threadOutcome = db.prepare(
    "UPDATE instruct_threads SET outcome = ?, updated_at = ? WHERE id = ?",
  );
  const lastTurnOutcome = db.prepare(
    `UPDATE instruct_history SET action_taken = ?
     WHERE thread_id = ? AND seq = (SELECT MAX(seq) FROM instruct_history WHERE thread_id = ?)`,
  );
  const listAll = db.prepare(
    "SELECT * FROM instruct_threads ORDER BY updated_at DESC, rowid DESC LIMIT ?",
  );
  const search = db.prepare(
    `SELECT * FROM instruct_threads t
     WHERE instr(lower(t.title), lower(?1)) > 0
        OR instr(lower(COALESCE(t.final_draft, '')), lower(?1)) > 0
        OR EXISTS (SELECT 1 FROM instruct_history h WHERE h.thread_id = t.id AND (
             instr(lower(h.instruction_text), lower(?1)) > 0
             OR instr(lower(COALESCE(h.draft_text, '')), lower(?1)) > 0))
     ORDER BY t.updated_at DESC, t.rowid DESC LIMIT ?2`,
  );
  const getThread = db.prepare("SELECT * FROM instruct_threads WHERE id = ?");
  const getTurns = db.prepare(
    `SELECT seq, created_at, instruction_text, draft_text FROM instruct_history
     WHERE thread_id = ? ORDER BY seq`,
  );
  const deleteThread = db.prepare("DELETE FROM instruct_threads WHERE id = ?");
  const deleteAllThreads = db.prepare("DELETE FROM instruct_threads");
  const oldTurns = db.prepare(
    `DELETE FROM instruct_history WHERE thread_id IN
       (SELECT id FROM instruct_threads WHERE text_removed = 0 AND updated_at < ?)`,
  );
  const oldThreads = db.prepare(
    `UPDATE instruct_threads SET title = '', final_draft = NULL, text_removed = 1
     WHERE text_removed = 0 AND updated_at < ?`,
  );
  const overflow = db.prepare(
    `DELETE FROM instruct_threads WHERE id IN (SELECT id FROM instruct_threads
       ORDER BY updated_at DESC, rowid DESC LIMIT -1 OFFSET ?)`,
  );

  return {
    create(appBundleId) {
      const id = newId();
      const at = now();
      insertThread.run(id, at, at, appBundleId);
      return id;
    },
    addTurn(threadId, turn) {
      const at = now();
      db.exec("BEGIN");
      try {
        insertTurn.run(
          newId(),
          threadId,
          threadId,
          at,
          turn.instruction,
          turn.modelId,
          turn.draft,
          turn.appBundleId,
          turn.durationMs,
        );
        touchThread.run(at, turn.draft, turn.instruction, threadId);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    updateLastDraft(threadId, draft) {
      lastDraft.run(draft, threadId, threadId);
      threadDraft.run(draft, now(), threadId);
    },
    setOutcome(threadId, outcome) {
      threadOutcome.run(outcome, now(), threadId);
      lastTurnOutcome.run(outcome, threadId, threadId);
    },
    list(query, limit = 200) {
      const trimmed = query.trim();
      const rows = trimmed === "" ? listAll.all(limit) : search.all(trimmed, limit);
      return (rows as unknown as ThreadRow[]).map(summary);
    },
    get(id) {
      const row = getThread.get(id) as unknown as ThreadRow | undefined;
      if (!row) return null;
      const turns = (getTurns.all(id) as unknown as TurnRow[]).map((turn) => ({
        seq: turn.seq,
        createdAt: turn.created_at,
        instruction: turn.instruction_text,
        draft: turn.draft_text,
      }));
      return { ...summary(row), turns };
    },
    delete(id) {
      deleteThread.run(id);
    },
    deleteAll() {
      deleteAllThreads.run();
    },
    applyRetention() {
      const cutoff = now() - INSTRUCT_LIMITS.keepDays * 24 * 60 * 60_000;
      db.exec("BEGIN");
      try {
        oldTurns.run(cutoff);
        const textRemoved = Number(oldThreads.run(cutoff).changes);
        const deleted = Number(overflow.run(INSTRUCT_LIMITS.maxThreads).changes);
        db.exec("COMMIT");
        return { textRemoved, deleted };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
