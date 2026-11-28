import type { DatabaseSync } from "node:sqlite";
import {
  PRESETS,
  type AppCategory,
  type AppCategoryOverride,
  type KnownApp,
  type Style,
  type StyleCategory,
  type StylesView,
  type StyleUpdate,
} from "@murmur/shared";
import { DEFAULT_APP_CATEGORIES, resolveCategory, type CategorySource } from "./app-categories";

/** What a dictation uses: its category, the style for it, and how the category was found. */
export interface ResolvedStyle {
  category: AppCategory;
  source: CategorySource;
  style: Style;
}

export interface StyleStore {
  view(): StylesView;
  update(update: StyleUpdate): Style;
  setOverride(override: AppCategoryOverride): void;
  clearOverride(bundleId: string): void;
  /** `category`, when given, is used instead of the app's (a coding CLI found, PZ-28). */
  resolve(
    app: { bundleId: string | null; windowTitle: string | null },
    category?: AppCategory,
  ): ResolvedStyle;
}

interface StyleRow {
  id: string;
  context_kind: StyleCategory;
  preset: Style["preset"];
  instructions: string | null;
  updated_at: number;
}

const toStyle = (row: StyleRow): Style => ({
  id: row.id,
  category: row.context_kind,
  preset: row.preset,
  instructions: row.instructions ?? "",
  updatedAt: row.updated_at,
});

/** Developer apps use the Other style until the developer features have their own (PZ-26). */
const STYLE_FOR: Record<AppCategory, StyleCategory> = {
  personal: "personal",
  work: "work",
  email: "email",
  other: "other",
  developer: "other",
};

export function createStyleStore(db: DatabaseSync, now: () => number = Date.now): StyleStore {
  const styles = db.prepare(
    "SELECT id, context_kind, preset, instructions, updated_at FROM styles WHERE is_default = 1 ORDER BY sort_order",
  );
  const updateStyle = db.prepare(
    `UPDATE styles SET preset = ?, capitalisation = ?, punctuation = ?, emphasis = ?,
       instructions = ?, updated_at = ? WHERE context_kind = ? AND is_default = 1`,
  );
  const overrides = db.prepare(
    "SELECT bundle_id, app_name, category FROM app_categories WHERE source = 'user' ORDER BY app_name, bundle_id",
  );
  const upsert = db.prepare(
    `INSERT INTO app_categories (bundle_id, app_name, category, source, updated_at)
       VALUES (?, ?, ?, 'user', ?)
     ON CONFLICT (bundle_id) DO UPDATE SET app_name = excluded.app_name,
       category = excluded.category, source = 'user', updated_at = excluded.updated_at`,
  );
  const remove = db.prepare("DELETE FROM app_categories WHERE bundle_id = ?");
  const recent = db.prepare(
    `SELECT app_bundle_id AS bundle_id, max(app_name) AS app_name FROM history
       WHERE app_bundle_id IS NOT NULL GROUP BY app_bundle_id
       ORDER BY max(created_at) DESC LIMIT 30`,
  );

  let cachedOverrides: Map<string, AppCategory> | null = null;
  const overrideMap = () => {
    cachedOverrides ??= new Map(
      (overrides.all() as unknown as { bundle_id: string; category: AppCategory }[]).map((row) => [
        row.bundle_id,
        row.category,
      ]),
    );
    return cachedOverrides;
  };
  const allStyles = () => (styles.all() as unknown as StyleRow[]).map(toStyle);

  return {
    view() {
      const map = overrideMap();
      const recentApps: KnownApp[] = (
        recent.all() as unknown as { bundle_id: string; app_name: string | null }[]
      ).map((row) => {
        const chosen = map.get(row.bundle_id);
        const known = DEFAULT_APP_CATEGORIES[row.bundle_id];
        return {
          bundleId: row.bundle_id,
          appName: row.app_name,
          category: chosen ?? known ?? "other",
          source: chosen ? "user" : known ? "default" : "unknown",
        };
      });
      return {
        styles: allStyles(),
        overrides: (
          overrides.all() as unknown as {
            bundle_id: string;
            app_name: string | null;
            category: AppCategory;
          }[]
        ).map((row) => ({
          bundleId: row.bundle_id,
          appName: row.app_name,
          category: row.category,
        })),
        recentApps,
      };
    },

    update({ category, preset, instructions }) {
      const flags = PRESETS[preset].flags;
      updateStyle.run(
        preset,
        flags.capitalisation,
        flags.punctuation,
        flags.emphasis,
        instructions.trim() === "" ? null : instructions.trim(),
        now(),
        category,
      );
      return allStyles().find((style) => style.category === category)!;
    },

    setOverride({ bundleId, appName, category }) {
      upsert.run(bundleId, appName, category, now());
      cachedOverrides = null;
    },

    clearOverride(bundleId) {
      remove.run(bundleId);
      cachedOverrides = null;
    },

    resolve(app, forced) {
      const found = resolveCategory(app, overrideMap());
      const category = forced ?? found.category;
      const source = found.source;
      const wanted = STYLE_FOR[category];
      const list = allStyles();
      const style =
        list.find((candidate) => candidate.category === wanted) ??
        list.find((candidate) => candidate.category === "other")!;
      return { category, source, style };
    },
  };
}
