import { describe, expect, it } from "vitest";
import type { InsightsDay } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createMilestonesStore } from "./milestones-store";

function day(date: string, words: number): InsightsDay {
  return { date, words, dictations: 1, speechMs: 0, wpmWords: 0, wpmMs: 0, apps: {} };
}

describe("milestones store", () => {
  it("records a backlog quietly on the first check, then announces new ones once", () => {
    const db = openDatabase(":memory:");
    const store = createMilestonesStore(db);
    expect(store.check([day("2026-11-17", 500)], "2026-11-18", 1)).toEqual([]);
    expect(store.list().find((item) => item.key === "first-dictation")).toMatchObject({
      achievedAt: 1,
      isNew: true,
    });

    const days = [day("2026-11-17", 500), day("2026-11-18", 600)];
    expect(store.check(days, "2026-11-18", 2)).toEqual(["words-1000"]);
    // Recorded once, even after a restart.
    expect(createMilestonesStore(db).check(days, "2026-11-18", 3)).toEqual([]);
    const thousand = store.list().find((item) => item.key === "words-1000");
    expect(thousand).toMatchObject({ achievedAt: 2, isNew: true });

    store.markSeen(4);
    expect(store.list().some((item) => item.isNew)).toBe(false);
  });

  it("counts a custom Rewrite", () => {
    const db = openDatabase(":memory:");
    const store = createMilestonesStore(db);
    store.check([], "2026-11-18", 1);
    db.prepare(
      "INSERT INTO rewrites (id, name, prompt, sort_order, created_at, updated_at) VALUES ('r', 'Mine', 'p', 9, 1, 1)",
    ).run();
    expect(store.check([], "2026-11-18", 2)).toEqual(["first-custom-rewrite"]);
  });

  it("lists best weeks after the fixed milestones", () => {
    const db = openDatabase(":memory:");
    const store = createMilestonesStore(db);
    store.check([], "2026-11-18", 1);
    store.check([day("2026-10-26", 10), day("2026-11-02", 20)], "2026-11-18", 2);
    const keys = store.list().map((item) => item.key);
    expect(keys.at(-1)).toBe("best-week:2026-11-02");
  });
});
