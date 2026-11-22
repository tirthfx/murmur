import type { DatabaseSync } from "node:sqlite";

/**
 * The counts the app keeps beyond dictation (TM-09), as daily totals on this Mac's calendar: the
 * summaries written by a Skill, the Ask threads started and the minutes of meeting audio that
 * have been transcribed. Only numbers are read; no text leaves this module.
 */
export interface DayCounts {
  date: string;
  skills_run: number;
  ask_sessions: number;
  meeting_minutes_processed: number;
}

const LOCAL_DAY = "date(%s / 1000, 'unixepoch', 'localtime')";

export function createUsageCounts(db: DatabaseSync): { daily(): DayCounts[] } {
  const rows = (sql: string) => db.prepare(sql).all() as { day: string; n: number }[];
  return {
    daily() {
      const days = new Map<string, DayCounts>();
      const put = (day: string, key: Exclude<keyof DayCounts, "date">, n: number) => {
        if (n <= 0) return;
        const entry = days.get(day) ?? {
          date: day,
          skills_run: 0,
          ask_sessions: 0,
          meeting_minutes_processed: 0,
        };
        entry[key] = n;
        days.set(day, entry);
      };
      for (const row of rows(
        `SELECT ${LOCAL_DAY.replace("%s", "created_at")} AS day, COUNT(*) AS n
         FROM meeting_summaries WHERE quick = 0 GROUP BY day`,
      ))
        put(row.day, "skills_run", row.n);
      for (const row of rows(
        `SELECT ${LOCAL_DAY.replace("%s", "created_at")} AS day, COUNT(*) AS n
         FROM ask_threads GROUP BY day`,
      ))
        put(row.day, "ask_sessions", row.n);
      for (const row of rows(
        `SELECT ${LOCAL_DAY.replace("%s", "j.updated_at")} AS day,
                CAST(ROUND(SUM(m.duration_ms) / 60000.0) AS INTEGER) AS n
         FROM meeting_jobs j JOIN meetings m ON m.id = j.meeting_id
         WHERE j.kind = 'transcribe' AND j.status = 'done' GROUP BY day`,
      ))
        put(row.day, "meeting_minutes_processed", row.n);
      return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
    },
  };
}
