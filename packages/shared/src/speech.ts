import { z } from "zod";

/**
 * Speech recognition messages. Main owns the model files (download and SHA-256 check) and
 * tells the helper where they are; the helper loads them from disk and never downloads.
 */

export const transcribeLoadPayloadSchema = z.object({
  model: z.string().min(1),
  modelDir: z.string().startsWith("/"),
  tokenizerDir: z.string().startsWith("/"),
});
export type SpeechModelLoadInput = z.infer<typeof transcribeLoadPayloadSchema>;

export const transcribeLoadResultSchema = z.object({
  loadedModel: z.string(),
  loadMs: z.number().int().nonnegative(),
  computeUnits: z.string(),
});
export type SpeechModelLoadResult = z.infer<typeof transcribeLoadResultSchema>;

export const transcribeFilePayloadSchema = z.object({
  path: z.string().startsWith("/"),
  /** BCP-47 codes. Empty means detect the language. */
  languages: z.array(z.string().min(1)).max(20),
  /** Words already on screen, to help spell names and terms (DC-30). */
  prompt: z.string().max(2000).optional(),
});
export type TranscribeFileInput = z.infer<typeof transcribeFilePayloadSchema>;

export const transcriptSegmentSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
  confidence: z.number().min(0).max(1),
});

export const transcriptSchema = z.object({
  text: z.string(),
  language: z.string(),
  segments: z.array(transcriptSegmentSchema),
  decodeMs: z.number().int().nonnegative(),
  audioMs: z.number().int().nonnegative(),
});
export type Transcript = z.infer<typeof transcriptSchema>;
