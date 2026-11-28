import { describe, expect, it, vi } from "vitest";
import type { ModelManifest } from "@murmur/shared";
import { createTestLogger } from "../helper/fakes";
import type { ModelCheck } from "../speech/model-store";
import { createCheckedFiles, createManagedModel, type ModelFilesState } from "./managed-model";

const model: ModelManifest = {
  id: "m",
  label: "Test model",
  totalBytes: 1000,
  files: [{ path: "model/a", url: "https://huggingface.co/a", size: 1000, sha256: "x" }],
};

function setup(initial: ModelFilesState = "missing") {
  const state = { files: initial, disk: 0 };
  let finish: () => void = () => {};
  let fail: (error: Error) => void = () => {};
  let progress: (done: number) => void = () => {};
  const download = vi.fn(
    (onProgress: (done: number, total: number) => void, signal: AbortSignal) => {
      progress = (done) => onProgress(done, model.totalBytes);
      return new Promise<void>((resolve, reject) => {
        finish = () => {
          state.files = "ready";
          resolve();
        };
        fail = reject;
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    },
  );
  const remove = vi.fn(async () => {
    state.files = "missing";
    state.disk = 0;
  });
  const changed = vi.fn();
  const onDownload = vi.fn();
  const managed = createManagedModel({
    id: "quality",
    model,
    inspect: () => state.files,
    download,
    remove,
    diskBytes: async () => state.disk,
    changed,
    onDownload,
    logger: createTestLogger(),
  });
  const settle = () => new Promise((done) => setTimeout(done, 0));
  return {
    managed,
    state,
    download,
    remove,
    changed,
    onDownload,
    progress: (done: number) => progress(done),
    finish: async () => {
      finish();
      await settle();
    },
    fail: async (message: string) => {
      fail(new Error(message));
      await settle();
    },
  };
}

describe("a model on this Mac (HB-15)", () => {
  it("names its host and is missing until downloaded", async () => {
    const { managed } = setup();
    expect(await managed.status()).toEqual({
      id: "quality",
      state: "missing",
      label: "Test model",
      host: "huggingface.co",
      totalBytes: 1000,
      diskBytes: 0,
      downloadedBytes: 0,
      message: null,
    });
    expect(await managed.isReady()).toBe(false);
  });

  it("downloads once, reports progress, then is ready", async () => {
    const { managed, download, progress, finish, changed, onDownload } = setup();
    expect(await managed.download()).toMatchObject({ state: "downloading" });
    progress(400);
    expect(await managed.status()).toMatchObject({ state: "downloading", downloadedBytes: 400 });
    await managed.download();
    expect(download).toHaveBeenCalledOnce();
    expect(await managed.isReady()).toBe(false);
    await finish();
    expect(await managed.status()).toMatchObject({ state: "ready", downloadedBytes: 0 });
    expect(await managed.isReady()).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
    expect(onDownload).toHaveBeenCalledWith(true);
    await managed.download();
    expect(download).toHaveBeenCalledOnce();
  });

  it("says why a download failed, and can try again", async () => {
    const { managed, fail, onDownload } = setup();
    await managed.download();
    await fail("model/a: SHA-256 does not match the manifest");
    expect(await managed.status()).toMatchObject({
      state: "failed",
      message: "The download did not finish: model/a: SHA-256 does not match the manifest",
    });
    expect(onDownload).toHaveBeenCalledWith(false);
    expect(await managed.download()).toMatchObject({ state: "downloading", message: null });
  });

  it("can be cancelled, which is not a failure", async () => {
    const { managed, state, onDownload } = setup();
    await managed.download();
    state.disk = 300;
    expect(await managed.cancel()).toMatchObject({
      state: "missing",
      diskBytes: 300,
      message: null,
    });
    expect(onDownload).not.toHaveBeenCalled();
    expect(await managed.cancel()).toMatchObject({ state: "missing" });
  });

  it("deletes the files, but not under a running download", async () => {
    const { managed, remove, changed, finish } = setup();
    await managed.download();
    await managed.remove();
    expect(remove).not.toHaveBeenCalled();
    await finish();
    expect(await managed.remove()).toMatchObject({ state: "missing" });
    expect(remove).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("explains a model that is on disk and did not load", async () => {
    const { managed } = setup("failed");
    expect(await managed.status()).toMatchObject({
      state: "failed",
      message: "The model is on disk but could not be loaded.",
    });
  });
});

describe("checking a model's files", () => {
  it("checks once until told to look again", async () => {
    let result: ModelCheck = { ok: false, reason: "checksum", file: "model/a" };
    const check = vi.fn(async () => result);
    const heard = vi.fn();
    const files = createCheckedFiles(check, heard);
    expect(await files.inspect()).toBe("corrupt");
    expect(await files.inspect()).toBe("corrupt");
    expect(check).toHaveBeenCalledOnce();
    expect(heard).toHaveBeenCalledWith(result);
    result = { ok: true };
    files.forget();
    expect(await files.inspect()).toBe("ready");
    result = { ok: false, reason: "missing", file: "model/a" };
    files.forget();
    expect(await files.inspect()).toBe("missing");
  });

  it("treats a check that cannot run as missing", async () => {
    const files = createCheckedFiles(() => Promise.reject(new Error("disk")));
    expect(await files.inspect()).toBe("missing");
  });
});
