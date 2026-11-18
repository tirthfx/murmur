import type { DatabaseSync } from "node:sqlite";
import type { RetentionView } from "@murmur/shared";

/** One rule of the daily job: removes what has expired and says how many. */
export type RetentionRule = (now: number) => number;

export interface RetentionJob {
  /** Runs every rule now and records the counts. */
  run(now: number): Record<string, number>;
  /** Runs when the last run is a day old (or there was none). */
  runIfDue(now: number): Record<string, number> | null;
  view(): RetentionView;
}

const DAY_MS = 24 * 60 * 60_000;
const NAME = "daily";

/**
 * HB-50: the daily retention job. Each rule removes rows (and files) past their time. A rule
 * that throws is reported as -1 and the others still run. Dictionary, Snippets, Styles,
 * Memory and Scratchpad notes have no rule: retention never touches them.
 */
export function createRetentionJob(
  db: DatabaseSync,
  rules: Record<string, RetentionRule>,
  logger: { warn(message: string): void } = console,
): RetentionJob {
  function last(): { at: number; removed: Record<string, number> } | null {
    const row = db
      .prepare("SELECT last_run_at, last_result FROM retention_jobs WHERE name = ?")
      .get(NAME) as { last_run_at: number; last_result: string } | undefined;
    if (!row) return null;
    try {
      return {
        at: row.last_run_at,
        removed: JSON.parse(row.last_result) as Record<string, number>,
      };
    } catch {
      return { at: row.last_run_at, removed: {} };
    }
  }

  const job: RetentionJob = {
    run(now) {
      const removed: Record<string, number> = {};
      for (const [name, rule] of Object.entries(rules)) {
        try {
          removed[name] = rule(now);
        } catch (error) {
          removed[name] = -1;
          logger.warn(`[retention] ${name} failed: ${String(error)}`);
        }
      }
      db.prepare(
        `INSERT INTO retention_jobs (name, last_run_at, last_result) VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET last_run_at = excluded.last_run_at,
          last_result = excluded.last_result`,
      ).run(NAME, now, JSON.stringify(removed));
      return removed;
    },
    runIfDue(now) {
      const previous = last();
      return previous && now - previous.at < DAY_MS ? null : job.run(now);
    },
    view() {
      const previous = last();
      return {
        lastRunAt: previous?.at ?? null,
        nextRunAt: previous ? previous.at + DAY_MS : null,
        removed: previous?.removed ?? {},
      };
    },
  };
  return job;
}

/** Rules on tables the history store does not own. */
export function tableRules(db: DatabaseSync): Record<string, RetentionRule> {
  const deleteBefore = (sql: string, ageMs: number) => (now: number) =>
    Number(db.prepare(sql).run(now - ageMs).changes);
  return {
    /** HB-50: unreviewed learned Dictionary candidates go after 90 days. */
    learnedCandidates: deleteBefore("DELETE FROM learn_candidates WHERE last_at < ?", 90 * DAY_MS),
    /** HB-50: per-dictation voice samples go after 30 days (the profile itself stays). */
    voiceSamples: deleteBefore("DELETE FROM voice_samples WHERE created_at < ?", 30 * DAY_MS),
  };
}
