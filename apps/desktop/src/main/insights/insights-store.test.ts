import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { createHistoryStore } from "../history/history-store";
import type { DictationRecord } from "../recorder";
import { createInsightsStore } from "./insights-store";

const at = (d: number, h = 10) => new Date(2026, 10, d, h).getTime();

function entry(
  overrides: Partial<Parameters<ReturnType<typeof createInsightsStore>["record"]>[0]> = {},
) {
  return {
    createdAt: at(18),
    words: 50,
    durationMs: 30_000,
    insertStatus: "inserted",
    appBundleId: "com.apple.Notes",
    appName: "Notes",
    ...overrides,
  };
}

describe("insights store", () => {
  it("adds dictations to their local day with app counts", () => {
    const store = createInsightsStore(openDatabase(":memory:"));
    store.record(entry());
    store.record(
      entry({ words: 10, durationMs: 5_000, appBundleId: "com.apple.Safari", appName: "Safari" }),
    );
    store.record(entry({ createdAt: at(17, 23) }));
    expect(store.days(null).map((day) => day.date)).toEqual(["2026-11-17", "2026-11-18"]);
    const [, today] = store.days(null);
    expect(today).toEqual({
      date: "2026-11-18",
      words: 60,
      dictations: 2,
      speechMs: 35_000,
      // Only the 30 s session is long enough for words per minute.
      wpmWords: 50,
      wpmMs: 30_000,
      apps: {
        "com.apple.Notes": { name: "Notes", words: 50, dictations: 1 },
        "com.apple.Safari": { name: "Safari", words: 10, dictations: 1 },
      },
    });
    expect(store.days("2026-11-18")).toHaveLength(1);
  });

  it("ignores failed and empty dictations", () => {
    const store = createInsightsStore(openDatabase(":memory:"));
    store.record(entry({ insertStatus: "failed" }));
    store.record(entry({ words: 0 }));
    expect(store.days(null)).toEqual([]);
  });

  it("fills the days from history once", () => {
    const db = openDatabase(":memory:");
    let n = 0;
    const history = createHistoryStore(db, "/tmp/audio", () => `id-${++n}`);
    const base: DictationRecord = {
      sessionId: "s",
      source: "hold",
      createdAt: at(16),
      durationMs: 25_000,
      language: "en",
      rawText: "a b c",
      finalText: "A b c.",
      wordCount: 3,
      cleanup: null,
      insertStatus: "inserted",
      insertMethod: "paste_cmd_v",
      errorCode: null,
      audio: null,
      retryOf: null,
      appBundleId: "com.apple.Notes",
      appName: "Notes",
    };
    history.add(base);
    history.add({ ...base, sessionId: "t", insertStatus: "failed" });
    const store = createInsightsStore(db);
    expect(store.backfill()).toBe(1);
    expect(store.backfill()).toBe(0);
    expect(store.days(null)).toMatchObject([{ date: "2026-11-16", words: 3, dictations: 1 }]);
  });
});
