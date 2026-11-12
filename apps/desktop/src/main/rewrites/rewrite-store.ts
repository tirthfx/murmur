import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  BUILTIN_REWRITES,
  REWRITE_CATEGORIES,
  REWRITE_LIMITS,
  type BuiltinRewriteKey,
  type Rewrite,
  type RewriteInput,
  type RewriteSaveResult,
} from "@murmur/shared";

export interface RewriteStore {
  /** Every Rewrite in sort order: built-ins first by default, then the owner's. */
  list(): Rewrite[];
  /** The enabled ones, in order, for the panel. */
  enabled(): Rewrite[];
  get(id: string): Rewrite | null;
  /** Creates or edits a custom Rewrite. */
  save(input: RewriteInput): RewriteSaveResult;
  setEnabled(id: string, enabled: boolean): void;
  /** Moves one place up (-1) or down (+1). */
  move(id: string, step: -1 | 1): void;
  /** A custom copy of any Rewrite, placed after it. */
  duplicate(id: string): RewriteSaveResult;
  /** Custom Rewrites only; deleting drops its shortcut with it. */
  remove(id: string): RewriteSaveResult | null;
  /** Counts a run (RW-01). */
  markUsed(id: string): void;
}

interface Row {
  id: string;
  name: string;
  builtin_key: BuiltinRewriteKey | null;
  prompt: string;
  example: string | null;
  shortcut: string | null;
  enabled: number;
  apply_directly: number;
  auto_apply: number;
  auto_apply_min_words: number | null;
  auto_apply_categories_json: string;
  use_count: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

const builtinId = (key: BuiltinRewriteKey) => `builtin:${key}`;
const descriptionOf = (key: BuiltinRewriteKey | null) =>
  key ? (BUILTIN_REWRITES.find((item) => item.key === key)?.description ?? "") : "";

function categories(json: string): Rewrite["autoApplyCategories"] {
  try {
    const value = JSON.parse(json) as unknown;
    if (!Array.isArray(value)) return [...REWRITE_CATEGORIES];
    return REWRITE_CATEGORIES.filter((category) => value.includes(category));
  } catch {
    return [...REWRITE_CATEGORIES];
  }
}

const toRewrite = (row: Row): Rewrite => ({
  id: row.id,
  name: row.name,
  builtinKey: row.builtin_key,
  description: descriptionOf(row.builtin_key),
  instruction: row.prompt,
  example: row.example,
  enabled: row.enabled === 1,
  sortOrder: row.sort_order,
  shortcut: row.shortcut,
  applyDirectly: row.apply_directly === 1,
  autoApply: row.auto_apply === 1,
  autoApplyMinWords: row.auto_apply_min_words ?? 0,
  autoApplyCategories: categories(row.auto_apply_categories_json),
  useCount: row.use_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Collapses spaces and line breaks in a name. */
const cleanName = (name: string) => name.trim().replace(/\s+/g, " ");

export function createRewriteStore(
  db: DatabaseSync,
  now: () => number = Date.now,
  newId: () => string = randomUUID,
): RewriteStore {
  const all = db.prepare("SELECT * FROM rewrites ORDER BY sort_order, created_at, rowid");
  const byId = db.prepare("SELECT * FROM rewrites WHERE id = ?");
  const byName = db.prepare("SELECT id FROM rewrites WHERE name = ? COLLATE NOCASE");
  const customCount = db.prepare("SELECT count(*) AS n FROM rewrites WHERE builtin_key IS NULL");
  const lastOrder = db.prepare("SELECT coalesce(max(sort_order), -1) AS n FROM rewrites");
  const insert = db.prepare(
    `INSERT INTO rewrites (id, name, builtin_key, prompt, example, enabled, sort_order,
       created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateCustom = db.prepare(
    "UPDATE rewrites SET name = ?, prompt = ?, example = ?, enabled = ?, updated_at = ? WHERE id = ?",
  );
  const updateBuiltin = db.prepare(
    "UPDATE rewrites SET name = ?, prompt = ? WHERE builtin_key = ? AND (name != ? OR prompt != ?)",
  );
  const setEnabled = db.prepare("UPDATE rewrites SET enabled = ?, updated_at = ? WHERE id = ?");
  const setOrder = db.prepare("UPDATE rewrites SET sort_order = ? WHERE id = ?");
  const remove = db.prepare("DELETE FROM rewrites WHERE id = ? AND builtin_key IS NULL");
  const used = db.prepare("UPDATE rewrites SET use_count = use_count + 1 WHERE id = ?");

  // The built-ins follow this app version's wording; the owner's switches and order stay.
  // A built-in whose name clashes with a custom Rewrite keeps its old name until renamed.
  db.exec("BEGIN");
  try {
    for (const [index, builtin] of BUILTIN_REWRITES.entries()) {
      const id = builtinId(builtin.key);
      if (byId.get(id)) {
        try {
          updateBuiltin.run(
            builtin.name,
            builtin.instruction,
            builtin.key,
            builtin.name,
            builtin.instruction,
          );
        } catch {
          // Name taken by a custom Rewrite.
        }
        continue;
      }
      const at = now();
      const taken = byName.get(builtin.name) !== undefined;
      insert.run(
        id,
        taken ? `${builtin.name} (built-in)` : builtin.name,
        builtin.key,
        builtin.instruction,
        null,
        1,
        index,
        at,
        at,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const list = () => (all.all() as unknown as Row[]).map(toRewrite);
  const get = (id: string) => {
    const row = byId.get(id) as Row | undefined;
    return row ? toRewrite(row) : null;
  };
  const refuse = (
    reason: Exclude<RewriteSaveResult, { ok: true }>["reason"],
    message: string,
  ): RewriteSaveResult => ({ ok: false, reason, message });

  /** Renumbers 0..n-1 in the current order, so moves never leave gaps or ties. */
  function renumber(ids: string[]): void {
    db.exec("BEGIN");
    try {
      ids.forEach((id, index) => setOrder.run(index, id));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    list,
    enabled: () => list().filter((rewrite) => rewrite.enabled),
    get,

    save(input) {
      const name = cleanName(input.name);
      const instruction = input.instruction.trim();
      const example = input.example?.trim() || null;
      if (name === "") return refuse("empty-name", "Give the Rewrite a name.");
      if (name.length > REWRITE_LIMITS.name) {
        return refuse("name-too-long", `A name can be at most ${REWRITE_LIMITS.name} characters.`);
      }
      if (instruction === "") return refuse("empty-instruction", "Write the instruction.");
      if (instruction.length > REWRITE_LIMITS.instruction) {
        return refuse(
          "instruction-too-long",
          `An instruction can be at most ${REWRITE_LIMITS.instruction.toLocaleString("en")} characters.`,
        );
      }
      if (example && example.length > REWRITE_LIMITS.example) {
        return refuse(
          "example-too-long",
          `An example can be at most ${REWRITE_LIMITS.example.toLocaleString("en")} characters.`,
        );
      }
      const current = input.id ? (byId.get(input.id) as Row | undefined) : undefined;
      if (input.id && !current) return refuse("not-found", "This Rewrite no longer exists.");
      if (current?.builtin_key) {
        return refuse(
          "built-in",
          "Built-in Rewrites cannot be changed. Duplicate it to make your own.",
        );
      }
      const clash = byName.get(name) as { id: string } | undefined;
      if (clash && clash.id !== current?.id) {
        return refuse("duplicate-name", `There is already a Rewrite called “${name}”.`);
      }
      if (!current && (customCount.get() as { n: number }).n >= REWRITE_LIMITS.custom) {
        return refuse("full", `You can have at most ${REWRITE_LIMITS.custom} custom Rewrites.`);
      }
      const at = now();
      const id = current ? current.id : newId();
      if (current) updateCustom.run(name, instruction, example, input.enabled ? 1 : 0, at, id);
      else {
        const order = (lastOrder.get() as { n: number }).n + 1;
        insert.run(id, name, null, instruction, example, input.enabled ? 1 : 0, order, at, at);
      }
      return { ok: true, rewrite: get(id)! };
    },

    setEnabled(id, enabled) {
      setEnabled.run(enabled ? 1 : 0, now(), id);
    },

    move(id, step) {
      const ids = list().map((rewrite) => rewrite.id);
      const from = ids.indexOf(id);
      const to = from + step;
      if (from < 0 || to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to]!, ids[from]!];
      renumber(ids);
    },

    duplicate(id) {
      const source = get(id);
      if (!source) return refuse("not-found", "This Rewrite no longer exists.");
      let name = `${source.name} copy`.slice(0, REWRITE_LIMITS.name);
      for (let n = 2; byName.get(name) !== undefined; n++) {
        name = `${source.name} copy ${n}`.slice(0, REWRITE_LIMITS.name);
      }
      const result = this.save({
        name,
        instruction: source.instruction,
        example: source.example,
        enabled: true,
      });
      if (!result.ok) return result;
      // Place the copy right after its source.
      const copyId = result.rewrite.id;
      const ids = list()
        .map((rewrite) => rewrite.id)
        .filter((other) => other !== copyId);
      ids.splice(ids.indexOf(id) + 1, 0, copyId);
      renumber(ids);
      return { ok: true, rewrite: get(copyId)! };
    },

    remove(id) {
      const current = get(id);
      if (!current) return null;
      if (current.builtinKey) {
        return refuse("built-in", "Built-in Rewrites cannot be deleted. Switch it off instead.");
      }
      remove.run(id);
      return null;
    },

    markUsed(id) {
      used.run(id);
    },
  };
}
