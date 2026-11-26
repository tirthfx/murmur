/**
 * Smart Formatting (DC-29): numbers, times, dates, money, percentages, email addresses and
 * links written the usual way. English only, rules only, and cautious: when a phrase could
 * mean something else it stays as spoken. The speech model already writes many of these.
 */

const UNITS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SCALES: Record<string, number> = { thousand: 1_000, million: 1_000_000, billion: 1e9 };

const ORDINAL_DAYS: Record<string, number> = Object.fromEntries(
  [
    "first second third fourth fifth sixth seventh eighth ninth tenth",
    "eleventh twelfth thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth",
    "nineteenth twentieth",
  ]
    .join(" ")
    .split(" ")
    .map((word, index) => [word, index + 1]),
);

const MONTHS = new Set(
  "january february march april may june july august september october november december".split(
    " ",
  ),
);

/** Endings that make "name dot com" an address. */
const TLDS = "com|org|net|io|co|in|uk|edu|gov|dev|ai|app|me";

/** Words that are never the name before "at" in a spoken email address. */
const NOT_A_NAME = new Set(
  (
    "a an and are am at back be been being call check email find go going good great have he " +
    "here host hosted i is it its live look looking mail me meet meeting more not now of on " +
    "or out page posted see seen she site staying stay that the them there they this to up us " +
    "visit was we were website work working you your available online listed sold up"
  ).split(" "),
);

/** Words that cannot start a spoken link ("the dot com bubble"). */
const NOT_A_HOST = new Set("a an and the this that dot of to or its their our your my".split(" "));

type Part = { value: number; kind: "unit" | "teen" | "tens" | "hundred" | "scale" };

function part(word: string): Part | null {
  const lower = word.toLowerCase();
  if (lower in UNITS) {
    const value = UNITS[lower]!;
    return { value, kind: value < 10 ? "unit" : "teen" };
  }
  if (lower in TENS) return { value: TENS[lower]!, kind: "tens" };
  if (lower === "hundred") return { value: 100, kind: "hundred" };
  if (lower in SCALES) return { value: SCALES[lower]!, kind: "scale" };
  const compound = /^([a-z]+)-([a-z]+)$/.exec(lower);
  if (compound && compound[1]! in TENS && (UNITS[compound[2]!] ?? 10) < 10) {
    return { value: TENS[compound[1]!]! + UNITS[compound[2]!]!, kind: "teen" };
  }
  return null;
}

/**
 * Reads one cardinal number from the words at `start`: how many words it used and its value,
 * or null. "Twenty twenty six" is two numbers, so the caller sees a second one right after.
 */
export function readNumber(
  words: readonly string[],
  start: number,
): { value: number; length: number } | null {
  let total = 0;
  let group = 0;
  let index = start;
  let last: Part["kind"] | null = null;
  let lastScale = Number.POSITIVE_INFINITY;
  while (index < words.length) {
    const word = words[index]!;
    if (word.toLowerCase() === "and" && (last === "hundred" || last === "scale")) {
      const next = part(words[index + 1] ?? "");
      if (next && next.kind !== "hundred" && next.kind !== "scale") {
        index++;
        continue;
      }
      break;
    }
    const read = part(word);
    if (!read) break;
    if (read.kind === "unit" || read.kind === "teen") {
      if (last === "unit" || last === "teen" || (last === "tens" && read.kind !== "unit")) break;
      group += read.value;
    } else if (read.kind === "tens") {
      if (last === "unit" || last === "teen" || last === "tens") break;
      group += read.value;
    } else if (read.kind === "hundred") {
      if (last === null || last === "scale" || group === 0 || group >= 100) break;
      group *= 100;
    } else {
      if (last === null || group === 0 || read.value >= lastScale) break;
      total += group * read.value;
      group = 0;
      lastScale = read.value;
    }
    last = read.kind;
    index++;
  }
  if (index === start) return null;
  return { value: total + group, length: index - start };
}

interface Token {
  lead: string;
  word: string;
  trail: string;
}

