import { z } from "zod";

/**
 * First-run setup (DC-44): what the Hub needs to know about the speech model and about
 * anything that still blocks dictation.
 */

export const SPEECH_MODEL_STATES = [
  /** Not on disk, or a file failed its check. */
  "missing",
  "downloading",
  /** On disk; being checked or loaded. */
  "preparing",
  "ready",
  /** The download or the load failed; `message` says why. */
  "failed",
] as const;

export const speechModelStatusSchema = z.strictObject({
  state: z.enum(SPEECH_MODEL_STATES),
  label: z.string(),
  totalBytes: z.number().int().nonnegative(),
  /** Bytes present so far while downloading; 0 otherwise. */
  downloadedBytes: z.number().int().nonnegative(),
  message: z.string().nullable(),
});
export type SpeechModelStatus = z.infer<typeof speechModelStatusSchema>;

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
  model: speechModelStatusSchema,
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
