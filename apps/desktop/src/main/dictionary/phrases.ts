import type { DatabaseSync } from "node:sqlite";
import type { DictionaryStore } from "./dictionary-store";

// Phrase learning (PZ-05, experimental): names of two to four words that the owner dictates
// often, such as "Harbour Lights Migration", become learned dictionary phrases so the speech
// prompt keeps them together. Only those short phrases are kept, never sentences.

export const PHRASE_LIMITS = {
  minWords: 2,
  maxWords: 4,
  /** Times seen within the window before a phrase is learned. */
  seen: 3,
  windowMs: 14 * 24 * 60 * 60_000,
  learned: 100,
  /** Phrases counted at most; the least recent go first. */
  tracked: 2_000,
} as const;

const STOP = new Set(
  (
    "a an and are as at be but by for from had has have he her his i if in is it its me my of " +
    "on or our she so that the their them then there they this to was we were what when which " +
    "who will with you your hi hello hey dear thanks thank okay ok yes no please sorry " +
    "monday tuesday wednesday thursday friday saturday sunday"
  ).split(" "),
);

const NAME_WORD = /^[\p{Lu}\p{N}][\p{L}\p{N}'’&.-]*$/u;

/**
 * The phrases worth counting in one final text, each once: runs of two to four capitalised
 * words, not at the start of a sentence (where every word has a capital), not starting or
 * ending with a common word.
 */
export function candidatePhrases(text: string): string[] {
  const found = new Set<string>();
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+|[,;:()"“”]/)) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    for (let start = 1; start < words.length; start++) {
      for (let size = PHRASE_LIMITS.minWords; size <= PHRASE_LIMITS.maxWords; size++) {
        const slice = words.slice(start, start + size).map((word) => word.replace(/[.!?]+$/, ""));
        if (slice.length !== size || !slice.every((word) => NAME_WORD.test(word))) break;
        const first = slice[0]!.toLowerCase();
        const last = slice.at(-1)!.toLowerCase();
        if (STOP.has(first) || STOP.has(last)) continue;
        found.add(slice.join(" "));
      }
    }
  }
  return [...found];
}

export interface PhraseLearner {
  /** Counts the phrases in one inserted text; returns the phrases learned by it. */
  learn(text: string): string[];
}

export function createPhraseLearner(
  db: DatabaseSync,
  dictionary: Pick<DictionaryStore, "addPhrase" | "phraseCount" | "list">,
  now: () => number = Date.now,
): PhraseLearner {
  const get = db.prepare("SELECT seen, first_at FROM phrase_counts WHERE phrase = ?");
  const upsert = db.prepare(
    `INSERT INTO phrase_counts (phrase, seen, first_at, last_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (phrase) DO UPDATE SET seen = excluded.seen, first_at = excluded.first_at,
       last_at = excluded.last_at`,
  );
  const drop = db.prepare("DELETE FROM phrase_counts WHERE phrase = ?");
  const expire = db.prepare("DELETE FROM phrase_counts WHERE last_at < ?");
  const trim = db.prepare(
    `DELETE FROM phrase_counts WHERE phrase IN (
       SELECT phrase FROM phrase_counts ORDER BY last_at DESC LIMIT -1 OFFSET ?)`,
  );

  return {
    learn(text) {
      const at = now();
      expire.run(at - PHRASE_LIMITS.windowMs);
      const due: string[] = [];
      for (const phrase of candidatePhrases(text)) {
        const row = get.get(phrase) as { seen: number; first_at: number } | undefined;
        const fresh = !row || at - row.first_at > PHRASE_LIMITS.windowMs;
        const seen = fresh ? 1 : row.seen + 1;
        upsert.run(phrase, seen, fresh ? at : row.first_at, at);
        if (seen >= PHRASE_LIMITS.seen) due.push(phrase);
      }
      trim.run(PHRASE_LIMITS.tracked);
      // Longest first, so "Harbour Lights Migration" wins over "Harbour Lights".
      const known = dictionary.list().map((entry) => entry.term.toLowerCase());
      const learned: string[] = [];
      for (const phrase of due.sort((a, b) => b.split(" ").length - a.split(" ").length)) {
        if (dictionary.phraseCount() >= PHRASE_LIMITS.learned) break;
        const lower = phrase.toLowerCase();
        const covered = [...known, ...learned.map((item) => item.toLowerCase())].some(
          (term) => term === lower || ` ${term} `.includes(` ${lower} `),
        );
        drop.run(phrase);
        if (covered) continue;
        if (dictionary.addPhrase(phrase).ok) learned.push(phrase);
      }
      return learned;
    },
  };
}
