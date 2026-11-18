import { z } from "zod";
import { addDays, weekStart, type InsightsDay } from "./insights";

/**
 * Milestones (HB-41): each recorded once, from counts only. Personal best weeks are the one
 * kind that can come again: each new best week is its own record (`best-week:<Monday>`).
 */

export const MILESTONES = [
  { key: "first-dictation", title: "First dictation", description: "Your first dictation." },
  { key: "dictations-100", title: "100 dictations", description: "A hundred dictations." },
  { key: "words-1000", title: "1,000 words", description: "A thousand words dictated." },
  { key: "words-10000", title: "10,000 words", description: "Ten thousand words dictated." },
  { key: "words-50000", title: "50,000 words", description: "Fifty thousand words dictated." },
  { key: "streak-7", title: "7-day streak", description: "Seven days in a row." },
  { key: "streak-30", title: "30-day streak", description: "Thirty days in a row." },
  { key: "first-rewrite", title: "First Rewrite", description: "Your first Rewrite used." },
  {
    key: "first-custom-rewrite",
    title: "First custom Rewrite",
    description: "Your own Rewrite made.",
  },
  { key: "first-note", title: "First note", description: "Your first Scratchpad note." },
] as const;

export type MilestoneKey = (typeof MILESTONES)[number]["key"];

export const BEST_WEEK_PREFIX = "best-week:";

/** What milestones are checked against. */
export interface MilestoneStats {
  days: InsightsDay[];
  /** The longest daily streak so far. */
  longestStreak: number;
  rewritesUsed: number;
  customRewrites: number;
  notes: number;
  /** Today's local date: only finished weeks can be a best week. */
  today: string;
}

/** Keys reached by these counts that are not recorded yet, in list order. */
export function reachedMilestones(stats: MilestoneStats, recorded: ReadonlySet<string>): string[] {
  const words = stats.days.reduce((total, day) => total + day.words, 0);
  const dictations = stats.days.reduce((total, day) => total + day.dictations, 0);
  const met: Record<MilestoneKey, boolean> = {
    "first-dictation": dictations >= 1,
    "dictations-100": dictations >= 100,
    "words-1000": words >= 1_000,
    "words-10000": words >= 10_000,
    "words-50000": words >= 50_000,
    "streak-7": stats.longestStreak >= 7,
    "streak-30": stats.longestStreak >= 30,
    "first-rewrite": stats.rewritesUsed >= 1,
    "first-custom-rewrite": stats.customRewrites >= 1,
    "first-note": stats.notes >= 1,
  };
  const reached: string[] = MILESTONES.filter((item) => met[item.key]).map((item) => item.key);

  // A finished week with more words than every earlier week; the first week sets the bar.
  const thisWeek = weekStart(stats.today);
  const weeks = new Map<string, number>();
  for (const day of stats.days) {
    const week = weekStart(day.date);
    if (week >= thisWeek) continue;
    weeks.set(week, (weeks.get(week) ?? 0) + day.words);
  }
  let best = 0;
  for (const week of [...weeks.keys()].sort()) {
    const total = weeks.get(week)!;
    if (total > best) {
      if (best > 0) reached.push(`${BEST_WEEK_PREFIX}${week}`);
      best = total;
    }
  }
  return reached.filter((key) => !recorded.has(key));
}

/** A title for any key, including best weeks. */
export function milestoneTitle(key: string): string {
  if (key.startsWith(BEST_WEEK_PREFIX)) return "Personal best week";
  return MILESTONES.find((item) => item.key === key)?.title ?? key;
}

/** "Week of 9 Nov 2026" for a best-week key; the description otherwise. */
export function milestoneDetail(key: string): string {
  if (key.startsWith(BEST_WEEK_PREFIX)) {
    const monday = key.slice(BEST_WEEK_PREFIX.length);
    const [y, m, d] = monday.split("-").map(Number) as [number, number, number];
    const end = addDays(monday, 6);
    const [ey, em, ed] = end.split("-").map(Number) as [number, number, number];
    const format = (date: Date) => date.toLocaleDateString(undefined, { dateStyle: "medium" });
    return `Most words in a week: ${format(new Date(y, m - 1, d))} to ${format(new Date(ey, em - 1, ed))}.`;
  }
  return MILESTONES.find((item) => item.key === key)?.description ?? "";
}

export const milestoneSchema = z.strictObject({
  key: z.string(),
  title: z.string(),
  detail: z.string(),
  /** Null for one not reached yet. */
  achievedAt: z.number().nullable(),
  /** Reached and not yet seen on the Insights page. */
  isNew: z.boolean(),
});
export type Milestone = z.infer<typeof milestoneSchema>;

/** The progress card (HB-44): counts and dates only, never dictated text. */
export interface ProgressCardContent {
  title: string;
  figure: string;
  caption: string;
  date: string;
}

export const PROGRESS_CARD = { width: 1200, height: 630, maxBytes: 4 * 1024 * 1024 } as const;

export const progressCardBytesSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength > 8 && bytes.byteLength <= PROGRESS_CARD.maxBytes, {
    message: "Not a progress card image",
  })
  .refine(
    (bytes) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
    { message: "Not a PNG" },
  );

/** What a card for a milestone says, from counts only. */
export function progressCardContent(
  milestone: Pick<Milestone, "key" | "title" | "achievedAt">,
  totals: { words: number; streak: number },
): ProgressCardContent {
  const streak = milestone.key.startsWith("streak-");
  return {
    title: milestone.title,
    figure: streak
      ? `${totals.streak.toLocaleString()} ${totals.streak === 1 ? "day" : "days"} in a row`
      : `${totals.words.toLocaleString()} words dictated`,
    caption: "Dictated with Murmur, on this Mac.",
    date: new Date(milestone.achievedAt ?? Date.now()).toLocaleDateString(undefined, {
      dateStyle: "long",
    }),
  };
}
