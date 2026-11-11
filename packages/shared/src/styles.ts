import { z } from "zod";

// Styles per context (PZ-11, PZ-12) and app categories (PZ-13). The preset rules are pure and
// shared, so the Hub's example line is produced by the same code as a dictation.

export const STYLE_CATEGORIES = ["personal", "work", "email", "other"] as const;
export type StyleCategory = (typeof STYLE_CATEGORIES)[number];

/** Categories an app can be put in. Developer is used by the developer features (PZ-26). */
export const APP_CATEGORIES = [...STYLE_CATEGORIES, "developer"] as const;
export type AppCategory = (typeof APP_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<AppCategory, string> = {
  personal: "Personal",
  work: "Work",
  email: "Email",
  other: "Other",
  developer: "Developer",
};

export const STYLE_PRESETS = [
  "caps",
  "no-caps-less",
  "no-caps-no-stop",
  "exclaim",
  "formal",
  "custom",
] as const;
export type StylePreset = (typeof STYLE_PRESETS)[number];

export interface StyleFlags {
  capitalisation: "standard" | "none";
  punctuation: "full" | "light" | "minimal";
  emphasis: "normal" | "expressive";
}

export interface PresetInfo {
  label: string;
  flags: StyleFlags;
  /** Told to the cleanup model; null when the rules do all the work. */
  instruction: string | null;
}

const STANDARD: StyleFlags = {
  capitalisation: "standard",
  punctuation: "full",
  emphasis: "normal",
};

export const PRESETS: Record<StylePreset, PresetInfo> = {
  caps: { label: "Caps and punctuation", flags: STANDARD, instruction: null },
  "no-caps-less": {
    label: "No caps, less punctuation",
    flags: { capitalisation: "none", punctuation: "light", emphasis: "normal" },
    instruction: null,
  },
  "no-caps-no-stop": {
    label: "No caps, no full stops",
    flags: { capitalisation: "none", punctuation: "minimal", emphasis: "normal" },
    instruction: null,
  },
  exclaim: {
    label: "More exclamations",
    flags: { ...STANDARD, emphasis: "expressive" },
    instruction:
      "Where the speaker clearly sounds excited, an exclamation mark may end the sentence instead of a full stop.",
  },
  formal: {
    label: "Formal",
    flags: STANDARD,
    instruction: "Write formally: no slang. Keep the speaker's words otherwise.",
  },
  custom: { label: "Custom", flags: STANDARD, instruction: null },
};

export const DEFAULT_PRESETS: Record<StyleCategory, StylePreset> = {
  personal: "no-caps-less",
  work: "caps",
  email: "formal",
  other: "caps",
};

export const STYLE_INSTRUCTIONS_MAX = 500;

/** The sentence every preset's example is made from. */
export const STYLE_EXAMPLE_INPUT =
  "Sounds good. I'll send the notes tonight. Can you check them tomorrow?";

/** A word that keeps its capital: I, I'm, acronyms, and words with capitals inside. */
function keepsCapital(word: string, keep: ReadonlySet<string>): boolean {
  if (/^I(['’][a-z]+)?$/.test(word)) return true;
  if (word.length > 1 && word === word.toUpperCase()) return true;
  if (/\p{Ll}\p{Lu}/u.test(word)) return true;
  return keep.has(word.replace(/[^\p{L}\p{N}'’-]/gu, "").toLowerCase());
}

/**
 * The preset's rules, applied after cleanup. `keep` holds words that are names or terms
 * (lower case), whose capitals are never taken away.
 */
export function applyStyleRules(
  text: string,
  flags: StyleFlags,
  keep: ReadonlySet<string> = new Set(),
): string {
  let out = text;
  if (flags.capitalisation === "none") {
    // The first word of the text, of each line and after a sentence end.
    out = out.replace(
      /(^|[.!?]\s+|\n\s*)(\p{Lu}[\p{L}'’-]*)/gu,
      (match, lead: string, word: string) =>
        keepsCapital(word, keep) ? match : `${lead}${word[0]!.toLowerCase()}${word.slice(1)}`,
    );
  }
  if (flags.punctuation === "light") {
    // No full stop at the end of a line (an ellipsis stays).
    out = out.replace(/(?<![.])\.(?=[ \t]*(\n|$))/g, "");
  } else if (flags.punctuation === "minimal") {
    // No full stops after words at all; numbers, abbreviations inside words and links stay.
    out = out.replace(/(?<=[\p{L}\p{N}])\.(?=\s|$)/gu, "");
  }
  return out;
}

export const styleSchema = z.strictObject({
  id: z.string().min(1),
  category: z.enum(STYLE_CATEGORIES),
  preset: z.enum(STYLE_PRESETS),
  instructions: z.string().max(STYLE_INSTRUCTIONS_MAX),
  updatedAt: z.number().int(),
});
export type Style = z.infer<typeof styleSchema>;

export const styleUpdateSchema = z.strictObject({
  category: z.enum(STYLE_CATEGORIES),
  preset: z.enum(STYLE_PRESETS),
  instructions: z.string().max(STYLE_INSTRUCTIONS_MAX),
});
export type StyleUpdate = z.infer<typeof styleUpdateSchema>;

export const appCategoryOverrideSchema = z.strictObject({
  bundleId: z.string().min(1).max(255),
  appName: z.string().max(255).nullable(),
  category: z.enum(APP_CATEGORIES),
});
export type AppCategoryOverride = z.infer<typeof appCategoryOverrideSchema>;

/** An app the Hub can offer for an override: seen in history, with how it is placed now. */
export const knownAppSchema = z.strictObject({
  bundleId: z.string(),
  appName: z.string().nullable(),
  category: z.enum(APP_CATEGORIES),
  source: z.enum(["default", "user", "unknown"]),
});
export type KnownApp = z.infer<typeof knownAppSchema>;

export const stylesViewSchema = z.strictObject({
  styles: z.array(styleSchema),
  overrides: z.array(appCategoryOverrideSchema),
  recentApps: z.array(knownAppSchema),
});
export type StylesView = z.infer<typeof stylesViewSchema>;