function tokenize(line: string): Token[] {
  return line
    .split(" ")
    .filter(Boolean)
    .map((raw) => {
      const match = /^([("'“‘[]*)(.*?)([)"'”’\].,!?;:…]*)$/u.exec(raw);
      return { lead: match?.[1] ?? "", word: match?.[2] ?? raw, trail: match?.[3] ?? "" };
    });
}

const render = (tokens: readonly Token[]) =>
  tokens.map((token) => token.lead + token.word + token.trail).join(" ");

/** The words from `start` up to the first punctuation: a number never crosses a pause. */
function phrase(tokens: readonly Token[], start: number): string[] {
  const words: string[] = [];
  for (let index = start; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (index > start && token.lead !== "") break;
    words.push(token.word);
    if (token.trail !== "") break;
  }
  return words;
}

function digits(word: string | undefined): number | null {
  return word !== undefined && /^\d+(,\d{3})*$/.test(word) ? Number(word.replace(/,/g, "")) : null;
}

/** A number said in words or already written in digits. */
function numberAt(
  tokens: readonly Token[],
  start: number,
): { value: number; length: number } | null {
  const words = phrase(tokens, start);
  const written = digits(words[0]);
  if (written !== null) return { value: written, length: 1 };
  return readNumber(words, 0);
}

/** Digits with commas from ten thousand up; round millions and billions keep their word. */
function grouped(value: number): string {
  for (const [size, word] of [
    [1e9, "billion"],
    [1e6, "million"],
  ] as const) {
    if (value >= size && value % (size / 10) === 0) return `${value / size} ${word}`;
  }
  return value >= 10_000 ? value.toLocaleString("en-US") : String(value);
}

const CURRENCIES: Record<string, string> = {
  dollar: "$",
  dollars: "$",
  euro: "€",
  euros: "€",
  rupee: "₹",
  rupees: "₹",
};

const period = (word: string): "AM" | "PM" | null => {
  const lower = word.toLowerCase().replace(/\./g, "");
  return lower === "am" ? "AM" : lower === "pm" ? "PM" : null;
};

interface Match {
  text: string;
  /** Tokens replaced, from the start. */
  length: number;
}

/** "two thirty pm" and "2 30 p.m." → "2:30 PM"; "five pm" → "5 PM". */
function timeAt(tokens: readonly Token[], start: number): Match | null {
  const first = tokens[start]!;
  const hour = digits(first.word) ?? UNITS[first.word.toLowerCase()] ?? null;
  if (hour === null || hour < 1 || hour > 12 || first.trail !== "") return null;
  let index = start + 1;
  let minutes: number | null = null;
  const second = tokens[index];
  if (!second) return null;
  if (period(second.word) === null) {
    if (second.word.toLowerCase() === "oh") {
      const unit = UNITS[tokens[index + 1]?.word.toLowerCase() ?? ""];
      if (unit === undefined || unit > 9) return null;
      minutes = unit;
      index += 2;
    } else {
      const read = numberAt(tokens, index);
      if (!read || read.value < 10 || read.value > 59) return null;
      minutes = read.value;
      index += read.length;
    }
  }
  const marker = tokens[index];
  const half = marker ? period(marker.word) : null;
  if (!half || !marker || tokens[index - 1]!.trail !== "") return null;
  // "p.m." loses its last stop to the trail; only a sentence's own end is kept.
  const dotted = /\./.test(marker.word);
  const trail =
    dotted && index < tokens.length - 1 ? marker.trail.replace(/^\./, "") : marker.trail;
  const clock = minutes === null ? String(hour) : `${hour}:${String(minutes).padStart(2, "0")}`;
  return { text: `${first.lead}${clock} ${half}${trail}`, length: index - start + 1 };
}

/** "fifty dollars" → "$50", "three dollars and twenty cents" → "$3.20", "ten percent" → "10%". */
function amountAt(tokens: readonly Token[], start: number): Match | null {
  const read = numberAt(tokens, start);
  if (!read) return null;
  const unitAt = start + read.length;
  const unit = tokens[unitAt];
  if (!unit || tokens[unitAt - 1]!.trail !== "" || unit.lead !== "") return null;
  const word = unit.word.toLowerCase();
  const lead = tokens[start]!.lead;
  if (word === "percent") {
    return { text: `${lead}${grouped(read.value)}%${unit.trail}`, length: read.length + 1 };
  }
  const symbol = CURRENCIES[word];
  if (!symbol) return null;
  if (unit.trail === "" && tokens[unitAt + 1]?.word.toLowerCase() === "and") {
    const cents = numberAt(tokens, unitAt + 2);
    const label = tokens[unitAt + 2 + (cents?.length ?? 0)];
    if (cents && cents.value < 100 && /^cents?$/i.test(label?.word ?? "")) {
      const amount = `${grouped(read.value)}.${String(cents.value).padStart(2, "0")}`;
      return {
        text: `${lead}${symbol}${amount}${label!.trail}`,
        length: read.length + 3 + cents.length,
      };
    }
  }
  return { text: `${lead}${symbol}${grouped(read.value)}${unit.trail}`, length: read.length + 1 };
}

/** "March fifth" → "March 5", "March twenty first" → "March 21". */
function dateAt(tokens: readonly Token[], start: number): Match | null {
  const month = tokens[start]!;
  const lower = month.word.toLowerCase();
  if (!MONTHS.has(lower) || month.trail !== "") return null;
  // "may" and "march" are verbs too: they must be written as a month, after a date word.
  if (lower === "may" || lower === "march") {
    const before = tokens[start - 1]?.word.toLowerCase() ?? "";
    const dated = /^(on|in|by|of|until|till|from|since|before|after|is|for)$/.test(before);
    if (month.word[0] !== month.word[0]!.toUpperCase() || !dated) return null;
  }
  const first = tokens[start + 1];
  if (!first) return null;
  const word = first.word.toLowerCase();
  let day: number | null = ORDINAL_DAYS[word] ?? null;
  let length = 2;
  const tens = word === "twenty" ? 20 : word === "thirty" ? 30 : null;
  if (tens !== null && first.trail === "") {
    const unit = ORDINAL_DAYS[tokens[start + 2]?.word.toLowerCase() ?? ""];
    if (unit !== undefined && unit < 10) {
      day = tens + unit;
      length = 3;
    }
  }
  const compound = /^(twenty|thirty)-([a-z]+)$/.exec(word);
  if (compound) {
    const unit = ORDINAL_DAYS[compound[2]!];
    if (unit !== undefined && unit < 10) day = (compound[1] === "twenty" ? 20 : 30) + unit;
  }
  if (word === "thirtieth") day = 30;
  if (day === null || day > 31) return null;
  // "In May first thing" is not the first of May.
  if (/^(thing|of)$/i.test(tokens[start + length]?.word ?? "") && day === 1) return null;
  const name = month.word[0]!.toUpperCase() + month.word.slice(1);
  return { text: `${month.lead}${name} ${day}${tokens[start + length - 1]!.trail}`, length };
}

/** "twenty five people" → "25 people". Below ten stays in words. */
function plainNumberAt(tokens: readonly Token[], start: number): Match | null {
  const words = phrase(tokens, start);
  const read = readNumber(words, 0);
  if (!read) return null;
  // The tail of "a hundred and twenty" stays with its words.
  const before = tokens[start - 1]?.word.toLowerCase() ?? "";
  const earlier = before === "and" ? (tokens[start - 2]?.word.toLowerCase() ?? "") : before;
  if (/^(hundred|thousand|million|billion)$/.test(earlier)) {
    const end = start + read.length;
    return { text: render(tokens.slice(start, end)), length: read.length };
  }
  const end = start + read.length;
  // Two numbers in a row ("twenty twenty six") are a year or a code: both stay as said.
  const next = tokens[end - 1]!.trail === "" ? numberAt(tokens, end) : null;
  if (next)
    return {
      text: render(tokens.slice(start, end + next.length)),
      length: read.length + next.length,
    };
  if (read.value < 10) return { text: render(tokens.slice(start, end)), length: read.length };
  return {
    text: `${tokens[start]!.lead}${grouped(read.value)}${tokens[end - 1]!.trail}`,
    length: read.length,
  };
}

const HOST_LABEL = "[A-Za-z0-9][A-Za-z0-9-]*";
const SPOKEN_DOMAIN = `(?:${HOST_LABEL}\\s+dot\\s+)+(?:${TLDS})`;

const EMAIL = new RegExp(
  `\\b(${HOST_LABEL}(?:\\s+(?:dot|underscore)\\s+${HOST_LABEL})*)\\s+at\\s+(${SPOKEN_DOMAIN})\\b`,
  "gi",
);
/** An address the speech model already joined on one side: "john at example.com". */
const HALF_EMAIL = new RegExp(
  `\\b([A-Za-z0-9._-]+)\\s+at\\s+((?:${HOST_LABEL}\\.)+(?:${TLDS}))\\b`,
  "gi",
);
const LINK = new RegExp(`\\b(${SPOKEN_DOMAIN})\\b((?:\\s+slash\\s+${HOST_LABEL})*)`, "gi");

const joinDomain = (spoken: string) => spoken.replace(/\s+dot\s+/gi, ".").toLowerCase();

function addresses(text: string): string {
  const email = (whole: string, name: string, domain: string) => {
    const local = name
      .replace(/\s+dot\s+/gi, ".")
      .replace(/\s+underscore\s+/gi, "_")
      .toLowerCase();
    if (NOT_A_NAME.has(local)) return whole;
    return `${local}@${joinDomain(domain)}`;
  };
  return text
    .replace(EMAIL, email)
    .replace(HALF_EMAIL, email)
    .replace(LINK, (whole, domain: string, path: string) => {
      if (NOT_A_HOST.has(domain.split(/\s+/)[0]!.toLowerCase())) return whole;
      return joinDomain(domain) + path.replace(/\s+slash\s+/gi, "/").toLowerCase();
    });
}

function line(text: string): string {
  const tokens = tokenize(addresses(text));
  const out: string[] = [];
  for (let index = 0; index < tokens.length;) {
    const match =
      timeAt(tokens, index) ??
      amountAt(tokens, index) ??
      dateAt(tokens, index) ??
      plainNumberAt(tokens, index);
    if (match) {
      out.push(match.text);
      index += match.length;
    } else {
      out.push(render([tokens[index]!]));
      index++;
    }
  }
  return out.join(" ");
}

/** The text with Smart Formatting applied, line by line. */
export function smartFormat(text: string): string {
  return text.split("\n").map(line).join("\n");
}
