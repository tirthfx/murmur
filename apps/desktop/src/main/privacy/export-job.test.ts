import { describe, expect, it, vi } from "vitest";
import type { ExportCategory } from "@murmur/shared";
import { createTestLogger } from "../helper/fakes";
import { createExportJob } from "./export-job";

function setup() {
  let progress: (done: number, category: ExportCategory) => void = () => {};
  let finish: (counts: Record<string, number>) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const write = vi.fn(
    (_folder: string, _categories: readonly ExportCategory[], report: typeof progress) => {
      progress = report;
      return new Promise<Record<string, number>>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
    },
  );
  const job = createExportJob({ write, logger: createTestLogger() });
  return {
    job,
    write,
    progress: (done: number, category: ExportCategory) => progress(done, category),
    finish: (counts: Record<string, number>) => finish(counts),
    fail: (error: Error) => fail(error),
  };
}

describe("the background export (HB-46)", () => {
  it("runs one at a time, shows progress and keeps the outcome", async () => {
    const t = setup();
    expect(t.job.status()).toEqual({ state: "idle" });
    expect(t.job.start("/out", ["dictations", "notes"])).toBe(true);
    expect(t.job.start("/other", ["memory"])).toBe(false);
    expect(t.write).toHaveBeenCalledOnce();
    t.progress(1, "notes");
    expect(t.job.status()).toEqual({ state: "running", done: 1, total: 2, category: "notes" });
    t.finish({ dictations: 2, notes: 1 });
    await t.job.settled();
    expect(t.job.status()).toEqual({
      state: "done",
      folder: "/out",
      counts: { dictations: 2, notes: 1 },
    });
    expect(t.job.start("/again", ["memory"])).toBe(true);
  });

  it("says why an export failed, and can run again", async () => {
    const t = setup();
    t.job.start("/out", ["memory"]);
    t.fail(new Error("disk full"));
    await t.job.settled();
    expect(t.job.status()).toEqual({
      state: "failed",
      message: "The export could not be written: disk full",
    });
    expect(t.job.start("/out", ["memory"])).toBe(true);
  });

  it("does nothing with nothing ticked", () => {
    expect(setup().job.start("/out", [])).toBe(false);
  });
});
