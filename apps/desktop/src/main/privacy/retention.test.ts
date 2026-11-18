import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { createRetentionJob, tableRules } from "./retention";

const DAY = 24 * 60 * 60_000;

describe("retention job (HB-50)", () => {
  it("records each rule's count and when it ran", () => {
    const db = openDatabase(":memory:");
    const job = createRetentionJob(db, { audio: () => 2, history: () => 0 });
    expect(job.view()).toEqual({ lastRunAt: null, nextRunAt: null, removed: {} });
    expect(job.run(1_000)).toEqual({ audio: 2, history: 0 });
    expect(job.view()).toEqual({
      lastRunAt: 1_000,
      nextRunAt: 1_000 + DAY,
      removed: { audio: 2, history: 0 },
    });
  });

  it("runs again only after a day", () => {
    const db = openDatabase(":memory:");
    let runs = 0;
    const job = createRetentionJob(db, { count: () => ++runs });
    expect(job.runIfDue(0)).not.toBeNull();
    expect(job.runIfDue(DAY - 1)).toBeNull();
    expect(job.runIfDue(DAY)).not.toBeNull();
    expect(runs).toBe(2);
  });

  it("keeps going when one rule fails", () => {
    const db = openDatabase(":memory:");
    const job = createRetentionJob(
      db,
      {
        broken: () => {
          throw new Error("disk");
        },
        fine: () => 1,
      },
      { warn: () => {} },
    );
    expect(job.run(5)).toEqual({ broken: -1, fine: 1 });
  });

  it("removes old candidates and voice samples, and never touches the Dictionary or notes", () => {
    const db = openDatabase(":memory:");
    const now = 200 * DAY;
    db.prepare(
      "INSERT INTO learn_candidates (spoken, written, seen, first_at, last_at) VALUES ('a', 'b', 1, 0, 0)",
    ).run();
    db.prepare(
      "INSERT INTO learn_candidates (spoken, written, seen, first_at, last_at) VALUES ('c', 'd', 1, ?, ?)",
    ).run(now, now);
    const rules = tableRules(db);
    expect(rules.learnedCandidates!(now)).toBe(1);
    expect(rules.voiceSamples!(now)).toBe(0);
    expect(Object.keys(rules)).not.toContain("dictionary");
  });
});
