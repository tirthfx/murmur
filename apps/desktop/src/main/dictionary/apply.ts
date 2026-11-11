// The dictionary stage of the pipeline (PZ-01, PZ-04): replacements after speech recognition
// and before cleanup, exact spellings for terms, and the vocabulary for the speech prompt.

export interface ReplacementRule {
  id: string;
  /** The spoken or recognised form. */
  term: string;
  /** The written form. */
  replacement: string;
  caseSensitive: boolean;
}

export interface SpellingRule {
  id: string;
  term: string;
}

/** Letters, digits and underscore count as part of a word. */
const BEFORE = "(?<![\\p{L}\\p{N}_])";
const AFTER = "(?![\\p{L}\\p{N}_])";

function pattern(term: string): string {
  return term
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
}

const sameWords = (a: string, b: string) => a.trim().split(/\s+/).join(" ") === b;

/**
 * Applies the replacements in one pass, whole words only. Rules are tried in their order, so
 * the first listed wins where two match at the same place. Replaced text is never looked at
 * again, so one rule's output cannot be replaced by another. Returns the ids used, once each.
 */
export function applyReplacements(
  text: string,
  rules: readonly ReplacementRule[],
): { text: string; used: string[] } {
  const usable = rules.filter((rule) => rule.term.trim() !== "");
  if (usable.length === 0 || text === "") return { text, used: [] };
  const combined = new RegExp(
    `${BEFORE}(?:${usable.map((rule) => pattern(rule.term)).join("|")})${AFTER}`,
    "giu",
  );
  const used = new Set<string>();
  const result = text.replace(combined, (match) => {
    const normal = match.split(/\s+/).join(" ");
    const rule = usable.find((candidate) => {
      const term = candidate.term.trim().split(/\s+/).join(" ");
      return candidate.caseSensitive
        ? sameWords(term, normal)
        : term.toLowerCase() === normal.toLowerCase();
    });
    if (!rule) return match;
    used.add(rule.id);
    return rule.replacement;
  });
  return { text: result, used: [...used] };
}

/**
 * Writes each term with the spelling saved in the dictionary wherever the same word appears
 * in another case: "kubernetes" becomes "Kubernetes". Returns the ids used, once each.
 */
export function keepSpellings(
  text: string,
  terms: readonly SpellingRule[],
): { text: string; used: string[] } {
  const usable = terms.filter((term) => term.term.trim() !== "");
  if (usable.length === 0 || text === "") return { text, used: [] };
  const byLower = new Map<string, SpellingRule>();
  for (const term of usable) {
    const key = term.term.trim().split(/\s+/).join(" ").toLowerCase();
    if (!byLower.has(key)) byLower.set(key, term);
  }
  // Longer terms first, so "GitHub Actions" wins over "GitHub".
  const ordered = [...byLower.values()].sort((a, b) => b.term.length - a.term.length);
  const combined = new RegExp(
    `${BEFORE}(?:${ordered.map((term) => pattern(term.term)).join("|")})${AFTER}`,
    "giu",
  );
  const used = new Set<string>();
  const result = text.replace(combined, (match) => {
    const rule = byLower.get(match.split(/\s+/).join(" ").toLowerCase());
    if (!rule) return match;
    used.add(rule.id);
    return rule.term.trim();
  });
  return { text: result, used: [...used] };
}

/** Characters of dictionary terms in the speech prompt; the rest is text on screen. */
export const PROMPT_TERM_CHARS = 400;
/** Characters of on-screen text kept when terms are in the prompt too. */
export const PROMPT_CONTEXT_CHARS_WITH_TERMS = 300;

/**
 * The speech model's prompt: the most important terms first, then the text before the caret.
 * The helper keeps the end of the prompt if it is too long, so the screen text goes last.
 */
export function speechPromptWithTerms(terms: readonly string[], screen: string): string {
  const chosen: string[] = [];
  let length = 0;
  for (const term of terms) {
    const next = length + term.length + 2;
    if (next > PROMPT_TERM_CHARS) break;
    chosen.push(term);
    length = next;
  }
  if (chosen.length === 0) return screen;
  const list = `${chosen.join(", ")}.`;
  if (screen === "") return list;
  const tail =
    screen.length > PROMPT_CONTEXT_CHARS_WITH_TERMS
      ? screen.slice(-PROMPT_CONTEXT_CHARS_WITH_TERMS).replace(/^\S*\s/, "")
      : screen;
  return `${list} ${tail}`;
}
