import { z } from "zod";

// Learning from corrections (PZ-02): after an insertion the helper watches the same field and
// reports only the words that were changed inside the inserted text, never the field.

/** Longest watch after an insertion. */
export const EDIT_WATCH_MAX_MS = 60_000;
/** Longest changed span the helper reports, per side. */
export const EDIT_SPAN_MAX_CHARS = 200;

export const editsWatchPayloadSchema = z.object({
  /** The text that was just inserted, to find in the field. */
  text: z.string().min(1).max(20_000),
  durationMs: z.number().int().min(1_000).max(EDIT_WATCH_MAX_MS),
});
export type EditsWatchInput = z.infer<typeof editsWatchPayloadSchema>;

export const editsWatchResultSchema = z.object({
  /** False when the field could not be read or the text was not found in it. */
  watching: z.boolean(),
});

export const editsCancelResultSchema = z.object({ cancelled: z.boolean() });

export const editsChangedPayloadSchema = z.object({
  /** The inserted words that were changed. */
  before: z.string().max(EDIT_SPAN_MAX_CHARS),
  /** What they became. */
  after: z.string().max(EDIT_SPAN_MAX_CHARS),
});
export type EditsChanged = z.infer<typeof editsChangedPayloadSchema>;
