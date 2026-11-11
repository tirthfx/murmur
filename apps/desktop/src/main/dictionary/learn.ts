import type { DatabaseSync } from "node:sqlite";
import type { EditsChanged } from "@murmur/shared";
import type { DictionaryStore } from "./dictionary-store";

// Learning from corrections (PZ-02). The helper reports the words changed inside the inserted
// text; these rules decide whether that was a correction worth learning.

/** Times a correction must be seen before it becomes a dictionary entry. */
export const REPEATS_NEEDED = 2;
const MAX_WORDS = 3;

export type Correction =
  { kind: "spelling"; term: string } | { kind: "replacement"; spoken: string; written: string };

/** Punctuation at either end does not count as part of the correction. */
const trimPunctuation = (text: string) =>
  text.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * A correction of one to three words, or null for anything else: deletions, rewrites longer
 * than three words, or edits that take out more than half of what was inserted.
 */
export function judgeCorrection(change: EditsChanged, inserted: string): Correction | null {
  const before = trimPunctuation(change.before);
  const after = trimPunctuation(change.after);
  if (before === "" || after === "" || before === after) return null;
  if (wordCount(before) > MAX_WORDS || wordCount(after) > MAX_WORDS) return null;
  if (before.length > inserted.trim().length / 2) return null;
  if (before.toLowerCase() === after.toLowerCase()) return { kind: "spelling", term: after };
  return { kind: "replacement", spoken: before, written: after };
}

export interface CorrectionLearner {
  /** Notes a correction; returns what was added to the dictionary, if anything. */
  learn(change: EditsChanged, inserted: string): Correction | null;
}

export function createCorrectionLearner(
  db: DatabaseSync,
  dictionary: Pick<DictionaryStore, "save">,
  now: () => number = Date.now,
): CorrectionLearner {
  const seen = db.prepare(
    `INSERT INTO learn_candidates (spoken, written, seen, first_at, last_at) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT (spoken, written) DO UPDATE SET seen = seen + 1, last_at = excluded.last_at
     RETURNING seen`,
  );
  const forget = db.prepare("DELETE FROM learn_candidates WHERE spoken = ? AND written = ?");

  return {
    learn(change, inserted) {
      const correction = judgeCorrection(change, inserted);
      if (!correction) return null;
      // A change of capitals only is learned at once; anything else after two times.
      if (correction.kind === "replacement") {
        const key = [correction.spoken.toLowerCase(), correction.written] as const;
        const at = now();
        const { seen: times } = seen.get(key[0], key[1], at, at) as { seen: number };
        if (times < REPEATS_NEEDED) return null;
        forget.run(key[0], key[1]);
      }
      const saved = dictionary.save(
        correction.kind === "spelling"
          ? { term: correction.term, replacement: null, caseSensitive: false, starred: false }
          : {
              term: correction.spoken,
              replacement: correction.written,
              caseSensitive: false,
              starred: false,
            },
        "auto",
      );
      return saved.ok ? correction : null;
    },
  };
}
