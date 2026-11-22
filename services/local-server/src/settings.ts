import type { DatabaseSync } from "node:sqlite";

/** Server settings: a key and one JSON value, with a default when none was saved. */
export function createSettings(db: DatabaseSync, now: () => number) {
  return {
    get<T>(key: string, fallback: T): T {
      const row = db.prepare("SELECT value_json FROM server_settings WHERE key = ?").get(key) as
        { value_json: string } | undefined;
      if (!row) return fallback;
      try {
        return JSON.parse(row.value_json) as T;
      } catch {
        return fallback;
      }
    },
    set(key: string, value: unknown): void {
      db.prepare(
        `INSERT INTO server_settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      ).run(key, JSON.stringify(value), now());
    },
  };
}

export type Settings = ReturnType<typeof createSettings>;
