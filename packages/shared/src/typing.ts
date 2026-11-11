import { z } from "zod";

/**
 * Typing reminder (DC-08). The helper counts typed words from key presses alone (never the
 * characters) while main has asked it to, and reports only the count.
 */

export const typingWatchPayloadSchema = z.object({ enabled: z.boolean() });
export const typingWatchResultSchema = z.object({ watching: z.boolean() });

export const typingActivityPayloadSchema = z.object({
  words: z.number().int().positive(),
  periodMs: z.number().int().positive(),
});
export type TypingActivity = z.infer<typeof typingActivityPayloadSchema>;
