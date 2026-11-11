import { z } from "zod";

// Memory (PZ-18, PZ-19): short facts the owner wants the cleanup model to know.

export const MEMORY_LIMITS = {
  items: 200,
  textLength: 300,
  keywords: 8,
  /** Items given to the model in one dictation. */
  perDictation: 20,
  /** Characters of facts in one prompt (about 800 tokens). */
  promptChars: 3_200,
  /** How long a "remember that" question waits on the Bar. */
  offerMs: 5 * 60_000,
} as const;

export const MEMORY_SOURCES = ["manual", "dictation", "note", "meeting"] as const;

export const memoryItemSchema = z.strictObject({
  id: z.string().min(1),
  text: z.string().min(1),
  keywords: z.array(z.string()),
  /** True when the keywords were picked from the text, not typed by the owner. */
  autoKeywords: z.boolean(),
  source: z.enum(MEMORY_SOURCES),
  enabled: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type MemoryItem = z.infer<typeof memoryItemSchema>;

export const memoryInputSchema = z.strictObject({
  id: z.string().min(1).optional(),
  text: z.string().max(MEMORY_LIMITS.textLength + 50),
  /** Null picks keywords from the text. */
  keywords: z.array(z.string().max(60)).max(20).nullable(),
  enabled: z.boolean(),
});
export type MemoryInput = z.infer<typeof memoryInputSchema>;

export const memorySaveResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), item: memoryItemSchema }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum(["empty", "too-long", "full", "not-found"]),
    message: z.string(),
  }),
]);
export type MemorySaveResult = z.infer<typeof memorySaveResultSchema>;
