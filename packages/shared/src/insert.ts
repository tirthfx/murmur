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
  /** Press Return after the text, if the same app is still in front (DC-36). */
  pressEnter: z.boolean().optional(),
  /** Bundle ids where `auto` types and leaves the clipboard alone (remote desktops). */
  typeInApps: z.array(z.string()).max(200).optional(),
  /** Bundle ids where newlines at the end of the text are dropped (terminals). */
  trimTrailingNewlinesInApps: z.array(z.string()).max(200).optional(),
  /**
   * The same text as HTML (rich snippets, PZ-09). Pasted beside the plain text, so apps that
   * take rich text get it; typing and the trimmed-newline apps get the plain text only.
   */
  html: z.string().max(400_000).optional(),
});
export type InsertTextInput = z.infer<typeof insertTextPayloadSchema>;

export const insertTextResultSchema = z.object({
  method: z.enum(INSERT_METHODS),
  /** The events were posted. The helper cannot always know the app accepted them. */
  delivered: z.boolean(),
  /** Null when restoring was not asked for or the text was typed. */
  clipboardRestored: z.boolean().nullable(),
  /** The app that was in front when the text went in. */
  appBundleId: z.string().nullable().optional(),
  /** Null when Return was not asked for; false when another app had come to the front. */
  enterPressed: z.boolean().nullable().optional(),
});
export type InsertTextResult = z.infer<typeof insertTextResultSchema>;

export const insertCopyPayloadSchema = z.object({ text: z.string() });
