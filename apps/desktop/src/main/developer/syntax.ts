// Spoken syntax in Developer apps (PZ-26): "camel case user id" becomes userId, "dash dash
// help" becomes --help. Murmur's own rule table, one set for every programming language.

type CaseStyle = "camel" | "snake" | "pascal" | "kebab" | "constant";

const CASE_WORDS: Record<string, CaseStyle> = {
  camel: "camel",
  snake: "snake",
  pascal: "pascal",
  kebab: "kebab",
  constant: "constant",
};

interface Symbol {
  text: string;
  /** No space before it ("user" "." → "user."). */
  glueBefore: boolean;
  /** No space after it ("-" "help" → "-help"). */
  glueAfter: boolean;
}

const JOIN = (text: string): Symbol => ({ text, glueBefore: true, glueAfter: true });
const PREFIX = (text: string): Symbol => ({ text, glueBefore: false, glueAfter: true });
const SUFFIX = (text: string): Symbol => ({ text, glueBefore: true, glueAfter: false });
const SPACED = (text: string): Symbol => ({ text, glueBefore: false, glueAfter: false });

/** Spoken names, longest first when matched. */
const SYMBOLS: [string[], Symbol][] = [
  [["open", "parenthesis"], JOIN("(")],
  [["close", "parenthesis"], SUFFIX(")")],
  [["open", "paren"], JOIN("(")],
  [["close", "paren"], SUFFIX(")")],
  [["open", "bracket"], JOIN("[")],
  [["close", "bracket"], SUFFIX("]")],
  [["open", "brace"], PREFIX("{")],
  [["close", "brace"], SUFFIX("}")],
  [["back", "slash"], JOIN("\\")],
  [["forward", "slash"], JOIN("/")],
  [["equal", "sign"], SPACED("=")],
  [["backslash"], JOIN("\\")],
  [["slash"], JOIN("/")],
  [["dot"], JOIN(".")],
  [["colon"], JOIN(":")],
  [["underscore"], JOIN("_")],
  [["dash"], PREFIX("-")],
  [["hyphen"], PREFIX("-")],
  [["equals"], SPACED("=")],
];

const SYMBOL_WORDS = new Set(SYMBOLS.flatMap(([words]) => words));
/**
 * A case command takes the words after it up to one of these, so "snake case user name to
 * camel case user name" gives user_name to userName.
 */
const STOP_WORDS = new Set(
  "to and or in into from with as for then than is are was on at by of if when while".split(" "),
);
/** A quick test: no spoken syntax at all leaves the text exactly as it was. */
const ANY = new RegExp(
  `\\b(${[...Object.keys(CASE_WORDS).map((word) => `${word}[\\s-]*case`), ...SYMBOLS.map(([words]) => words.join("[\\s-]+"))].join("|")})\\b`,
  "i",
);

interface Piece {
  text: string;
  glueBefore: boolean;
  glueAfter: boolean;
  /** Punctuation the recogniser added, such as a pause comma. */
  punctuation: boolean;
}

const PUNCTUATION = /^[.,!?;:]+$/;

/** Words and the punctuation stuck to them: "ID," → "ID", ",". Hyphenated syntax words split. */
function tokens(line: string): string[] {
  const out: string[] = [];
  for (const raw of line.split(/\s+/).filter(Boolean)) {
    const match = raw.match(/^(.*?)([.,!?;:]*)$/u)!;
    const word = match[1]!;
    const trailing = match[2]!;
    const parts = word.split("-");
    if (
      parts.length > 1 &&
      parts.every((part) => SYMBOL_WORDS.has(part.toLowerCase()) || part.toLowerCase() === "case")
    ) {
      out.push(...parts);
    } else if (word !== "") {
      out.push(word);
    }
    if (trailing !== "") out.push(trailing);
  }
  return out;
}

function caseOf(style: CaseStyle, words: string[]): string {
  const lower = words.map((word) => word.toLowerCase());
  const title = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  switch (style) {
    case "camel":
      return lower.map((word, index) => (index === 0 ? word : title(word))).join("");
    case "pascal":
      return lower.map(title).join("");
    case "snake":
      return lower.join("_");
    case "kebab":
      return lower.join("-");
    case "constant":
      return lower.join("_").toUpperCase();
  }
}

function symbolAt(list: string[], index: number): { symbol: Symbol; length: number } | null {
  for (const [words, symbol] of SYMBOLS) {
    const slice = list.slice(index, index + words.length).map((word) => word.toLowerCase());
    if (slice.length === words.length && slice.every((word, at) => word === words[at])) {
      return { symbol, length: words.length };
    }
  }
  return null;
}

