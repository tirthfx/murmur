import { z } from "zod";

// The personal Dictionary (PZ-01, PZ-03, PZ-04): terms Murmur should spell exactly, and
// replacements from a spoken or recognised form to a written one.

export const DICTIONARY_LIMITS = {
  entries: 5_000,
  replacements: 1_000,
  starred: 200,
  termLength: 60,
  replacementLength: 500,
  /** Terms sent to the speech model and cleanup, after the starred ones. */
  promptTerms: 200,
  /** Uses above which deleting an entry asks first. */
  confirmDeleteAbove: 20,
} as const;

export const DICTIONARY_SOURCES = ["manual", "auto", "import"] as const;
export type DictionarySource = (typeof DICTIONARY_SOURCES)[number];

export const dictionaryEntrySchema = z.strictObject({
  id: z.string().min(1),
  term: z.string().min(1).max(DICTIONARY_LIMITS.termLength),
  /** Null for a term: it is spelled exactly, not replaced. */
  replacement: z.string().min(1).max(DICTIONARY_LIMITS.replacementLength).nullable(),
  caseSensitive: z.boolean(),
  source: z.enum(DICTIONARY_SOURCES),
  starred: z.boolean(),
  useCount: z.number().int().min(0),
  /** A phrase was learned from final text (PZ-05); a term is everything else. */
  kind: z.enum(["term", "phrase"]),
  /** A pronunciation clip is saved for it (PZ-06). */
  hasClip: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type DictionaryEntry = z.infer<typeof dictionaryEntrySchema>;

/** What the Hub sends to add (no id) or change (with id) an entry. */
export const dictionaryInputSchema = z.strictObject({
  id: z.string().min(1).optional(),
  term: z.string().max(DICTIONARY_LIMITS.termLength + 20),
  replacement: z
    .string()
    .max(DICTIONARY_LIMITS.replacementLength + 20)
    .nullable(),
  caseSensitive: z.boolean(),
  starred: z.boolean(),
});
export type DictionaryInput = z.infer<typeof dictionaryInputSchema>;

export const DICTIONARY_REFUSALS = [
  "empty",
  "too-long",
  "duplicate",
  "full",
  "too-many-replacements",
  "too-many-starred",
  "not-found",
] as const;
export type DictionaryRefusal = (typeof DICTIONARY_REFUSALS)[number];

export const dictionarySaveResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), entry: dictionaryEntrySchema }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum(DICTIONARY_REFUSALS),
    message: z.string(),
    /** The entry that already has this term, for "duplicate". */
    existing: dictionaryEntrySchema.optional(),
  }),
]);
export type DictionarySaveResult = z.infer<typeof dictionarySaveResultSchema>;

/** Pronunciation clips (PZ-06): starting, stopping or saving a clip. */
export const dictionaryClipResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), durationMs: z.number().int().min(0) }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type DictionaryClipResult = z.infer<typeof dictionaryClipResultSchema>;
