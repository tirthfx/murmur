import { z } from "zod";
import { STYLE_CATEGORIES } from "./styles";

// Voice Profile (PZ-15 to PZ-17): how the owner writes when dictating, kept as counts.

/** Dictations a measure needs before it is shown or used. */
export const PROFILE_MIN_SESSIONS = 20;
/** Days of per-dictation numbers kept. */
export const PROFILE_SAMPLE_DAYS = 30;
/** Word totals that are celebrated once each. */
export const PROFILE_MILESTONES = [1_000, 10_000, 50_000] as const;
/** At most one prompt to read a passage per this many days. */
export const PROFILE_PROMPT_DAYS = 7;

/** Murmur's own passages for updating the profile (about 60 words each). */
export const PROFILE_PASSAGES = [
  "This morning I walked to the market before the shops were busy. The air was cool, the stalls were full of mangoes and the tea seller had already lit his stove. I bought bread, a bag of rice and some flowers for the table, then took the long way home along the river.",
  "Thanks for sending the draft so quickly. I read it on the train and it looks good overall. Could we move the budget section up, shorten the introduction and add the two numbers from last quarter? If that works for you, I can review the final version tomorrow afternoon.",
  "The library opens at nine on weekdays and at ten on Saturdays. Bring your card, because the new self-service machines will not lend a book without it. Quiet rooms upstairs can be booked for two hours at a time, and the café on the ground floor closes an hour before the library.",
  "Our team meets every Tuesday to plan the week. We start with what shipped, then talk about anything that is blocked, and finish by agreeing who owns each task. Notes go into the shared folder the same day, so anyone who missed the meeting can catch up before Wednesday.",
  "When the rain started, we had just reached the top of the hill. We waited under a large tree, shared the last of the biscuits and watched the clouds move across the valley. Twenty minutes later the sun was out again, and the path down was slippery but beautiful.",
] as const;

export const profileMeasureSchema = z.strictObject({
  id: z.enum(["sentence-length", "commas", "exclamations", "capitals", "fillers"]),
  label: z.string(),
  /** Readable value, or null when there is not enough data yet. */
  value: z.string().nullable(),
});
export type ProfileMeasure = z.infer<typeof profileMeasureSchema>;

export const profileExampleSchema = z.strictObject({
  raw: z.string(),
  final: z.string(),
  at: z.number().int(),
});

export const voiceProfileViewSchema = z.strictObject({
  sessions: z.number().int().min(0),
  totalWords: z.number().int().min(0),
  measures: z.array(profileMeasureSchema),
  topPhrases: z.array(z.string()),
  /** What the cleanup model is told, or null below the minimum. */
  summary: z.string().nullable(),
  milestones: z.array(z.strictObject({ words: z.number().int(), at: z.number().int() })),
  examples: z.record(z.enum(STYLE_CATEGORIES), z.array(profileExampleSchema)),
  passage: z.string(),
});
export type VoiceProfileView = z.infer<typeof voiceProfileViewSchema>;
