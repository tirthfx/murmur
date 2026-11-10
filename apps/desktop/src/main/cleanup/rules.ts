/**
 * The deterministic cleanup pass (DC-23, DC-24, DC-24b, DC-27): no model, always available.
 * Works on whitespace tokens, keeping each token's leading and trailing punctuation apart
 * from the word so rules can compare words and still put punctuation back correctly.
 */

export const CLEANUP_LEVELS = ["off", "light", "standard", "full"] as const;
export type CleanupLevel = (typeof CLEANUP_LEVELS)[number];

interface Token {
  lead: string;
  word: string;
  trail: string;
}

const FILLER = /^(u+m+|u+h+|u+h+m+|e+r+|e+r+m+|h+m+|a+h+|m+m+)$/i;
const SENTENCE_END = /[.!?…]/;
const CLAUSE_END = /[,;:.!?…—–-]/;

/** Words before "sorry" that make it an apology, not a correction ("I'm sorry"). */
const APOLOGY_LEAD = new Set([
  "i'm",
  "im",
  "am",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "so",
  "very",
  "really",
  "feel",
  "felt",
  "i",
  "we",
  "you",
  "they",
  "he",
  "she",
  "it's",
  "not",
  "awfully",
  "truly",
]);

interface Cue {
  words: string[];
  /** Counts only after a pause comma: "at two, actually three" but not "it actually works". */
  needsPause: boolean;
}

const CUES: Cue[] = [
  { words: ["scratch", "that"], needsPause: false },
  { words: ["no", "wait"], needsPause: false },
  { words: ["or", "rather"], needsPause: false },
  { words: ["i", "mean"], needsPause: true },
  { words: ["actually"], needsPause: true },
  { words: ["rather"], needsPause: true },
  { words: ["sorry"], needsPause: false },
];

/** Longest correction we trust a rule with; longer ones are left to the model. */
const MAX_CORRECTION = 6;
/** How far back a correction's first word may be found ("to Sam no wait to Priya"). */
const ANCHOR_REACH = 6;

function tokenize(text: string): Token[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      const match = /^([("'“‘[]*)(.*?)([)"'”’\].,!?;:…—–-]*)$/u.exec(raw);
      return { lead: match?.[1] ?? "", word: match?.[2] ?? raw, trail: match?.[3] ?? "" };
    });
}

function render(tokens: Token[]): string {
  return tokens.map((token) => token.lead + token.word + token.trail).join(" ");
}

const lower = (token: Token | undefined) => (token?.word ?? "").toLowerCase();
const endsSentence = (token: Token | undefined) => !!token && SENTENCE_END.test(token.trail);
const endsClause = (token: Token | undefined) => !!token && CLAUSE_END.test(token.trail);

function removeFillers(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const token of tokens) {
    if (!FILLER.test(token.word)) {
      out.push({ ...token });
      continue;
    }
    const previous = out.at(-1);
    if (!previous) continue;
    if (SENTENCE_END.test(token.trail)) {
      // "go uh." keeps the full stop on "go".
      previous.trail = previous.trail.replace(/[,;:]+$/, "") + token.trail.replace(/^[,;:]+/, "");
    } else if (token.trail.includes(",") && previous.trail.endsWith(",")) {
      // ", uh," was only there for the filler.
      previous.trail = previous.trail.slice(0, -1);
    }
  }
  return out;
}

function collapseRepeats(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const token of tokens) {
    const previous = out.at(-1);
    if (
      previous &&
      previous.trail === "" &&
      /\p{L}/u.test(token.word) &&
      lower(previous) === lower(token) &&
      previous.lead === token.lead
    ) {
      out[out.length - 1] = { ...token, lead: previous.lead };
      continue;
    }
    out.push(token);
  }
  return out;
}

function matchCue(tokens: Token[], index: number): Cue | null {
  for (const cue of CUES) {
    const fits = cue.words.every((word, offset) => {
      const token = tokens[index + offset];
      // Inner words of a cue may not end a clause ("no, wait" is still a cue at the end).
      return lower(token) === word && (offset === cue.words.length - 1 || !endsClause(token));
    });
    if (fits) return cue;
  }
  return null;
}

