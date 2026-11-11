import type { FocusContext } from "@murmur/shared";

/** How much of the text before the caret goes to the speech model. */
const PROMPT_CHARS = 600;
const MAX_TERMS = 30;
const MAX_TERM_LENGTH = 40;

/** Capitalised words that say nothing about spelling. */
const COMMON = new Set(
  "I A An The This That These Those It Its He She We They You Your My Our Their His Her Hi Hello Hey Dear Thanks Thank Yes No Ok Okay And But Or So If When What Why How Who Where Which Please Re Fwd".split(
    " ",
  ),
);

/**
 * Text for the speech model's prompt: the end of what is before the caret, starting at a
 * word. Empty for a secure field or when there is nothing.
 */
export function speechPrompt(context: FocusContext | null): string {
  if (!context || context.secure) return "";
  const text = context.textBefore.replace(/\s+/g, " ").trim();
  if (text.length <= PROMPT_CHARS) return text;
  const tail = text.slice(-PROMPT_CHARS);
  const space = tail.indexOf(" ");
  return space >= 0 ? tail.slice(space + 1) : tail;
}

/**
 * Names and terms on screen, for the cleanup model to spell them the same way: capitalised
 * words, words with capitals inside (iPhone, GitHub) and words with digits. Only words, never
 * sentences, so text on screen cannot instruct the model.
 */
export function contextTerms(context: FocusContext | null): string[] {
  if (!context || context.secure) return [];
  const source = [context.windowTitle ?? "", context.textBefore, context.textAfter].join(" ");
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const match of source.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const word = match[0].replace(/['’-]+$/, "");
    if (word.length < 2 || word.length > MAX_TERM_LENGTH) continue;
    const hasCapital = /^\p{Lu}/u.test(word) || /\p{Ll}\p{Lu}/u.test(word);
    const hasDigit = /\p{N}/u.test(word) && /\p{L}/u.test(word);
    if (!hasCapital && !hasDigit) continue;
    if (COMMON.has(word)) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(word);
  }
  // The most recent words are the most likely to be said.
  return terms.slice(-MAX_TERMS);
}

/** One log line without any of the text. */
export function describeContext(context: FocusContext | null): string {
  if (!context) return "context: none";
  if (context.secure)
    return `context: ${context.appName ?? "unknown app"}, secure field, nothing read`;
  return `context: ${context.appName ?? "unknown app"}, ${context.textBefore.length} characters before the caret, ${context.textAfter.length} after`;
}