/** A case command at `index`: "camel case", "camelcase". */
function caseAt(list: string[], index: number): { style: CaseStyle; length: number } | null {
  const first = list[index]?.toLowerCase() ?? "";
  const joined = first.match(/^(camel|snake|pascal|kebab|constant)case$/);
  if (joined) return { style: CASE_WORDS[joined[1]!]!, length: 1 };
  const style = CASE_WORDS[first];
  if (style && list[index + 1]?.toLowerCase() === "case") return { style, length: 2 };
  return null;
}

function convertLine(line: string): string {
  const list = tokens(line);
  const out: Piece[] = [];
  const word = (text: string): Piece => ({
    text,
    glueBefore: false,
    glueAfter: false,
    punctuation: false,
  });
  /** Pause commas next to spoken syntax are noise ("dash, dash, help"). */
  let dropComma = false;
  let index = 0;
  while (index < list.length) {
    const token = list[index]!;
    const command = caseAt(list, index);
    if (command) {
      index += command.length;
      while (list[index] === ",") index++;
      const words: string[] = [];
      while (
        index < list.length &&
        !PUNCTUATION.test(list[index]!) &&
        !symbolAt(list, index) &&
        !caseAt(list, index) &&
        !STOP_WORDS.has(list[index]!.toLowerCase())
      ) {
        words.push(list[index]!);
        index++;
      }
      if (words.length > 0) out.push(word(caseOf(command.style, words)));
      dropComma = false;
      continue;
    }
    const found = symbolAt(list, index);
    if (found) {
      if (out.at(-1)?.punctuation && out.at(-1)?.text === ",") out.pop();
      out.push({ ...found.symbol, punctuation: false });
      index += found.length;
      dropComma = true;
      continue;
    }
    if (PUNCTUATION.test(token)) {
      if (!(dropComma && token === ",")) {
        out.push({ text: token, glueBefore: true, glueAfter: false, punctuation: true });
      }
      index++;
      continue;
    }
    out.push(word(token));
    dropComma = false;
    index++;
  }
  let text = "";
  out.forEach((piece, at) => {
    const previous = out[at - 1];
    if (previous && !previous.glueAfter && !piece.glueBefore) text += " ";
    text += piece.text;
  });
  return text;
}

/** Converts spoken syntax line by line; text without any is returned unchanged. */
export function applySyntax(text: string): string {
  if (!ANY.test(text)) return text;
  return text
    .split("\n")
    .map((line) => (ANY.test(line) ? convertLine(line) : line))
    .join("\n");
}

/**
 * The code in a converted text (identifiers, flags, paths), so it can be written back exactly
 * after cleanup: the model may capitalise "userId" at the start of a line.
 */
export function codeTokens(text: string): string[] {
  const found = new Set<string>();
  for (const raw of text.split(/\s+/)) {
    const token = raw.replace(/[.,!?;:]+$/, "");
    if (/[a-z][A-Z]|[_/\\()[\]{}]|^-|\w[.:-]\w/.test(token) && /[\p{L}\p{N}]/u.test(token)) {
      found.add(token);
    }
  }
  return [...found];
}

/** Ends with a spoken sentence-end cue: then the output stays a sentence. */
const SENTENCE_CUE = /\s*\bfull[\s-]+stop[.!]?\s*$/i;

/**
 * Developer output (PZ-26): spoken syntax converted, and a single line kept as a command or
 * identifier: no final full stop, no sentence capital. `keep` lists words whose capital is
 * their own (dictionary and pack terms). Several sentences, several lines, or "full stop"
 * said at the end keep the text as prose.
 */
export function developerFormat(text: string, keep: ReadonlySet<string> = new Set()): string {
  if (SENTENCE_CUE.test(text)) {
    const body = applySyntax(text.replace(SENTENCE_CUE, "")).replace(/[.,;:]+$/, "");
    return body === "" ? body : `${body}.`;
  }
  const converted = applySyntax(text);
  const trimmed = converted.trim();
  if (trimmed.includes("\n") || /[.!?]\s+\S/.test(trimmed)) return converted;
  let line = trimmed.replace(/(?<![.])[.,;]+$/, "");
  const first = line.match(/^[A-Z][a-z]+(?=$|[\s,:;])/)?.[0];
  if (first && first !== "I" && !keep.has(first)) {
    line = first.toLowerCase() + line.slice(first.length);
  }
  return line;
}
