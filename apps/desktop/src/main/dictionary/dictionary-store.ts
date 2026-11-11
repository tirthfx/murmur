import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  DICTIONARY_LIMITS,
  type DictionaryEntry,
  type DictionaryInput,
  type DictionarySaveResult,
  type DictionarySource,
} from "@murmur/shared";
import type { ReplacementRule, SpellingRule } from "./apply";

/** What the pipeline needs, rebuilt only when the dictionary changes. */
export interface DictionaryRules {
  /** Terms for the speech prompt and cleanup: starred first, then the most used. */
  promptTerms: string[];
  /** How many of `promptTerms` are starred; jargon packs go in after them (PZ-27). */
  starredCount: number;
  /** Terms spelled exactly after recognition and after cleanup. */
  spellings: SpellingRule[];
  /** Most recent first. */
  replacements: ReplacementRule[];
}

export interface DictionaryStore {
  list(): DictionaryEntry[];
  save(input: DictionaryInput, source?: DictionarySource): DictionarySaveResult;
  remove(id: string): void;
  /**
   * Adds many entries in one transaction, all or nothing (bulk import). Duplicates must
   * already be removed by the caller.
   */
  importMany(
    rows: readonly { term: string; replacement: string | null }[],
  ): { ok: true; added: number } | { ok: false; message: string };
  /** A learned phrase (PZ-05): added for review like other learned entries. */
  addPhrase(phrase: string): DictionarySaveResult;
  /** How many learned phrases there are, kept or not. */
  phraseCount(): number;
  /** The pronunciation clip's file, or null (PZ-06). */
  clipPath(id: string): string | null;
  setClip(id: string, path: string | null): void;
  /** Keeps a learned entry: it is no longer marked for review. */
  keep(id: string): void;
  rules(): DictionaryRules;
  /** Adds one use to each entry. */
  recordUses(ids: readonly string[]): void;
  onChange(handler: () => void): () => void;
}

interface Row {
  id: string;
  term: string;
  replacement: string | null;
  case_sensitive: number;
  source: DictionarySource;
  starred: number;
  use_count: number;
  kind: "term" | "phrase";
  sample_path: string | null;
  created_at: number;
  updated_at: number;
}

