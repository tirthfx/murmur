import type { DatabaseSync } from "node:sqlite";
import { INSIGHTS_LIMITS, insightsDaySchema, localDate, type InsightsDay } from "@murmur/shared";

/** What a counted dictation adds to its day. */
export interface InsightsEntry {
  createdAt: number;
  words: number;
  durationMs: number;
  insertStatus: string;
  appBundleId?: string | null;
  appName?: string | null;
}

export interface InsightsStore {
  /** Adds a dictation to its local day; ignored unless it inserted words. */
  record(entry: InsightsEntry): void;
  /** Days from `first` (YYYY-MM-DD) on, or every day. */
  days(first: string | null): InsightsDay[];
  /** Fills the days from history once, for dictations made before Insights existed. */
  backfill(): number;
  /** A small remembered value, such as the week of the last weekly summary. */
  meta(key: string): string | null;
  setMeta(key: string, value: string): void;
}

/** Only dictations that put words somewhere count (HB-36). */
export function counts(entry: InsightsEntry): boolean {
  return (
    (entry.insertStatus === "inserted" || entry.insertStatus === "clipboard_only") &&
    entry.words > 0
  );
}

const BACKFILLED = "backfilled";

/** `insights_daily` (migration 0018). Dates are local calendar days at the time of writing. */
export function createInsightsStore(db: DatabaseSync): InsightsStore {
  const select = db.prepare("SELECT * FROM insights_daily WHERE date = ?");
  const upsert = db.prepare(`INSERT INTO insights_daily
      (date, words, dictations, speech_ms, wpm_words, wpm_ms, apps_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET words = excluded.words, dictations = excluded.dictations,
      speech_ms = excluded.speech_ms, wpm_words = excluded.wpm_words, wpm_ms = excluded.wpm_ms,
      apps_json = excluded.apps_json`);

  function toDay(row: Record<string, unknown>): InsightsDay | null {
    let apps: unknown;
    try {
      apps = JSON.parse(row.apps_json as string);
    } catch {
      apps = {};
    }
    const parsed = insightsDaySchema.safeParse({
      date: row.date,
      words: row.words,
      dictations: row.dictations,
      speechMs: row.speech_ms,
      wpmWords: row.wpm_words,
      wpmMs: row.wpm_ms,
      apps,
    });
    return parsed.success ? parsed.data : null;
  }

  function add(entry: InsightsEntry): void {
    const date = localDate(entry.createdAt);
    const row = select.get(date) as Record<string, unknown> | undefined;
    const day: InsightsDay = (row && toDay(row)) ?? {
      date,
      words: 0,
      dictations: 0,
      speechMs: 0,
      wpmWords: 0,
      wpmMs: 0,
      apps: {},
    };
    const duration = Math.max(0, Math.round(entry.durationMs));
    day.words += entry.words;
    day.dictations += 1;
    day.speechMs += duration;
    if (duration >= INSIGHTS_LIMITS.wpmMinMs) {
      day.wpmWords += entry.words;
      day.wpmMs += duration;
    }
    if (entry.appBundleId) {
      const app = day.apps[entry.appBundleId] ?? { name: null, words: 0, dictations: 0 };
      app.name = entry.appName ?? app.name;
      app.words += entry.words;
      app.dictations += 1;
      day.apps[entry.appBundleId] = app;
    }
    upsert.run(
      day.date,
      day.words,
      day.dictations,
      day.speechMs,
      day.wpmWords,
      day.wpmMs,
      JSON.stringify(day.apps),
    );
  }

  return {
    record(entry) {
      if (counts(entry)) add(entry);
    },
    days(first) {
      const rows = (
        first === null
          ? db.prepare("SELECT * FROM insights_daily ORDER BY date").all()
          : db.prepare("SELECT * FROM insights_daily WHERE date >= ? ORDER BY date").all(first)
      ) as Record<string, unknown>[];
      return rows.flatMap((row) => toDay(row) ?? []);
    },
    meta(key) {
      const row = db.prepare("SELECT value FROM insights_meta WHERE key = ?").get(key) as
        { value: string } | undefined;
      return row?.value ?? null;
    },
    setMeta(key, value) {
      db.prepare(
        "INSERT INTO insights_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(key, value);
    },
    backfill() {
      if (db.prepare("SELECT 1 FROM insights_meta WHERE key = ?").get(BACKFILLED)) return 0;
      const rows = db
        .prepare(
          `SELECT created_at, word_count, duration_ms, insert_status, app_bundle_id, app_name
          FROM history WHERE insert_status IN ('inserted', 'clipboard_only') AND word_count > 0
          ORDER BY created_at`,
        )
        .all() as Record<string, unknown>[];
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const row of rows) {
          add({
            createdAt: row.created_at as number,
            words: row.word_count as number,
            durationMs: row.duration_ms as number,
            insertStatus: row.insert_status as string,
            appBundleId: row.app_bundle_id as string | null,
            appName: row.app_name as string | null,
          });
        }
        db.prepare("INSERT INTO insights_meta (key, value) VALUES (?, ?)").run(
          BACKFILLED,
          String(rows.length),
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return rows.length;
    },
  };
}