/** Start of the sentence containing `index`. */
function sentenceStart(tokens: Token[], index: number): number {
  let start = index;
  while (start > 0 && !endsSentence(tokens[start - 1])) start--;
  return start;
}

function selfCorrect(tokens: Token[]): Token[] {
  let current = tokens.map((token) => ({ ...token }));
  for (let index = 0; index < current.length; index++) {
    const cue = matchCue(current, index);
    if (!cue) continue;
    const previous = current[index - 1];
    // A cue with nothing before it is kept as text.
    if (!previous) continue;
    const cueEnd = index + cue.words.length;
    const last = current[cueEnd - 1]!;

    // "Scratch that" on its own removes the sentence before it.
    if (cue.words[0] === "scratch" && (endsSentence(last) || cueEnd === current.length)) {
      const sentenceEnd = endsSentence(previous) ? index - 1 : null;
      const from = sentenceStart(current, sentenceEnd ?? index - 1);
      current = [...current.slice(0, from), ...current.slice(cueEnd)];
      index = from - 1;
      continue;
    }
    if (endsSentence(previous)) continue;
    if (cue.needsPause && !/[,—–-]$/.test(previous.trail)) continue;
    if (cue.words[0] === "sorry" && APOLOGY_LEAD.has(lower(current[index - 1]))) continue;

    // The correction: words after the cue, up to the end of their clause.
    let correctionEnd = cueEnd;
    while (correctionEnd < current.length && correctionEnd - cueEnd < MAX_CORRECTION) {
      correctionEnd++;
      if (endsClause(current[correctionEnd - 1])) break;
    }
    const correction = current.slice(cueEnd, correctionEnd);
    if (correction.length === 0) continue;
    if (
      correctionEnd - cueEnd >= MAX_CORRECTION &&
      !endsClause(correction.at(-1)) &&
      correctionEnd < current.length
    ) {
      continue;
    }

    // What it replaces: back to the same first word if it is close ("to Sam ... to Priya"),
    // otherwise as many words as the correction, never crossing a sentence end.
    const floor = sentenceStart(current, index - 1);
    let from = -1;
    for (let back = index - 1; back >= Math.max(floor, index - ANCHOR_REACH); back--) {
      if (lower(current[back]) === lower(correction[0])) {
        from = back;
        break;
      }
    }
    if (from === -1) {
      from = index;
      while (from > floor && index - from < correction.length) {
        from--;
        if (from > floor && endsClause(current[from - 1])) break;
      }
    }
    const kept = current.slice(0, from);
    const before = kept.at(-1);
    const fixed = correction.map((token) => ({ ...token }));
    // Keep the replaced words' opening punctuation, drop the pause comma before the cue.
    if (fixed[0]) fixed[0].lead = current[from]!.lead || fixed[0].lead;
    if (before && before.trail.endsWith(",") && from === index)
      before.trail = before.trail.slice(0, -1);
    current = [...kept, ...fixed, ...current.slice(correctionEnd)];
    index = from + fixed.length - 1;
  }
  return current;
}

function capitalise(tokens: Token[]): Token[] {
  return tokens.map((token, index) => {
    const startsSentence = index === 0 || endsSentence(tokens[index - 1]);
    let word = token.word;
    if (/^i('(m|ll|ve|d|s))?$/i.test(word)) word = "I" + word.slice(1);
    if (startsSentence && word) word = word[0]!.toLocaleUpperCase() + word.slice(1);
    return { ...token, word };
  });
}

/**
 * Cleans a transcript at a level. `off` and `light` only fix spacing and sentence-start
 * capitals; `standard` and `full` also remove fillers, repeated words and self-corrections.
 */
export function cleanRules(text: string, level: CleanupLevel): string {
  let tokens = tokenize(text.replace(/\s+([,.!?;:])/g, "$1"));
  if (level === "standard" || level === "full") {
    tokens = selfCorrect(collapseRepeats(removeFillers(tokens)));
  }
  return render(capitalise(tokens)).trim();
}
