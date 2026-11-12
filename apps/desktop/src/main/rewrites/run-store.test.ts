import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { createRewriteStore } from "./rewrite-store";
import { createRewriteRunStore } from "./run-store";

const DAY = 24 * 60 * 60_000;

function setup() {
  const db = openDatabase(":memory:");
  createRewriteStore(db);
  let time = 1_000_000_000_000;
  let id = 0;
  const runs = createRewriteRunStore(
    db,
    () => time,
    () => `run${++id}`,
  );
  return { db, runs, advance: (ms: number) => (time += ms) };
}

const run = {
  rewriteId: "builtin:concise",
  rewriteName: "Tighten",
  sourceText: "x".repeat(500),
  outputText: "short",
  outcome: "replaced" as const,
  appBundleId: "com.apple.Notes",
  durationMs: 900,
};

describe("rewrite runs", () => {
  it("records a run and lists newest first", () => {
    const { runs, advance } = setup();
    runs.record(run);
    advance(1000);
    runs.record({ ...run, outcome: "copied" });
    expect(runs.recent(10).map((item) => item.outcome)).toEqual(["copied", "replaced"]);
    expect(runs.recent(1)[0]).toMatchObject({
      rewriteId: "builtin:concise",
      sourceTruncated: false,
    });
  });

  it("keeps a run whose custom Rewrite was deleted, without the link", () => {
    const { runs } = setup();
    runs.record({ ...run, rewriteId: "gone" });
    expect(runs.recent(1)[0]).toMatchObject({ rewriteId: "", rewriteName: "Tighten" });
  });

  it("cuts source text to 200 characters after 7 days, once", () => {
    const { runs, advance } = setup();
    runs.record(run);
    advance(6 * DAY);
    expect(runs.trimOld()).toBe(0);
    advance(DAY + 1);
    expect(runs.trimOld()).toBe(1);
    expect(runs.recent(1)[0]).toMatchObject({ sourceTruncated: true, outputText: "short" });
    expect(runs.recent(1)[0]!.sourceText).toHaveLength(200);
    expect(runs.trimOld()).toBe(0);
  });
});
