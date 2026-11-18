import { z } from "zod";

/** Home (HB-02): today's numbers and the last dictation. Counts only, plus that one text. */
export const homeViewSchema = z.strictObject({
  todayWords: z.number(),
  todayDictations: z.number(),
  todayTimeSavedMs: z.number(),
  /** All dictations ever counted: the checklist's "first dictation". */
  totalDictations: z.number(),
  last: z
    .strictObject({ text: z.string(), appName: z.string().nullable(), at: z.number() })
    .nullable(),
});
export type HomeView = z.infer<typeof homeViewSchema>;

/** Retrying a failed dictation from the Hub (HB-03): the row is updated, not duplicated. */
export const historyRetryResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), text: z.string() }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type HistoryRetryResult = z.infer<typeof historyRetryResultSchema>;

/** What the Hub shows of the dictation state (HB-03), following the Bar. */
export const DICTATION_STATES = ["idle", "listening", "processing", "attention"] as const;
export type DictationState = (typeof DICTATION_STATES)[number];

/** The Bar's state as the Hub shows it. */
export function dictationStateOf(barState: string): DictationState {
  if (barState === "listening" || barState === "locked") return "listening";
  if (barState === "processing") return "processing";
  if (barState === "warning" || barState === "error" || barState === "ask") return "attention";
  return "idle";
}

/** Bundled tips, one a day (HB-02). */
export const HOME_TIPS = [
  "Hold the push-to-talk key, speak, and let go: the text goes where the cursor is.",
  "Say “press enter” at the end of a dictation to send a message in one go.",
  "Teach Murmur a name once in Dictionary and it is spelled right from then on.",
  "Select text anywhere and use the Rewrite shortcut to tighten or clarify it.",
  "Snippets turn a short spoken trigger into a longer piece of text.",
  "Whisper mode helps when you have to speak quietly.",
  "History keeps every dictation on this Mac; search finds words you said.",
  "Insights shows your words, speed and streaks, worked out from counts only.",
] as const;

/** The tip for a local day: the same all day, a different one the next. */
export function tipFor(date: Date): string {
  const start = new Date(date.getFullYear(), 0, 0);
  const day = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
  return HOME_TIPS[day % HOME_TIPS.length]!;
}
