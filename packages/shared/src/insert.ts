import { z } from "zod";

/**
 * Text insertion into the focused field. The helper saves the whole clipboard, pastes,
 * waits `restoreDelayMs`, and restores it unless something else changed it meanwhile.
 */

export const INSERT_METHODS = ["auto", "paste_cmd_v", "keystrokes"] as const;

export const insertTextPayloadSchema = z.object({
  text: z.string(),
  method: z.enum(INSERT_METHODS),
  restoreClipboard: z.boolean(),
  restoreDelayMs: z.number().int().min(0).max(2000),
});
export type InsertTextInput = z.infer<typeof insertTextPayloadSchema>;

export const insertTextResultSchema = z.object({
  method: z.enum(INSERT_METHODS),
  /** The events were posted. The helper cannot always know the app accepted them. */
  delivered: z.boolean(),
  /** Null when restoring was not asked for or the text was typed. */
  clipboardRestored: z.boolean().nullable(),
});
export type InsertTextResult = z.infer<typeof insertTextResultSchema>;

export const insertCopyPayloadSchema = z.object({ text: z.string() });
