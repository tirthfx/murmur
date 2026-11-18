import type { DatabaseSync } from "node:sqlite";
import {
  BEST_WEEK_PREFIX,
  MILESTONES,
  milestoneDetail,
  milestoneTitle,
  reachedMilestones,
  streaks,
  type InsightsDay,
  type Milestone,
} from "@murmur/shared";

export interface MilestonesStore {
  /**
   * Records milestones reached since the last check and returns the new keys. The very first
   * check records what was already reached without returning it, so a first run after an
   * update does not announce a backlog.
   */
  check(days: InsightsDay[], today: string, now: number): string[];
  /** Every milestone, reached or not, for the Insights page; best weeks newest first. */
  list(): Milestone[];
  /** The Insights page showed the new ones. */
  markSeen(now: number): void;
}

const SEEDED = "milestones.seeded";

function tableExists(db: DatabaseSync, name: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  );
}

function count(db: DatabaseSync, sql: string): number {
  return (db.prepare(sql).get() as { n: number }).n;
}

/** `milestones` (migration 0019). Counts come from Insights, Rewrites and notes. */
export function createMilestonesStore(db: DatabaseSync): MilestonesStore {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO milestones (key, achieved_at, shown_at) VALUES (?, ?, NULL)",
  );

  function recorded(): Map<string, { achievedAt: number; shownAt: number | null }> {
    const rows = db.prepare("SELECT key, achieved_at, shown_at FROM milestones").all() as {
      key: string;
      achieved_at: number;
      shown_at: number | null;
    }[];
    return new Map(
      rows.map((row) => [row.key, { achievedAt: row.achieved_at, shownAt: row.shown_at }]),
    );
  }

  return {
    check(days, today, now) {
      const done = recorded();
      const reached = reachedMilestones(
        {
          days,
          longestStreak: streaks(
            days.filter((day) => day.dictations > 0).map((day) => day.date),
            today,
          ).daily.longest,
          rewritesUsed:
            count(
              db,
              "SELECT COUNT(*) AS n FROM rewrite_runs WHERE outcome IN ('replaced', 'copied')",
            ) +
            count(db, "SELECT COUNT(*) AS n FROM history WHERE auto_rewrite_status = 'applied'"),
          customRewrites: count(db, "SELECT COUNT(*) AS n FROM rewrites WHERE builtin_key IS NULL"),
          notes: tableExists(db, "notes") ? count(db, "SELECT COUNT(*) AS n FROM notes") : 0,
          today,
        },
        new Set(done.keys()),
      );
      const seeded =
        db.prepare("SELECT 1 FROM insights_meta WHERE key = ?").get(SEEDED) !== undefined;
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const key of reached) insert.run(key, now);
        if (!seeded) {
          db.prepare("INSERT OR IGNORE INTO insights_meta (key, value) VALUES (?, ?)").run(
            SEEDED,
            String(now),
          );
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return seeded ? reached : [];
    },
    list() {
      const done = recorded();
      const fixed = MILESTONES.map((item): Milestone => {
        const row = done.get(item.key);
        return {
          key: item.key,
          title: item.title,
          detail: item.description,
          achievedAt: row?.achievedAt ?? null,
          isNew: row !== undefined && row.shownAt === null,
        };
      });
      const weeks = [...done]
        .filter(([key]) => key.startsWith(BEST_WEEK_PREFIX))
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([key, row]): Milestone => ({
          key,
          title: milestoneTitle(key),
          detail: milestoneDetail(key),
          achievedAt: row.achievedAt,
          isNew: row.shownAt === null,
        }));
      return [...fixed, ...weeks];
    },
    markSeen(now) {
      db.prepare("UPDATE milestones SET shown_at = ? WHERE shown_at IS NULL").run(now);
    },
  };
}
