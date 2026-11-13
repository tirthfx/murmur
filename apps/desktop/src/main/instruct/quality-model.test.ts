import { describe, expect, it, vi } from "vitest";
import { QUALITY_INSTRUCT_MODEL } from "@murmur/shared";
import { createTestLogger } from "../helper/fakes";
import { createQualityModel } from "./quality-model";
import type { ModelCheck } from "../speech/model-store";

function setup(initial: ModelCheck = { ok: false, reason: "missing", file: "x" }) {
  let check = initial;
  let finish: (ok: boolean) => void = () => {};
  let progress: (done: number, total: number) => void = () => {};
  const onChange = vi.fn();
  const remove = vi.fn(async () => {});
  const quality = createQualityModel({
    model: QUALITY_INSTRUCT_MODEL,
    check: vi.fn(async () => check),
    download: (onProgress) => {
      progress = onProgress;
      return new Promise((resolve, reject) => {
        finish = (ok) => (ok ? resolve(1) : reject(new Error("offline")));
      });
    },
    remove,
    onChange,
    logger: createTestLogger(),
  });
  return {
    quality,
    onChange,
    remove,
    progress: (done: number) => progress(done, QUALITY_INSTRUCT_MODEL.totalBytes),
    finish: async (ok: boolean) => {
      if (ok) check = { ok: true };
      finish(ok);
      await new Promise((done) => setTimeout(done, 0));
    },
  };
}

describe("Quality model", () => {
  it("is missing until downloaded, reports progress, then is ready", async () => {
    const { quality, progress, finish, onChange } = setup();
    expect(await quality.status()).toMatchObject({ state: "missing", doneBytes: 0 });
    expect(await quality.isReady()).toBe(false);
    expect(quality.download()).toMatchObject({ state: "downloading" });
    progress(1_000_000);
    expect(await quality.status()).toMatchObject({ state: "downloading", doneBytes: 1_000_000 });
    expect(quality.download()).toMatchObject({ state: "downloading" });
    await finish(true);
    expect(await quality.status()).toMatchObject({ state: "ready" });
    expect(await quality.isReady()).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("says when the download failed, and can be tried again", async () => {
    const { quality, finish } = setup();
    quality.download();
    await finish(false);
    expect(await quality.status()).toMatchObject({
      state: "failed",
      message: expect.stringContaining("did not finish"),
    });
    expect(quality.download()).toMatchObject({ state: "downloading", message: null });
  });

  it("removes the files and goes back to missing", async () => {
    const { quality, remove, onChange } = setup({ ok: true });
    expect(await quality.isReady()).toBe(true);
    expect(await quality.remove()).toMatchObject({ state: "missing" });
    expect(remove).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(false);
    expect(await quality.isReady()).toBe(false);
  });
});
