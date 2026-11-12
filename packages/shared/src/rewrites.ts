import { z } from "zod";

// Rewrites (RW-02, RW-03): saved instructions that reshape selected text. Five are built in;
// the owner adds their own. The wording of the built-ins is Murmur's own.

export const REWRITE_LIMITS = {
  name: 40,
  instruction: 1000,
  example: 1000,
  /** Custom Rewrites (RW-03); built-ins do not count. */
  custom: 50,
  /** Rewrites with their own shortcut (RW-04). */
  shortcuts: 20,
} as const;

/** Keys as named in the data model. `concise` is shown as "Tighten". */
export const BUILTIN_REWRITE_KEYS = [
  "clarify",
  "concise",
  "keep_tone",
  "structure",
  "reorder",
] as const;
export type BuiltinRewriteKey = (typeof BUILTIN_REWRITE_KEYS)[number];

export interface BuiltinRewrite {
  key: BuiltinRewriteKey;
  name: string;
  /** One line under the name in the list. */
  description: string;
  /** What the model is asked to do. */
  instruction: string;
}

/** In their default order. */
export const BUILTIN_REWRITES: readonly BuiltinRewrite[] = [
  {
    key: "clarify",
    name: "Clarify",
    description: "Reword so the meaning is clearer. Keeps facts and names.",
    instruction:
      "Reword the text so its meaning is clearer and easier to follow. Keep every fact, name and number, and keep it about the same length.",
  },
  {
    key: "concise",
    name: "Tighten",
    description: "Make it shorter. Removes repeats and filler, keeps every fact.",
    instruction:
      "Make the text shorter. Remove repeated points, filler words and hedging, but keep every fact, name and request. Keep each number exactly as written, digits as digits.",
  },
  {
    key: "keep_tone",
    name: "Keep tone",
    description: "Fix grammar, spelling and punctuation only.",
    instruction:
      "Correct only spelling, grammar and punctuation. Keep the author's words, word order and tone. Do not rephrase, shorten or add anything.",
  },
  {
    key: "structure",
    name: "Structure",
    description: "Add headings, bullets or numbered steps. Adds no content.",
    instruction:
      "Lay the text out clearly: use short headings, bullet points or numbered steps where the content has that shape. Do not add, remove or change any content.",
  },
  {
    key: "reorder",
    name: "Reorder",
    description: "Put sentences or points in a more logical order.",
    instruction:
      "Put the sentences or points in a more logical order. Keep the wording of each sentence exactly the same; only change their order.",
  },
];

export const REWRITE_CATEGORIES = ["personal", "work", "email", "other"] as const;

export const rewriteSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Null for custom Rewrites. */
  builtinKey: z.enum(BUILTIN_REWRITE_KEYS).nullable(),
  /** Built-ins only; empty for custom ones. */
  description: z.string(),
  instruction: z.string().min(1),
  example: z.string().nullable(),
  enabled: z.boolean(),
  sortOrder: z.number().int(),
  /** Its own shortcut (RW-04), as stored; null when none. */
  shortcut: z.string().nullable(),
  /** The shortcut as the Mac names it ("Control+Option+T"); filled in by main. */
  shortcutLabel: z.string().nullable(),
  applyDirectly: z.boolean(),
  autoApply: z.boolean(),
  autoApplyMinWords: z.number().int().min(0),
  autoApplyCategories: z.array(z.enum(REWRITE_CATEGORIES)),
  useCount: z.number().int().min(0),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Rewrite = z.infer<typeof rewriteSchema>;

/** Creates (no id) or edits a custom Rewrite. Built-ins cannot be edited, only switched. */
export const rewriteInputSchema = z.strictObject({
  id: z.string().min(1).optional(),
  name: z.string().max(REWRITE_LIMITS.name + 20),
  instruction: z.string().max(REWRITE_LIMITS.instruction + 200),
  example: z
    .string()
    .max(REWRITE_LIMITS.example + 200)
    .nullable(),
  enabled: z.boolean(),
});
export type RewriteInput = z.infer<typeof rewriteInputSchema>;

export const REWRITE_SAVE_REASONS = [
  "empty-name",
  "empty-instruction",
  "name-too-long",
  "instruction-too-long",
  "example-too-long",
  "duplicate-name",
  "full",
  "built-in",
  "not-found",
] as const;

export const rewriteSaveResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), rewrite: rewriteSchema }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum(REWRITE_SAVE_REASONS),
    message: z.string(),
  }),
]);
export type RewriteSaveResult = z.infer<typeof rewriteSaveResultSchema>;

export const rewriteShortcutResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type RewriteShortcutResult = z.infer<typeof rewriteShortcutResultSchema>;
