import { z } from "zod";

/**
 * First-run setup (DC-44): what the Hub needs to know about the speech model and about
 * anything that still blocks dictation.
 */

/** The models Murmur keeps on this Mac (HB-15). */
export const MODEL_IDS = ["speech", "fast", "quality"] as const;
export const modelIdSchema = z.enum(MODEL_IDS);
export type ModelId = z.infer<typeof modelIdSchema>;

export const MODEL_STATES = [
  /** Not on disk, or only part of it. */
  "missing",
  /** On disk, but a file failed its size or checksum test. */
  "corrupt",
  "downloading",
  /** On disk; being checked or loaded. */
  "preparing",
  "ready",
  /** The download or the load failed; `message` says why. */
  "failed",
] as const;
export type ModelState = (typeof MODEL_STATES)[number];

export const modelStatusSchema = z.strictObject({
  id: modelIdSchema,
  state: z.enum(MODEL_STATES),
  label: z.string(),
  /** Where a download comes from. */
  host: z.string(),
  totalBytes: z.number().int().nonnegative(),
  /** Bytes it takes on disk now, a part-finished download included. */
  diskBytes: z.number().int().nonnegative(),
  /** Bytes present so far while downloading; 0 otherwise. */
  downloadedBytes: z.number().int().nonnegative(),
  message: z.string().nullable(),
});
export type ModelStatus = z.infer<typeof modelStatusSchema>;

/** A missing piece without which dictation does not start. */
export const DICTATION_BLOCKERS = [
  "helper",
  "microphone",
  "accessibility",
  "inputMonitoring",
  "speechModel",
] as const;
export type DictationBlocker = (typeof DICTATION_BLOCKERS)[number];

export const setupStatusSchema = z.strictObject({
  /** The speech model. */
  model: modelStatusSchema,
  blockers: z.array(z.enum(DICTATION_BLOCKERS)),
});
export type SetupStatus = z.infer<typeof setupStatusSchema>;

const BLOCKER_TEXT: Record<DictationBlocker, string> = {
  helper: "the helper is not running",
  microphone: "microphone access is not granted",
  accessibility: "Accessibility access is not granted",
  inputMonitoring: "Input Monitoring access is not granted",
  speechModel: "the speech model is not ready",
};

/** One sentence for the Bar and the Hub, or null when nothing blocks dictation. */
export function blockerMessage(blockers: readonly DictationBlocker[]): string | null {
  const first = blockers[0];
  if (first === undefined) return null;
  const more = blockers.length > 1 ? ` (and ${blockers.length - 1} more)` : "";
  return `Open Murmur to finish setup: ${BLOCKER_TEXT[first]}${more}`;
}