const toEntry = (row: Row): DictionaryEntry => ({
  id: row.id,
  term: row.term,
  replacement: row.replacement,
  caseSensitive: row.case_sensitive === 1,
  source: row.source,
  starred: row.starred === 1,
  useCount: row.use_count,
  kind: row.kind,
  hasClip: row.sample_path !== null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Spaces inside a term are kept single; nothing else is changed. */
const tidy = (value: string) => value.trim().replace(/\s+/g, " ");

export function createDictionaryStore(
  db: DatabaseSync,
  now: () => number = Date.now,
  newId: () => string = randomUUID,
): DictionaryStore {
  const all = db.prepare(
    "SELECT * FROM dictionary WHERE scope_team_id IS NULL ORDER BY starred DESC, term COLLATE NOCASE",
  );
  const byId = db.prepare("SELECT * FROM dictionary WHERE id = ?");
  const byTerm = db.prepare(
    "SELECT * FROM dictionary WHERE scope_team_id IS NULL AND lower(term) = lower(?) AND id != ?",
  );
  const counts = db.prepare(
    `SELECT count(*) AS entries,
            sum(replacement IS NOT NULL) AS replacements,
            sum(starred) AS starred
       FROM dictionary WHERE scope_team_id IS NULL`,
  );
  const insert = db.prepare(
    `INSERT INTO dictionary (id, term, replacement, case_sensitive, source, starred, use_count,
       scope_team_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
  );
  const update = db.prepare(
    `UPDATE dictionary SET term = ?, replacement = ?, case_sensitive = ?, starred = ?,
       updated_at = ? WHERE id = ?`,
  );
  const remove = db.prepare("DELETE FROM dictionary WHERE id = ?");
  const keep = db.prepare(
    "UPDATE dictionary SET source = 'manual' WHERE id = ? AND source = 'auto'",
  );
  const use = db.prepare("UPDATE dictionary SET use_count = use_count + 1 WHERE id = ?");
  const markPhrase = db.prepare("UPDATE dictionary SET kind = 'phrase' WHERE id = ?");
  const phrases = db.prepare("SELECT count(*) AS n FROM dictionary WHERE kind = 'phrase'");
  const setClip = db.prepare("UPDATE dictionary SET sample_path = ? WHERE id = ?");

  let cached: DictionaryRules | null = null;
  const handlers = new Set<() => void>();
  const changed = () => {
    cached = null;
    for (const handler of handlers) handler();
  };

  const refuse = (
    reason: Exclude<DictionarySaveResult, { ok: true }>["reason"],
    message: string,
    existing?: DictionaryEntry,
  ): DictionarySaveResult => ({ ok: false, reason, message, ...(existing ? { existing } : {}) });

  function buildRules(): DictionaryRules {
    const entries = (all.all() as unknown as Row[]).map(toEntry);
    const terms = entries.filter((entry) => entry.replacement === null);
    const starred = terms.filter((entry) => entry.starred);
    const others = terms
      .filter((entry) => !entry.starred)
      .sort((a, b) => b.useCount - a.useCount || b.updatedAt - a.updatedAt)
      .slice(0, DICTIONARY_LIMITS.promptTerms);
    return {
      promptTerms: [...starred, ...others].map((entry) => entry.term),
      starredCount: starred.length,
      spellings: terms.map((entry) => ({ id: entry.id, term: entry.term })),
      replacements: entries
        .filter((entry) => entry.replacement !== null)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((entry) => ({
          id: entry.id,
          term: entry.term,
          replacement: entry.replacement!,
          caseSensitive: entry.caseSensitive,
        })),
    };
  }

  return {
    list: () => (all.all() as unknown as Row[]).map(toEntry),

    save(input, source = "manual") {
      const term = tidy(input.term);
      const replacement =
        input.replacement === null || input.replacement.trim() === ""
          ? null
          : input.replacement.trim();
      if (term === "") return refuse("empty", "Type the word or phrase first.");
      if (term.length > DICTIONARY_LIMITS.termLength) {
        return refuse(
          "too-long",
          `A term can be at most ${DICTIONARY_LIMITS.termLength} characters.`,
        );
      }
      if (replacement !== null && replacement.length > DICTIONARY_LIMITS.replacementLength) {
        return refuse(
          "too-long",
          `A replacement can be at most ${DICTIONARY_LIMITS.replacementLength} characters.`,
        );
      }
      const current = input.id ? (byId.get(input.id) as Row | undefined) : undefined;
      if (input.id && !current) return refuse("not-found", "This entry no longer exists.");
      const duplicate = byTerm.get(term, input.id ?? "") as Row | undefined;
      if (duplicate) {
        return refuse(
          "duplicate",
          `"${duplicate.term}" is already in the dictionary.`,
          toEntry(duplicate),
        );
      }
      const count = counts.get() as {
        entries: number;
        replacements: number | null;
        starred: number | null;
      };
      if (!current && count.entries >= DICTIONARY_LIMITS.entries) {
        return refuse(
          "full",
          `The dictionary holds at most ${DICTIONARY_LIMITS.entries.toLocaleString("en")} entries.`,
        );
      }
      const wasReplacement = current ? current.replacement !== null : false;
      if (
        replacement !== null &&
        !wasReplacement &&
        (count.replacements ?? 0) >= DICTIONARY_LIMITS.replacements
      ) {
        return refuse(
          "too-many-replacements",
          `At most ${DICTIONARY_LIMITS.replacements.toLocaleString("en")} replacements can be saved.`,
        );
      }
      const wasStarred = current ? current.starred === 1 : false;
      if (input.starred && !wasStarred && (count.starred ?? 0) >= DICTIONARY_LIMITS.starred) {
        return refuse(
          "too-many-starred",
          `At most ${DICTIONARY_LIMITS.starred} entries can be starred.`,
        );
      }
      const at = now();
      const id = current ? current.id : newId();
      if (current) {
        update.run(term, replacement, input.caseSensitive ? 1 : 0, input.starred ? 1 : 0, at, id);
      } else {
        insert.run(
          id,
          term,
          replacement,
          input.caseSensitive ? 1 : 0,
          source,
          input.starred ? 1 : 0,
          at,
          at,
        );
      }
      changed();
      return { ok: true, entry: toEntry(byId.get(id) as unknown as Row) };
    },

    remove(id) {
      remove.run(id);
      changed();
    },

    addPhrase(phrase) {
      const saved = this.save(
        { term: phrase, replacement: null, caseSensitive: false, starred: false },
        "auto",
      );
      if (saved.ok) {
        markPhrase.run(saved.entry.id);
        return { ok: true, entry: { ...saved.entry, kind: "phrase" } };
      }
      return saved;
    },

    phraseCount: () => (phrases.get() as { n: number }).n,

    clipPath(id) {
      return (byId.get(id) as Row | undefined)?.sample_path ?? null;
    },

    setClip(id, path) {
      setClip.run(path, id);
      changed();
    },

    importMany(rows) {
      const count = counts.get() as { entries: number; replacements: number | null };
      const newReplacements = rows.filter((row) => row.replacement !== null).length;
      if (count.entries + rows.length > DICTIONARY_LIMITS.entries) {
        return {
          ok: false,
          message: `This would make more than ${DICTIONARY_LIMITS.entries.toLocaleString("en")} entries.`,
        };
      }
      if ((count.replacements ?? 0) + newReplacements > DICTIONARY_LIMITS.replacements) {
        return {
          ok: false,
          message: `This would make more than ${DICTIONARY_LIMITS.replacements.toLocaleString("en")} replacements.`,
        };
      }
      const at = now();
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const row of rows) {
          insert.run(newId(), tidy(row.term), row.replacement, 0, "import", 0, at, at);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        return { ok: false, message: `Nothing was imported: ${String(error)}` };
      }
      changed();
      return { ok: true, added: rows.length };
    },

    keep(id) {
      keep.run(id);
      changed();
    },

    rules() {
      cached ??= buildRules();
      return cached;
    },

    recordUses(ids) {
      if (ids.length === 0) return;
      db.exec("BEGIN");
      try {
        for (const id of ids) use.run(id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      // Use counts change the order of the prompt terms.
      cached = null;
    },

    onChange(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
