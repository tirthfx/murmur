import type { DatabaseSync } from "node:sqlite";
import {
  SETTING_KEYS,
  settingsSchema,
  type HotkeyTrigger,
  type Settings,
  type SettingsPatch,
  type ShortcutSlot,
  type Unsubscribe,
} from "@murmur/shared";

export interface SettingsStore {
  get(): Settings;
  update(patch: SettingsPatch): Settings;
  setShortcut(slot: ShortcutSlot, trigger: HotkeyTrigger | null): Settings;
  onChange(handler: (settings: Settings, changed: (keyof Settings)[]) => void): Unsubscribe;
}

const SLOT_FIELD: Record<ShortcutSlot, "holdShortcut" | "handsFreeShortcut" | "rewriteShortcut"> = {
  hold: "holdShortcut",
  handsFree: "handsFreeShortcut",
  rewrite: "rewriteShortcut",
};

/**
 * Settings in the `settings` table, one row per key, merged over defaults. A stored value
 * that no longer validates is ignored (the default is used). Without a database the
 * settings live in memory for this run.
 */
export function createSettingsStore(
  db: DatabaseSync | null,
  defaults: Settings,
  now: () => number = Date.now,
): SettingsStore {
  const handlers = new Set<(settings: Settings, changed: (keyof Settings)[]) => void>();
  const fields = Object.keys(SETTING_KEYS) as (keyof Settings)[];

  function load(): Settings {
    const current: Record<string, unknown> = { ...defaults };
    if (db) {
      const rows = db.prepare("SELECT key, value_json FROM settings").all() as {
        key: string;
        value_json: string;
      }[];
      const byKey = new Map(rows.map((row) => [row.key, row.value_json]));
      for (const field of fields) {
        const raw = byKey.get(SETTING_KEYS[field]);
        if (raw === undefined) continue;
        try {
          let value = JSON.parse(raw) as unknown;
          // A group of flags stored before a new flag was added keeps its values; the new
          // flag takes its default.
          const fallback = current[field] as unknown;
          if (isPlainObject(value) && isPlainObject(fallback)) {
            const known = Object.fromEntries(
              Object.entries(value).filter(([key]) => key in fallback),
            );
            value = { ...fallback, ...known };
          }
          if (settingsSchema.shape[field].safeParse(value).success) current[field] = value;
        } catch {
          // Unreadable value: keep the default.
        }
      }
      // Before #55 a single language was stored; carry it over once.
      const legacy = byKey.get("speech.language");
      if (!byKey.has(SETTING_KEYS.languages) && legacy !== undefined) {
        try {
          const code = JSON.parse(legacy) as unknown;
          const list = code === "auto" ? [] : [code];
          if (settingsSchema.shape.languages.safeParse(list).success) current.languages = list;
        } catch {
          // Unreadable: keep the default.
        }
      }
    }
    return settingsSchema.parse(current);
  }

  let current = load();
  const write = db?.prepare(
    "INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
  );

  function save(next: Settings): Settings {
    const parsed = settingsSchema.parse(next);
    const changed = fields.filter(
      (field) => JSON.stringify(parsed[field]) !== JSON.stringify(current[field]),
    );
    if (changed.length === 0) return current;
    for (const field of changed)
      write?.run(SETTING_KEYS[field], JSON.stringify(parsed[field]), now());
    current = parsed;
    for (const handler of handlers) handler(current, changed);
    return current;
  }

  return {
    get: () => current,
    update(patch) {
      const defined = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      );
      return save({ ...current, ...defined });
    },
    setShortcut(slot, trigger) {
      if (slot === "hold" && trigger === null) throw new Error("Push to talk always needs a key");
      return save({ ...current, [SLOT_FIELD[slot]]: trigger });
    },
    onChange(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
