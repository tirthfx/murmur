/**
 * Spoken lists (DC-26): "number one … number two …", "first, … second, …" and "bullet …
 * bullet …" become lines. Only these cues count, and only two or more of them in order, so
 * an ordinary sentence is never broken up. Rules only; nothing is guessed.
 */

const NUMBERS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];

const ORDINALS = [
  ["first", "firstly"],
  ["second", "secondly"],
  ["third", "thirdly"],
  ["fourth", "fourthly"],
  ["fifth", "fifthly"],
  ["sixth", "sixthly"],
  ["seventh", "seventhly"],
  ["eighth", "eighthly"],
  ["ninth", "ninthly"],
  ["tenth", "tenthly"],
];

/** Words that make "bullet" or "next item" part of a sentence ("bit the bullet"). */
const NOT_A_CUE_AFTER = new Set(
  (
    "a an the this that these those one each every another his her my your our their its " +
    "no any some same of to on in for with silver magic rubber stray"
  ).split(" "),
);

interface Cue {
  /** Word index where the cue starts, and where the item's own words start. */
  at: number;
  end: number;
}

const bare = (word: string) => word.toLowerCase().replace(/^[("'“‘]+|[)"'”’.,!?;:…-]+$/g, "");
const endsSentence = (word: string) => /[.!?…]["'”’)]*$/.test(word);
const endsClause = (word: string) => /[.!?…,;:—–-]["'”’)]*$/.test(word);

function startsClause(words: readonly string[], index: number): boolean {
  return index === 0 || endsClause(words[index - 1]!);
}

/** "Number one, … number two …": the numbers must count up from one. */
function numberCues(words: readonly string[]): Cue[] {
  const cues: Cue[] = [];
  for (let index = 0; index + 1 < words.length; index++) {
    if (bare(words[index]!) !== "number") continue;
    const next = cues.length;
    const said = bare(words[index + 1]!);
    if (said !== NUMBERS[next] && said !== String(next + 1)) continue;
    cues.push({ at: index, end: index + 2 });
    index++;
  }
  return cues;
}

/** "First, … Second, …": each at the start of a clause, so "the first time" is not a cue. */
function ordinalCues(words: readonly string[]): Cue[] {
  const cues: Cue[] = [];
  for (let index = 0; index < words.length; index++) {
    const forms = ORDINALS[cues.length];
    if (!forms || !forms.includes(bare(words[index]!))) continue;
    if (!startsClause(words, index)) continue;
    // "First of all" opens a remark, not a list.
    if (bare(words[index + 1] ?? "") === "of") continue;
    // Without a pause after it, "second" could be a unit of time.
    if (!/[,:]$/.test(words[index]!)) continue;
    cues.push({ at: index, end: index + 1 });
  }
  return cues;
}

function bulletCues(words: readonly string[]): Cue[] {
  const cues: Cue[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = bare(words[index]!);
    const next = bare(words[index + 1] ?? "");
    let length = 0;
    if (word === "bullet") length = next === "point" ? 2 : 1;
    else if (word === "next" && next === "item") length = 2;
    if (length === 0) continue;
    const before = index === 0 ? "" : words[index - 1]!;
    if (!endsClause(before) && NOT_A_CUE_AFTER.has(bare(before))) continue;
    cues.push({ at: index, end: index + length });
    index += length - 1;
  }
  return cues;
}

/** One item's text: no trailing comma or full stop, no "and" left before the next cue. */
function item(words: readonly string[], last: boolean): string {
  let text = words.join(" ");
  if (!last) text = text.replace(/[\s,;]+(and|then|and then)$/i, "");
  text = text.replace(/[\s,;:.—–-]+$/, "").replace(/^[\s,;:.—–-]+/, "");
  return text === "" ? "" : text[0]!.toLocaleUpperCase() + text.slice(1);
}

function build(words: readonly string[], cues: readonly Cue[], numbered: boolean): string | null {
  const items: string[] = [];
  let after = "";
  for (let index = 0; index < cues.length; index++) {
    const cue = cues[index]!;
    const next = cues[index + 1];
    let end = next ? next.at : words.length;
    if (!next) {
      // The last item ends with its sentence; what follows is ordinary text again.
      const stop = words.findIndex((word, at) => at >= cue.end && endsSentence(word));
      if (stop >= 0 && stop < words.length - 1) {
        end = stop + 1;
        after = words.slice(end).join(" ");
      }
    }
    const text = item(words.slice(cue.end, end), !next);
    if (text === "") return null;
    items.push(`${numbered ? `${index + 1}.` : "-"} ${text}`);
  }
  const before = words.slice(0, cues[0]!.at).join(" ").replace(/[,;]$/, "");
  return [before, items.join("\n"), after].filter((part) => part !== "").join("\n");
}

/** The text with its spoken list written as one, or unchanged when it holds none. */
export function formatLists(text: string): string {
  // Text that already has lines keeps them.
  if (text.includes("\n")) return text;
  const words = text.split(/\s+/).filter(Boolean);
  for (const [find, numbered] of [
    [numberCues, true],
    [ordinalCues, true],
    [bulletCues, false],
  ] as const) {
    const cues = find(words);
    if (cues.length < 2) continue;
    const list = build(words, cues, numbered);
    if (list !== null) return list;
  }
  return text;
}
