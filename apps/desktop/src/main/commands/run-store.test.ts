import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { createCommandRunStore, type CommandRunInput } from "./run-store";

const DAY = 24 * 60 * 60_000;

function setup() {
  const db = openDatabase(":memory:");
  let time = 1_000_000_000_000;
  let id = 0;
  const runs = createCommandRunStore(
    db,
    () => time,
    () => `cmd${++id}`,
  );
  return { runs, advance: (ms: number) => (time += ms) };
}

const run: CommandRunInput = {
  phrase: "make it a list",
  commandId: "list",
  language: null,
  trigger: "wake_phrase",
  matchedBy: "rule",
  target: "selection",
  sourceText: "a".repeat(500),
  outputText: "b".repeat(300),
  outcome: "replaced",
  appBundleId: "com.apple.Notes",
  durationMs: 1200,
};

describe("command runs", () => {
  it("records runs and lists newest first", () => {
    const { runs, advance } = setup();
    expect(runs.record(run)).toBe("cmd1");
    advance(1000);
    runs.record({
      ...run,
      phrase: "what's up",
      commandId: null,
      matchedBy: null,
      target: "none",
      sourceText: null,
      outputText: null,
      outcome: "not_understood",
    });
    const [last, first] = runs.recent(10);
    expect(last).toMatchObject({ commandId: null, outcome: "not_understood", sourceText: null });
    expect(first).toMatchObject({ ...run, id: "cmd1", textTruncated: false });
  });

  it("cuts the text of runs older than 7 days to 200 characters", () => {
    const { runs, advance } = setup();
    runs.record(run);
    advance(8 * DAY);
    runs.record(run);
    expect(runs.trimOld()).toBe(1);
    expect(runs.trimOld()).toBe(0);
    const [recent, old] = runs.recent(10);
    expect(recent!.sourceText).toHaveLength(500);
    expect(old).toMatchObject({ textTruncated: true });
    expect(old!.sourceText).toHaveLength(200);
    expect(old!.outputText).toHaveLength(200);
  });

  it("refuses an unknown outcome", () => {
    const { runs } = setup();
    expect(() => runs.record({ ...run, outcome: "oops" as never })).toThrow();
  });
});
