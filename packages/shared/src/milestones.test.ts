import { describe, expect, it } from "vitest";
import type { InsightsDay } from "./insights";
import {
  milestoneTitle,
  progressCardContent,
  progressCardBytesSchema,
  reachedMilestones,
  type MilestoneStats,
} from "./milestones";

function day(date: string, words: number, dictations = 1): InsightsDay {
  return { date, words, dictations, speechMs: 0, wpmWords: 0, wpmMs: 0, apps: {} };
}

function stats(overrides: Partial<MilestoneStats> = {}): MilestoneStats {
  return {
    days: [],
    longestStreak: 0,
    rewritesUsed: 0,
    customRewrites: 0,
    notes: 0,
    today: "2026-11-18",
    ...overrides,
  };
}

describe("reachedMilestones", () => {
  it("finds the word and dictation milestones", () => {
    const reached = reachedMilestones(stats({ days: [day("2026-11-18", 1200, 3)] }), new Set());
    expect(reached).toEqual(["first-dictation", "words-1000"]);
  });

  it("leaves out what is already recorded", () => {
    expect(
      reachedMilestones(
        stats({ days: [day("2026-11-18", 1200)] }),
        new Set(["first-dictation", "words-1000"]),
      ),
    ).toEqual([]);
  });

  it("covers streaks, Rewrites and notes", () => {
    expect(
      reachedMilestones(
        stats({ longestStreak: 30, rewritesUsed: 1, customRewrites: 1, notes: 2 }),
        new Set(),
      ),
    ).toEqual(["streak-7", "streak-30", "first-rewrite", "first-custom-rewrite", "first-note"]);
  });

  it("records each new best finished week, not this week", () => {
    const days = [
      day("2026-10-26", 100), // week of 26 Oct: sets the bar
      day("2026-11-02", 300), // a new best
      day("2026-11-09", 200), // not a best
      day("2026-11-16", 999), // this week: not finished
    ];
    const reached = reachedMilestones(stats({ days }), new Set(["first-dictation", "words-1000"]));
    expect(reached).toEqual(["best-week:2026-11-02"]);
    expect(milestoneTitle("best-week:2026-11-02")).toBe("Personal best week");
  });
});

describe("progress card", () => {
  it("says counts and the date only", () => {
    const content = progressCardContent(
      { key: "words-1000", title: "1,000 words", achievedAt: new Date(2026, 10, 18).getTime() },
      { words: 1234, streak: 4 },
    );
    expect(content.figure).toBe(`${(1234).toLocaleString()} words dictated`);
    expect(
      progressCardContent(
        { key: "streak-7", title: "7-day streak", achievedAt: null },
        {
          words: 0,
          streak: 7,
        },
      ).figure,
    ).toBe("7 days in a row");
  });

  it("accepts only PNG bytes", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(progressCardBytesSchema.safeParse(png).success).toBe(true);
    expect(progressCardBytesSchema.safeParse(new Uint8Array(20)).success).toBe(false);
  });
});
