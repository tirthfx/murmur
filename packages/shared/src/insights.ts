import { z } from "zod";

/**
 * Insights (HB-11, HB-36 to HB-39, HB-45): numbers worked out from one row per local day.
 * No dictated text is ever read for them; the daily rows hold counts and app ids only.
 */

export const INSIGHTS_RANGES = ["7", "30", "365", "all"] as const;
export type InsightsRange = (typeof INSIGHTS_RANGES)[number];
export const insightsRangeSchema = z.enum(INSIGHTS_RANGES);

export const INSIGHTS_RANGE_LABELS: Record<InsightsRange, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "365": "Last 12 months",
  all: "All time",
};

export const INSIGHTS_LIMITS = {
  /** HB-37: a session counts for words per minute only with this much recording. */
  wpmMinMs: 20_000,
  /** HB-38. */
  topApps: 10,
  /** HB-39: a week counts with this many active days. */
  weeklyDays: 3,
  typingWpm: { min: 10, max: 150, default: 40 },
} as const;

/** One local calendar day. `apps` maps a bundle id to its name and counts. */
export const insightsDaySchema = z.strictObject({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  words: z.number().int().min(0),
  dictations: z.number().int().min(0),
  /** Recording time of the counted dictations. */
  speechMs: z.number().int().min(0),
  /** Words and recording time of dictations long enough for words per minute. */
  wpmWords: z.number().int().min(0),
  wpmMs: z.number().int().min(0),
  apps: z.record(
    z.string(),
    z.strictObject({
      name: z.string().nullable(),
      words: z.number().int().min(0),
      dictations: z.number().int().min(0),
    }),
  ),
});
export type InsightsDay = z.infer<typeof insightsDaySchema>;

const appRowSchema = z.strictObject({
  bundleId: z.string(),
  name: z.string(),
  words: z.number(),
  dictations: z.number(),
  /** Whole percent of the range's words; the rows and Other add up to 100. */
  share: z.number(),
});

const streakSchema = z.strictObject({
  current: z.number(),
  longest: z.number(),
  /** Whether today (or this week) already counts. */
  counted: z.boolean(),
});

export const insightsViewSchema = z.strictObject({
  range: insightsRangeSchema,
  /** Nothing has been dictated in the range. */
  empty: z.boolean(),
  words: z.number(),
  dictations: z.number(),
  averageWords: z.number(),
  speakingMs: z.number(),
  /** An estimate: typing time for the words, less the time spent speaking. */
  timeSavedMs: z.number(),
  typingWpm: z.number(),
  /** Null without a session of 20 seconds or more. */
  wpm: z.number().nullable(),
  bestDay: z.strictObject({ date: z.string(), wpm: z.number() }).nullable(),
  topApps: z.array(appRowSchema),
  other: appRowSchema.omit({ bundleId: true, name: true }).nullable(),
  daily: streakSchema,
  weekly: streakSchema,
});
export type InsightsView = z.infer<typeof insightsViewSchema>;

export const insightsExportResultSchema = z.strictObject({
  saved: z.boolean(),
  rows: z.number(),
});
export type InsightsExportResult = z.infer<typeof insightsExportResultSchema>;

// ------------------------------------------------------------------ dates

const pad = (value: number) => String(value).padStart(2, "0");

/** The local calendar day of an instant, as YYYY-MM-DD. */
export function localDate(epoch: number): string {
  const day = new Date(epoch);
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** A calendar day moved by whole days (no time zone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** The Monday of a day's week. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

/** The first day in a range ending today, or null for all time. */
export function rangeFirstDay(range: InsightsRange, today: string): string | null {
  return range === "all" ? null : addDays(today, -(Number(range) - 1));
}

// ------------------------------------------------------------------ the numbers

/** Whole percents that add up to 100 (largest remainder). */
export function wholePercents(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((value) => (value * 100) / total);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index]! += 1;
    left -= 1;
  }
  return floors;
}

