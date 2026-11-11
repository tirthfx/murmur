import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  MEMORY_LIMITS,
  type MemoryInput,
  type MemoryItem,
  type MemorySaveResult,
} from "@murmur/shared";

export interface MemoryStore {
  list(): MemoryItem[];
  save(input: MemoryInput, source?: MemoryItem["source"]): MemorySaveResult;
  remove(id: string): void;
  /** The enabled items whose keywords occur in the text, within the per-dictation budget. */
  relevant(text: string): MemoryItem[];
}

interface Row {
  id: string;
  text: string;
  keywords_json: string;
  source: MemoryItem["source"];
  enabled: number;
  created_at: number;
  updated_at: number;
}

interface Stored {
  words: string[];
  auto: boolean;
}

const STOP_WORDS = new Set(
  (
    "about above after again also always because been before being below between both could " +
    "does doing down during each every from further have having here into just more most " +
    "never only other ought over same should some such than that their them then there these " +
    "they this those through under until very were what when where which while whom will " +
    "with would your yours prefer please remember"
  ).split(" "),
);

/** Words of four or more letters that are not common words, at most eight. */
export function pickKeywords(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const word = match[0].replace(/['’-]+$/, "");
    if (word.length < 4 || STOP_WORDS.has(word) || /^\d+$/.test(word)) continue;
    seen.add(word);
    if (seen.size >= MEMORY_LIMITS.keywords) break;
  }
  return [...seen];
}

/** Whole-word, case-insensitive; a keyword of several words matches them in a row. */
export function hasKeyword(text: string, keyword: string): boolean {
  const words = keyword
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0 || words[0] === "") return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join("\\s+")}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

function parse(json: string): Stored {
  const value = JSON.parse(json) as Stored | string[];
  return Array.isArray(value) ? { words: value, auto: false } : value;
}

const toItem = (row: Row): MemoryItem => {
  const stored = parse(row.keywords_json);
  return {
    id: row.id,
    text: row.text,
    keywords: stored.words,
    autoKeywords: stored.auto,
    source: row.source,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export function createMemoryStore(
  db: DatabaseSync,
  now: () => number = Date.now,
  newId: () => string = randomUUID,
): MemoryStore {
  const all = db.prepare("SELECT * FROM memory_items ORDER BY created_at DESC, rowid DESC");
  const byId = db.prepare("SELECT * FROM memory_items WHERE id = ?");
  const count = db.prepare("SELECT count(*) AS n FROM memory_items");
  const insert = db.prepare(
    `INSERT INTO memory_items (id, kind, text, keywords_json, source, source_id, created_at,
       updated_at, enabled) VALUES (?, 'fact', ?, ?, ?, NULL, ?, ?, ?)`,
  );
  const update = db.prepare(
    "UPDATE memory_items SET text = ?, keywords_json = ?, enabled = ?, updated_at = ? WHERE id = ?",
  );
  const remove = db.prepare("DELETE FROM memory_items WHERE id = ?");
  const list = () => (all.all() as unknown as Row[]).map(toItem);
  const refuse = (
    reason: Exclude<MemorySaveResult, { ok: true }>["reason"],
    message: string,
  ): MemorySaveResult => ({ ok: false, reason, message });

  return {
    list,

    save(input, source = "manual") {
      const text = input.text.trim().replace(/\s+/g, " ");
      if (text === "") return refuse("empty", "Type the fact first.");
      if (text.length > MEMORY_LIMITS.textLength) {
        return refuse("too-long", `A fact can be at most ${MEMORY_LIMITS.textLength} characters.`);
      }
      const typed = (input.keywords ?? [])
        .map((keyword) => keyword.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, MEMORY_LIMITS.keywords);
      const keywords: Stored =
        typed.length > 0
          ? { words: typed, auto: false }
          : { words: pickKeywords(text), auto: true };
      const current = input.id ? (byId.get(input.id) as Row | undefined) : undefined;
      if (input.id && !current) return refuse("not-found", "This fact no longer exists.");
      if (!current && (count.get() as { n: number }).n >= MEMORY_LIMITS.items) {
        return refuse("full", `Memory holds at most ${MEMORY_LIMITS.items} facts.`);
      }
      const at = now();
      const id = current ? current.id : newId();
      if (current) update.run(text, JSON.stringify(keywords), input.enabled ? 1 : 0, at, id);
      else insert.run(id, text, JSON.stringify(keywords), source, at, at, input.enabled ? 1 : 0);
      return { ok: true, item: toItem(byId.get(id) as unknown as Row) };
    },

    remove(id) {
      remove.run(id);
    },

    relevant(text) {
      const hits = list()
        .filter((item) => item.enabled)
        .map((item) => ({
          item,
          score: item.keywords.filter((keyword) => hasKeyword(text, keyword)).length,
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt);
      const chosen: MemoryItem[] = [];
      let length = 0;
      for (const { item } of hits) {
        if (chosen.length >= MEMORY_LIMITS.perDictation) break;
        if (length + item.text.length > MEMORY_LIMITS.promptChars) break;
        chosen.push(item);
        length += item.text.length;
      }
      return chosen;
    },
  };
}

/** "Remember that I prefer metric units" → "I prefer metric units." Null when not asked. */
export function rememberedFact(text: string): string | null {
  const match = /^\s*remember that[\s,:]+([\s\S]+)$/i.exec(text);
  if (!match) return null;
  let fact = match[1]!.trim().replace(/\s+/g, " ");
  if (fact === "") return null;
  fact = fact[0]!.toUpperCase() + fact.slice(1);
  if (!/[.!?]$/.test(fact)) fact += ".";
  return fact.slice(0, MEMORY_LIMITS.textLength);
}
