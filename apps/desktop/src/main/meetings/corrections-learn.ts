import type { CorrectionLearner } from "../dictionary/learn";

/** The words that changed between two versions of a line: what is left once the same words at both ends are set aside. */
export function changedWords(before: string, after: string): { before: string; after: string } {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  return {
    before: a.slice(start, a.length - end).join(" "),
    after: b.slice(start, b.length - end).join(" "),
  };
}

/**
 * Offers what the owner changed in a transcript line to the Dictionary (NT-24), through the
 * same rules as a correction made after a dictation: one to three words, seen twice before it is
 * kept, and added for the owner to review on the Dictionary page. Returns what was added.
 */
export function suggestFromCorrection(
  learner: Pick<CorrectionLearner, "learn">,
  before: string,
  after: string,
): { spoken: string; written: string } | null {
  const change = changedWords(before, after);
  if (change.before === "" || change.after === "") return null;
  const learned = learner.learn(change, before);
  if (!learned) return null;
  return learned.kind === "replacement"
    ? { spoken: learned.spoken, written: learned.written }
    : { spoken: change.before, written: learned.term };
}