/** Daily and weekly streaks (HB-39) from the days with at least one dictation. */
export function streaks(
  activeDays: Iterable<string>,
  today: string,
): { daily: InsightsView["daily"]; weekly: InsightsView["weekly"] } {
  const days = new Set(activeDays);
  const run = (has: (key: string) => boolean, start: string, step: (key: string) => string) => {
    let count = 0;
    for (let key = start; has(key); key = step(key)) count++;
    return count;
  };
  const back = (date: string) => addDays(date, -1);

  // Daily: today counts once it has a dictation; until midnight yesterday's run still stands.
  const todayCounted = days.has(today);
  const daily = run((key) => days.has(key), todayCounted ? today : back(today), back);
  let longestDaily = 0;
  for (const day of days) {
    if (days.has(back(day))) continue;
    longestDaily = Math.max(
      longestDaily,
      run(
        (key) => days.has(key),
        day,
        (key) => addDays(key, 1),
      ),
    );
  }

  // Weekly: Monday-start weeks with enough active days.
  const perWeek = new Map<string, number>();
  for (const day of days) {
    const week = weekStart(day);
    perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
  }
  const weeks = new Set(
    [...perWeek].filter(([, count]) => count >= INSIGHTS_LIMITS.weeklyDays).map(([week]) => week),
  );
  const thisWeek = weekStart(today);
  const lastWeek = (week: string) => addDays(week, -7);
  const weekCounted = weeks.has(thisWeek);
  const weekly = run(
    (key) => weeks.has(key),
    weekCounted ? thisWeek : lastWeek(thisWeek),
    lastWeek,
  );
  let longestWeekly = 0;
  for (const week of weeks) {
    if (weeks.has(lastWeek(week))) continue;
    longestWeekly = Math.max(
      longestWeekly,
      run(
        (key) => weeks.has(key),
        week,
        (key) => addDays(key, 7),
      ),
    );
  }

  return {
    daily: { current: daily, longest: longestDaily, counted: todayCounted },
    weekly: { current: weekly, longest: longestWeekly, counted: weekCounted },
  };
}

/** Everything the Insights page shows for a range. `days` may hold any days; all are used for streaks. */
export function buildInsights(
  days: InsightsDay[],
  range: InsightsRange,
  today: string,
  typingWpm: number,
): InsightsView {
  const first = rangeFirstDay(range, today);
  const inRange = days.filter((day) => (first === null || day.date >= first) && day.date <= today);
  const sum = (pick: (day: InsightsDay) => number) =>
    inRange.reduce((total, day) => total + pick(day), 0);
  const words = sum((day) => day.words);
  const dictations = sum((day) => day.dictations);
  const speakingMs = sum((day) => day.speechMs);
  const wpmWords = sum((day) => day.wpmWords);
  const wpmMs = sum((day) => day.wpmMs);
  const typingMs = (words / typingWpm) * 60_000;

  let bestDay: InsightsView["bestDay"] = null;
  for (const day of inRange) {
    if (day.wpmMs <= 0) continue;
    const wpm = Math.round(day.wpmWords / (day.wpmMs / 60_000));
    if (!bestDay || wpm > bestDay.wpm) bestDay = { date: day.date, wpm };
  }

  const apps = new Map<string, { name: string | null; words: number; dictations: number }>();
  for (const day of inRange) {
    for (const [bundleId, app] of Object.entries(day.apps)) {
      const entry = apps.get(bundleId) ?? { name: null, words: 0, dictations: 0 };
      entry.name = app.name ?? entry.name;
      entry.words += app.words;
      entry.dictations += app.dictations;
      apps.set(bundleId, entry);
    }
  }
  const ranked = [...apps]
    .filter(([, app]) => app.words > 0)
    .sort((a, b) => b[1].words - a[1].words || a[0].localeCompare(b[0]));
  const top = ranked.slice(0, INSIGHTS_LIMITS.topApps);
  const rest = ranked.slice(INSIGHTS_LIMITS.topApps);
  // Words from apps that were not known are part of the total: they go to Other too.
  const knownWords = ranked.reduce((total, [, app]) => total + app.words, 0);
  const otherWords = rest.reduce((total, [, app]) => total + app.words, 0) + (words - knownWords);
  const otherDictations = rest.reduce((total, [, app]) => total + app.dictations, 0);
  const shares = wholePercents([...top.map(([, app]) => app.words), Math.max(0, otherWords)]);

  const allDays = days.filter((day) => day.dictations > 0).map((day) => day.date);
  return {
    range,
    empty: dictations === 0,
    words,
    dictations,
    averageWords: dictations > 0 ? Math.round(words / dictations) : 0,
    speakingMs,
    timeSavedMs: Math.max(0, Math.round(typingMs - speakingMs)),
    typingWpm,
    wpm: wpmMs > 0 ? Math.round(wpmWords / (wpmMs / 60_000)) : null,
    bestDay,
    topApps: top.map(([bundleId, app], index) => ({
      bundleId,
      name: app.name ?? bundleId,
      words: app.words,
      dictations: app.dictations,
      share: shares[index]!,
    })),
    other:
      otherWords > 0
        ? { words: otherWords, dictations: otherDictations, share: shares[top.length]! }
        : null,
    ...streaks(allDays, today),
  };
}

/** HB-45: one CSV row per day; counts and app ids only, never text. */
export function insightsCsv(days: InsightsDay[]): string {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = ["date,words,dictations,speech_seconds,session_seconds,apps_json"];
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const apps = Object.fromEntries(
      Object.entries(day.apps).map(([bundleId, app]) => [bundleId, app.words]),
    );
    const seconds = Math.round(day.speechMs / 1000);
    lines.push(
      [day.date, day.words, day.dictations, seconds, seconds, quote(JSON.stringify(apps))].join(
        ",",
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** "1 h 5 min", "12 min", "40 s". */
export function formatSpan(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
