// Writes Hindi (Devanagari) in Latin letters the way people type Hinglish (DC-18): no
// accents, the short "a" left off at the end of a word, "aa" and "ee" for long vowels inside
// a word and "a" and "i" at its end. Text that is already in Latin letters is untouched.
// Murmur's own table; it is simple on purpose and favours readability over strict rules.

const CONSONANTS: Record<string, string> = {
  क: "k",
  ख: "kh",
  ग: "g",
  घ: "gh",
  ङ: "n",
  च: "ch",
  छ: "chh",
  ज: "j",
  झ: "jh",
  ञ: "n",
  ट: "t",
  ठ: "th",
  ड: "d",
  ढ: "dh",
  ण: "n",
  त: "t",
  थ: "th",
  द: "d",
  ध: "dh",
  न: "n",
  प: "p",
  फ: "ph",
  ब: "b",
  भ: "bh",
  म: "m",
  य: "y",
  र: "r",
  ल: "l",
  व: "v",
  ळ: "l",
  श: "sh",
  ष: "sh",
  स: "s",
  ह: "h",
};

/** Consonants written with the nukta dot. */
const NUKTA: Record<string, string> = {
  क: "q",
  ख: "kh",
  ग: "g",
  ज: "z",
  ड: "r",
  ढ: "rh",
  फ: "f",
  य: "y",
};

const VOWELS: Record<string, [inside: string, end: string]> = {
  अ: ["a", "a"],
  आ: ["aa", "aa"],
  इ: ["i", "i"],
  ई: ["ee", "ee"],
  उ: ["u", "u"],
  ऊ: ["oo", "oo"],
  ऋ: ["ri", "ri"],
  ए: ["e", "e"],
  ऐ: ["ai", "ai"],
  ओ: ["o", "o"],
  औ: ["au", "au"],
  ऑ: ["o", "o"],
};

const SIGNS: Record<string, [inside: string, end: string]> = {
  "ा": ["aa", "a"],
  "ि": ["i", "i"],
  "ी": ["ee", "i"],
  "ु": ["u", "u"],
  "ू": ["oo", "u"],
  "ृ": ["ri", "ri"],
  "े": ["e", "e"],
  "ै": ["ai", "ai"],
  "ो": ["o", "o"],
  "ौ": ["au", "au"],
  "ॉ": ["o", "o"],
};

const VIRAMA = "्";
const NUKTA_SIGN = "़";
const NASALS = new Set(["ं", "ँ"]);
const VISARGA = "ः";
const DIGITS = "०१२३४५६७८९";
const DEVANAGARI = /[ऀ-ॿ]/;

export function hasDevanagari(text: string): boolean {
  return DEVANAGARI.test(text);
}

/** One word of Devanagari in Latin letters. */
function word(chars: string[]): string {
  let out = "";
  // Whether the last consonant still carries its inherent short "a".
  let pendingA = false;
  const isEnd = (index: number) =>
    index >= chars.length - 1 || (index === chars.length - 2 && NASALS.has(chars[index + 1]!));
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index]!;
    const next = chars[index + 1];
    if (CONSONANTS[char] !== undefined) {
      if (pendingA) out += "a";
      const nukta = next === NUKTA_SIGN;
      out += nukta ? (NUKTA[char] ?? CONSONANTS[char]) : CONSONANTS[char];
      if (nukta) index++;
      pendingA = true;
      continue;
    }
    if (char === VIRAMA) {
      pendingA = false;
      continue;
    }
    const sign = SIGNS[char];
    if (sign) {
      out += isEnd(index) ? sign[1] : sign[0];
      pendingA = false;
      continue;
    }
    const vowel = VOWELS[char];
    if (vowel) {
      if (pendingA) out += "a";
      pendingA = false;
      out += isEnd(index) ? vowel[1] : vowel[0];
      continue;
    }
    if (NASALS.has(char)) {
      if (pendingA) out += "a";
      pendingA = false;
      out += "n";
      continue;
    }
    if (char === VISARGA) {
      if (pendingA) out += "a";
      pendingA = false;
      out += "h";
      continue;
    }
    const digit = DIGITS.indexOf(char);
    if (digit >= 0) {
      if (pendingA) out += "a";
      pendingA = false;
      out += String(digit);
      continue;
    }
    if (pendingA) out += "a";
    pendingA = false;
    out += char;
  }
  // The short "a" at the end of a word is not written, except in a one-letter word.
  if (pendingA && out.length <= 2) out += "a";
  return out;
}

/** Rewrites every Devanagari run in the text in Latin letters; the rest stays as it is. */
export function toLatinHindi(text: string): string {
  if (!hasDevanagari(text)) return text;
  return text.replace(/[ऀ-ॿ]+/g, (run) => word([...run])).replace(/[।॥]/g, ".");
}
