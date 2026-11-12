import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type RewriteOutcome = "replaced" | "copied" | "discarded" | "failed";

export interface RewriteRunInput {
  rewriteId: string;
  rewriteName: string;
  sourceText: string;
  outputText: string | null;
  outcome: RewriteOutcome;
  appBundleId: string | null;
  durationMs: number | null;
}

export interface RewriteRun extends RewriteRunInput {
  id: string;
  sourceTruncated: boolean;
  createdAt: number;
}

export interface RewriteRunStore {
  record(run: RewriteRunInput): void;
  /** Newest first. */
  recent(limit: number): RewriteRun[];
  /** Cuts the source text of runs older than 7 days to 200 characters. Returns how many. */
  trimOld(): number;
}

/** Source text is kept whole this long (RW-01 storage rule). */
export const RUN_SOURCE_DAYS = 7;
export const RUN_SOURCE_KEEP_CHARS = 200;

interface Row {
  id: string;
  rewrite_id: string | null;
  rewrite_name: string;
  source_text: string;
  source_truncated: number;
  output_text: string | null;
  outcome: RewriteOutcome;
  app_bundle_id: string | null;
  created_at: number;
  duration_ms: number | null;
}

export function createRewriteRunStore(
  db: DatabaseSync,
  now: () => number = Date.now,
  newId: () => string = randomUUID,
): RewriteRunStore {
  const insert = db.prepare(
    `INSERT INTO rewrite_runs (id, rewrite_id, rewrite_name, source_text, output_text, outcome,
       app_bundle_id, created_at, duration_ms)
     VALUES (?, (SELECT id FROM rewrites WHERE id = ?), ?, ?, ?, ?, ?, ?, ?)`,
  );
  const recent = db.prepare(
    "SELECT * FROM rewrite_runs ORDER BY created_at DESC, rowid DESC LIMIT ?",
  );
  const trim = db.prepare(
    `UPDATE rewrite_runs SET source_text = substr(source_text, 1, ?), source_truncated = 1
     WHERE source_truncated = 0 AND created_at < ?`,
  );
  return {
    record(run) {
      insert.run(
        newId(),
        run.rewriteId,
        run.rewriteName,
        run.sourceText,
        run.outputText,
        run.outcome,
        run.appBundleId,
        now(),
        run.durationMs,
      );
    },
    recent(limit) {
      return (recent.all(limit) as unknown as Row[]).map((row) => ({
        id: row.id,
        rewriteId: row.rewrite_id ?? "",
        rewriteName: row.rewrite_name,
        sourceText: row.source_text,
        sourceTruncated: row.source_truncated === 1,
        outputText: row.output_text,
        outcome: row.outcome,
        appBundleId: row.app_bundle_id,
        createdAt: row.created_at,
        durationMs: row.duration_ms,
      }));
    },
    trimOld() {
      const cutoff = now() - RUN_SOURCE_DAYS * 24 * 60 * 60_000;
      return Number(trim.run(RUN_SOURCE_KEEP_CHARS, cutoff).changes);
    },
  };
}
