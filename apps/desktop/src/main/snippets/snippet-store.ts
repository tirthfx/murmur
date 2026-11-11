import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  isRich,
  richDocSchema,
  richToPlain,
  SNIPPET_LIMITS,
  type RichDoc,
  type Snippet,
  type SnippetInput,
  type SnippetSaveResult,
} from "@murmur/shared";

export interface SnippetStore {
  list(): Snippet[];
  save(input: SnippetInput): SnippetSaveResult;
  remove(id: string): void;
  recordUse(id: string): void;
}

interface Row {
  id: string;
  trigger_phrase: string;
  body: string;
  body_format: "plain" | "rich_json";
  use_count: number;
  created_at: number;
  updated_at: number;
}

function toSnippet(row: Row): Snippet {
  let rich: RichDoc | null = null;
  if (row.body_format === "rich_json") {
    const parsed = richDocSchema.safeParse(JSON.parse(row.body));
    rich = parsed.success ? parsed.data : null;
  }
  return {
    id: row.id,
    trigger: row.trigger_phrase,
    format: rich ? "rich_json" : "plain",
    plain: rich ? richToPlain(rich) : row.body,
    rich,
    useCount: row.use_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Lower case, letters and digits only, single spaces: how triggers are compared. */
export function normaliseTrigger(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function createSnippetStore(
  db: DatabaseSync,
  now: () => number = Date.now,
  newId: () => string = randomUUID,
): SnippetStore {
  const all = db.prepare(
    "SELECT * FROM snippets WHERE scope_team_id IS NULL ORDER BY trigger_phrase COLLATE NOCASE",
  );
  const byId = db.prepare("SELECT * FROM snippets WHERE id = ?");
  const count = db.prepare("SELECT count(*) AS n FROM snippets WHERE scope_team_id IS NULL");
  const insert = db.prepare(
    `INSERT INTO snippets (id, trigger_phrase, body, body_format, scope_team_id, use_count,
       created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 0, ?, ?)`,
  );
  const update = db.prepare(
    "UPDATE snippets SET trigger_phrase = ?, body = ?, body_format = ?, updated_at = ? WHERE id = ?",
  );
  const remove = db.prepare("DELETE FROM snippets WHERE id = ?");
  const use = db.prepare("UPDATE snippets SET use_count = use_count + 1 WHERE id = ?");
  const refuse = (
    reason: Exclude<SnippetSaveResult, { ok: true }>["reason"],
    message: string,
  ): SnippetSaveResult => ({ ok: false, reason, message });

  const list = () => (all.all() as unknown as Row[]).map(toSnippet);

  return {
    list,

    save(input) {
      const trigger = input.trigger.trim().replace(/\s+/g, " ");
      if (normaliseTrigger(trigger) === "")
        return refuse("empty-trigger", "Type the trigger phrase first.");
      if (
        trigger.length < SNIPPET_LIMITS.triggerMin ||
        trigger.length > SNIPPET_LIMITS.triggerMax
      ) {
        return refuse(
          "trigger-length",
          `A trigger is ${SNIPPET_LIMITS.triggerMin} to ${SNIPPET_LIMITS.triggerMax} characters.`,
        );
      }
      // A document without marks, links or lists is stored as plain text.
      const rich = input.rich && isRich(input.rich) ? input.rich : null;
      const plain = rich ? richToPlain(rich) : input.rich ? richToPlain(input.rich) : input.plain;
      if (plain.trim() === "") return refuse("empty-body", "Type the text the trigger inserts.");
      const body = rich ? JSON.stringify(rich) : plain;
      if (Buffer.byteLength(body, "utf8") > SNIPPET_LIMITS.bodyBytes) {
        return refuse(
          "too-large",
          `A snippet can be at most ${SNIPPET_LIMITS.bodyBytes / 1024} KB.`,
        );
      }
      const current = input.id ? (byId.get(input.id) as Row | undefined) : undefined;
      if (input.id && !current) return refuse("not-found", "This snippet no longer exists.");
      const key = normaliseTrigger(trigger);
      const clash = list().find(
        (snippet) => snippet.id !== input.id && normaliseTrigger(snippet.trigger) === key,
      );
      if (clash) return refuse("duplicate", `"${clash.trigger}" is already a trigger.`);
      if (!current && (count.get() as { n: number }).n >= SNIPPET_LIMITS.snippets) {
        return refuse(
          "full",
          `At most ${SNIPPET_LIMITS.snippets.toLocaleString("en")} snippets can be saved.`,
        );
      }
      const at = now();
      const format = rich ? "rich_json" : "plain";
      const id = current ? current.id : newId();
      if (current) update.run(trigger, body, format, at, id);
      else insert.run(id, trigger, body, format, at, at);
      return { ok: true, snippet: toSnippet(byId.get(id) as unknown as Row) };
    },

    remove(id) {
      remove.run(id);
    },

    recordUse(id) {
      use.run(id);
    },
  };
}
