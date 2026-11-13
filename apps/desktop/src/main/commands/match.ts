// Command Mode matching (RW-08, RW-09): the wake phrase, and what was said to a command from
// the fixed list. Rules first; the model is asked only when no rule matches (model-match.ts).
// Imports only plain .ts files, so the benchmark script can load it with Node directly.
import type { CommandId } from "../../../../../packages/shared/src/commands.ts";
import { SPEECH_LANGUAGES } from "../../../../../packages/shared/src/languages.ts";

export interface CommandMatch {
  id: CommandId;
  /** For `translate`: the language's English name, or null when none was said. */
  language: string | null;
}

/** Spoken language names not in the language list's labels. */
const LANGUAGE_ALIASES: Record<string, string> = {
  mandarin: "Chinese",
  cantonese: "Chinese",
  castilian: "Spanish",
  brazilian: "Portuguese",
  hinglish: "Hindi",
  farsi: "Persian",
  persian: "Persian",
  turkish: "Turkish",
  polish: "Polish",
  swedish: "Swedish",
  greek: "Greek",
  vietnamese: "Vietnamese",
  indonesian: "Indonesian",
  thai: "Thai",
  hebrew: "Hebrew",
  ukrainian: "Ukrainian",
  kannada: "Kannada",
  malayalam: "Malayalam",
  punjabi: "Punjabi",
};

const LANGUAGES: Record<string, string> = {
  ...Object.fromEntries(
    SPEECH_LANGUAGES.filter((language) => !language.code.includes("-")).map((language) => [
      language.label.toLowerCase(),
      language.label,
    ]),
  ),
  ...LANGUAGE_ALIASES,
};

/** The language named in a phrase ("translate to French" gives "French"), or null. */
export function findLanguage(text: string): string | null {
  for (const word of normalise(text).split(" ")) {
    const language = LANGUAGES[word];
    if (language) return language;
  }
  return null;
}

const LEADING =
  /^(?:(?:ok|okay|so|um+|uh+|er+|hmm+|please|now|just|and|then|alright|right|hey)\s+|(?:can|could|would|will) you\s+|i want you to\s+|i'd like you to\s+|let's\s+)+/;
const TRAILING = /(?:\s+(?:please|thanks|thank you|for me|now|okay|ok))+$/;

/** Lower case, words only. */
function plainWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lower case, words only, without polite padding ("could you ... please"). */
export function normalise(text: string): string {
  return plainWords(text).replace(LEADING, "").replace(TRAILING, "").trim();
}

const LANGUAGE_WORDS = Object.keys(LANGUAGES).join("|");

const TARGET = String.raw`(?:this|that|it|them|these|those|the text|the selection|the selected text|everything|all of (?:this|that|it)|all that|all this)`;

/**
 * Ordered rules: more specific commands first, so "list the questions" is not "make it a
 * list" and "less formal" is not "formal".
 */
const RULES: readonly [CommandId, RegExp][] = [
  ["translate", /\btranslat\w*\b/],
  [
    "translate",
    new RegExp(
      String.raw`^(?:put|say|write|rewrite|turn)\s+${TARGET}\s+(?:in|into)\s+(?:${LANGUAGE_WORDS})$`,
    ),
  ],
  ["questions", /\bquestions?\b/],
  ["summary", /\b(?:summary|summari[sz]\w*|tl ?dr|recap|gist)\b/],
  ["new_paragraph", /\bparagraph\b/],
  ["new_line", /\b(?:(?:new|next|another) line|line break|break the line)\b/],
  ["press_enter", /^(?:(?:press|hit|push|tap)\s+)?(?:the\s+)?(?:enter|return)(?:\s+key)?$/],
  ["select_all", /\b(?:select|highlight)\s+(?:all|everything|the whole)\b/],
  ["undo", /\b(?:undo|take (?:that|it|this) back|revert)\b/],
  [
    "delete",
    new RegExp(
      String.raw`^(?:delete|remove|erase|clear|scratch|get rid of|bin|trash|kill)(?:\s+${TARGET})?$`,
    ),
  ],
  ["bold", /\b(?:bold\w*|embolden)\b/],
  ["italic", /\bitali[cz]\w*\b/],
  ["lowercase", /\b(?:lower ?case\w*|small letters|no caps|no capitals)\b/],
  ["capitalise", /\b(?:capitali[sz]\w*|title case)\b/],
  ["uppercase", /\b(?:upper ?case\w*|all caps|all capitals|capital letters|caps)\b/],
  ["list", /\b(?:bullet\w*|(?:a|into|as)\s+(?:a\s+)?(?:numbered\s+)?list|list form|listify)\b/],
  [
    "friendly",
    /\b(?:friendl\w*|casual\w*|warm(?:er)?|relaxed|less formal|informal|chatty|nicer|kinder)\b/,
  ],
  ["formal", /\b(?:formal\w*|professional\w*|polite\w*|businesslike|business like)\b/],
  [
    "shorter",
    /\b(?:short(?:er|en\w*)?|tighten\w*|trim\w*|concise|condense\w*|brief(?:er)?|less wordy|fewer words|cut (?:it|this|that) down)\b/,
  ],
  [
    "clearer",
    /\b(?:clear(?:er|ly)?|clarif\w*|simplif\w*|simpler|easier to (?:read|understand|follow)|plain(?:er)? english|readable)\b/,
  ],
  [
    "grammar",
    /\b(?:grammar\w*|spelling|spell check|typos?|proofread\w*|punctuation|mistakes?|errors?)\b/,
  ],
  ["grammar", new RegExp(String.raw`^(?:fix|correct|tidy|clean)(?:\s+${TARGET})?(?:\s+up)?$`)],
];

/** Commands longer than this are left to the model. */
const MAX_RULE_WORDS = 14;

/** The command a phrase names, by the rules alone; null when none matches. */
export function matchCommand(text: string): CommandMatch | null {
  const phrase = normalise(text);
  if (phrase === "" || phrase.split(" ").length > MAX_RULE_WORDS) return null;
  for (const [id, rule] of RULES) {
    if (rule.test(phrase))
      return { id, language: id === "translate" ? findLanguage(phrase) : null };
  }
  return null;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const kept = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = kept;
    }
  }
  return row[b.length]!;
}

/** Speech often misspells a made-up name: "murmer" for "murmur". */
function closeEnough(heard: string, wanted: string): boolean {
  if (heard === wanted) return true;
  if (wanted.length < 3) return false;
  return editDistance(heard, wanted) <= (wanted.length >= 6 ? 2 : 1);
}

/**
 * When the text starts with the wake phrase, what follows it ("" when nothing does);
 * otherwise null. Spelling slips in the recognised words are allowed.
 */
export function afterWakePhrase(text: string, wakePhrase: string): string | null {
  const wanted = plainWords(wakePhrase).split(" ").filter(Boolean);
  if (wanted.length === 0) return null;
  const words = [...text.matchAll(/[\p{L}\p{N}']+/gu)];
  if (words.length < wanted.length) return null;
  for (let index = 0; index < wanted.length; index++) {
    const heard = words[index]![0].toLowerCase().replace(/[‘’]/g, "'");
    if (!closeEnough(heard, wanted[index]!)) return null;
  }
  // Nothing but spaces and punctuation may come before the wake phrase.
  if (/[\p{L}\p{N}]/u.test(text.slice(0, words[0]!.index))) return null;
  const last = words[wanted.length - 1]!;
  return text
    .slice(last.index + last[0].length)
    .replace(/^[\s,.:;!?\-–—]+/u, "")
    .trim();
}
