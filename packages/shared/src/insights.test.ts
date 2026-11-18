import { describe, expect, it } from "vitest";
import {
  addDays,
  buildInsights,
  insightsCsv,
  localDate,
  streaks,
  weekStart,
  wholePercents,
  type InsightsDay,
} from "./insights";

function day(date: string, overrides: Partial<InsightsDay> = {}): InsightsDay {
  return {
    date,
    words: 100,
    dictations: 2,
    speechMs: 60_000,
    wpmWords: 0,
    wpmMs: 0,
    apps: {},
    ...overrides,
  };
}

describe("dates", () => {
  it("moves days across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("finds the Monday of a week", () => {
    expect(weekStart("2026-11-18")).toBe("2026-11-16"); // a Wednesday
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
    expect(weekStart("2026-11-22")).toBe("2026-11-16"); // Sunday
  });

  it("uses the local calendar day", () => {
    expect(localDate(new Date(2026, 10, 18, 23, 59).getTime())).toBe("2026-11-18");
    expect(localDate(new Date(2026, 10, 19, 0, 1).getTime())).toBe("2026-11-19");
  });
});

describe("wholePercents", () => {
  it("adds up to 100", () => {
    const shares = wholePercents([1, 1, 1]);
    expect(shares.reduce((a, b) => a + b)).toBe(100);
    expect(wholePercents([0, 0])).toEqual([0, 0]);
  });
});

describe("streaks", () => {
  it("counts 23:59 and 00:01 as two days", () => {
    const days = [
      localDate(new Date(2026, 10, 17, 23, 59).getTime()),
      localDate(new Date(2026, 10, 18, 0, 1).getTime()),
    ];
    expect(streaks(days, "2026-11-18").daily).toEqual({ current: 2, longest: 2, counted: true });
  });

  it("keeps yesterday's streak until today ends, and breaks after a gap", () => {
    expect(streaks(["2026-11-16", "2026-11-17"], "2026-11-18").daily).toEqual({
      current: 2,
      longest: 2,
      counted: false,
    });
    expect(streaks(["2026-11-15", "2026-11-16"], "2026-11-18").daily.current).toBe(0);
  });

  it("counts weeks with three active days", () => {
    const days = [
      "2026-11-02",
      "2026-11-03",
      "2026-11-04", // week of 2 Nov
      "2026-11-09",
      "2026-11-10",
      "2026-11-11", // week of 9 Nov
      "2026-11-16", // this week, one day so far
    ];
    expect(streaks(days, "2026-11-18").weekly).toEqual({ current: 2, longest: 2, counted: false });
  });
});

describe("buildInsights", () => {
  const today = "2026-11-18";

  it("adds up the range and estimates time saved", () => {
    const view = buildInsights(
      [day("2026-11-18"), day("2026-11-17"), day("2026-10-01")],
      "7",
      today,
      40,
    );
    expect(view).toMatchObject({
      words: 200,
      dictations: 4,
      averageWords: 50,
      speakingMs: 120_000,
    });
    // 200 words at 40 wpm is 5 minutes of typing, less 2 minutes of speaking.
    expect(view.timeSavedMs).toBe(180_000);
    expect(buildInsights([day("2026-11-18")], "7", today, 80).words).toBe(100);
  });

  it("changing the typing speed changes only time saved", () => {
    const a = buildInsights([day(today)], "30", today, 40);
    const b = buildInsights([day(today)], "30", today, 20);
    expect(b.words).toBe(a.words);
    expect(b.timeSavedMs).toBeGreaterThan(a.timeSavedMs);
  });

  it("works out words per minute from long sessions only", () => {
    const view = buildInsights(
      [
        day(today, { wpmWords: 150, wpmMs: 60_000 }),
        day("2026-11-17", { wpmWords: 100, wpmMs: 60_000 }),
      ],
      "7",
      today,
      40,
    );
    expect(view.wpm).toBe(125);
    expect(view.bestDay).toEqual({ date: today, wpm: 150 });
    expect(buildInsights([day(today)], "7", today, 40).wpm).toBeNull();
  });

  it("ranks top apps, groups the rest as Other, and shares add up to 100", () => {
    const apps: InsightsDay["apps"] = {};
    for (let i = 0; i < 12; i++) {
      apps[`com.example.app${i}`] = {
        name: i === 0 ? null : `App ${i}`,
        words: 10 + i,
        dictations: 1,
      };
    }
    const words = Object.values(apps).reduce((total, app) => total + app.words, 0);
    const view = buildInsights([day(today, { words, apps })], "7", today, 40);
    expect(view.topApps).toHaveLength(10);
    expect(view.topApps[0]!.name).toBe("App 11");
    expect(view.other?.dictations).toBe(2);
    const total = view.topApps.reduce((sum, app) => sum + app.share, 0) + (view.other?.share ?? 0);
    expect(total).toBe(100);
  });

  it("shows an app with no name by its bundle id", () => {
    const view = buildInsights(
      [day(today, { words: 5, apps: { "com.gone.App": { name: null, words: 5, dictations: 1 } } })],
      "7",
      today,
      40,
    );
    expect(view.topApps[0]!.name).toBe("com.gone.App");
  });

  it("is empty with no dictations", () => {
    expect(buildInsights([], "all", today, 40)).toMatchObject({
      empty: true,
      words: 0,
      wpm: null,
      topApps: [],
      other: null,
    });
  });
});

describe("insightsCsv", () => {
  it("writes one row per day with app word counts and no text", () => {
    const csv = insightsCsv([
      day("2026-11-18", {
        apps: { "com.apple.Notes": { name: "Notes", words: 100, dictations: 2 } },
      }),
    ]);
    expect(csv).toBe(
      'date,words,dictations,speech_seconds,session_seconds,apps_json\n2026-11-18,100,2,60,60,"{""com.apple.Notes"":100}"\n',
    );
  });
});
