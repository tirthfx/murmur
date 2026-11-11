import { z } from "zod";

/**
 * The focused field around the caret (DC-30). Read at the start of a dictation, held in
 * memory for that dictation only, never written to disk. Secure fields carry no text.
 */

export const CONTEXT_MAX_BEFORE = 1500;
export const CONTEXT_MAX_AFTER = 300;

export const contextSnapshotPayloadSchema = z.object({
  maxBefore: z.number().int().min(0).max(CONTEXT_MAX_BEFORE).optional(),
  maxAfter: z.number().int().min(0).max(CONTEXT_MAX_AFTER).optional(),
});
export type ContextSnapshotInput = z.infer<typeof contextSnapshotPayloadSchema>;

export const focusContextSchema = z.object({
  appName: z.string().nullable(),
  bundleId: z.string().nullable(),
  windowTitle: z.string().nullable(),
  role: z.string().nullable(),
  subrole: z.string().nullable(),
  editable: z.boolean(),
  secure: z.boolean(),
  textBefore: z.string(),
  textAfter: z.string(),
});
export type FocusContext = z.infer<typeof focusContextSchema>;
