import { z } from "zod";

/**
 * Microphone check (DC-13): a short reading test that writes no audio and no history row,
 * and gives advice from the input's speech level and background level.
 */

/** Murmur's own read-aloud sentences. */
export const MIC_CHECK_SENTENCES = [
  "The blue kettle is on the back of the stove.",
  "Seven friends met for lunch on a rainy Tuesday.",
  "Please move the meeting to half past three.",
  "A quiet garden needs very little water in spring.",
  "Send the summary to everyone before Friday.",
] as const;

export const MIC_ADVICE = ["close-talk", "quiet-room", "noisy", "too-quiet"] as const;
export type MicAdvice = (typeof MIC_ADVICE)[number];

export const micCheckResultSchema = z.strictObject({
  deviceName: z.string().nullable(),
  /** Loudest tenth of the input, before gain. Null when nothing was heard. */
  speechDb: z.number().nullable(),
  /** Quietest tenth of the input, before gain. */
  noiseDb: z.number().nullable(),
  advice: z.enum(MIC_ADVICE),
  adviceText: z.string(),
});
export type MicCheckResult = z.infer<typeof micCheckResultSchema>;

export const micCheckStartResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), deviceName: z.string() }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type MicCheckStartResult = z.infer<typeof micCheckStartResultSchema>;

const ADVICE_TEXT: Record<MicAdvice, string> = {
  "close-talk": "Headset or close-talk microphone: a clear voice with very little background.",
  "quiet-room": "Built-in microphone in a quiet room: this works well.",
  noisy: "Noisy room: a headset will give better results.",
  "too-quiet": "Your voice was hard to hear. Move closer, or choose another microphone.",
};

/** Advice only; it changes no setting. */
export function micAdvice(speechDb: number | null, noiseDb: number | null): MicAdvice {
  if (speechDb === null || speechDb < -50) return "too-quiet";
  const gap = speechDb - (noiseDb ?? -90);
  if (gap >= 35) return "close-talk";
  if (gap >= 20) return "quiet-room";
  return "noisy";
}

export function micAdviceText(advice: MicAdvice): string {
  return ADVICE_TEXT[advice];
}
