import { describe, expect, it, vi } from "vitest";
import type { SpeechModel } from "@murmur/shared";
import { createTestLogger } from "../helper/fakes";
import type { SpeechState } from "../speech/speech-service";
import { createModelDownload } from "./model-download";

const model: SpeechModel = { id: "m", label: "Test model", totalBytes: 1000, files: [] };

function setup(speech: SpeechState = "missing") {
  const state = { speech };
  let finish!: () => void;
  let fail!: (error: Error) => void;
  let progress!: (done: number, total: number) => void;
  const download = vi.fn((onProgress: (done: number, total: number) => void) => {
    progress = onProgress;
    return new Promise<void>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
  });
  const onDownloaded = vi.fn(() => {
    state.speech = "loading";
  });
  const downloader = createModelDownload({
    model,
    download,
    speechState: () => state.speech,
    onDownloaded,
    logger: createTestLogger(),
  });
  return {
    downloader,
    download,
    onDownloaded,
    state,
    finish: () => finish(),
    fail: (error: Error) => fail(error),
    progress: (done: number) => progress(done, model.totalBytes),
  };
}

describe("model download", () => {
  it("maps the speech state when no download is running", () => {
    const { downloader, state } = setup("missing");
    expect(downloader.status()).toMatchObject({ state: "missing", label: "Test model" });
    state.speech = "corrupt";
    expect(downloader.status().state).toBe("missing");
    state.speech = "checking";
    expect(downloader.status().state).toBe("preparing");
    state.speech = "ready";
    expect(downloader.status().state).toBe("ready");
    state.speech = "failed";
    expect(downloader.status()).toMatchObject({ state: "failed" });
    expect(downloader.status().message).toContain("could not be loaded");
  });

  it("reports progress, then hands over to the speech service", async () => {
    const { downloader, progress, finish, onDownloaded } = setup();
    downloader.start();
    expect(downloader.status()).toMatchObject({ state: "downloading", downloadedBytes: 0 });
    progress(400);
    expect(downloader.status().downloadedBytes).toBe(400);
    progress(5000);
    expect(downloader.status().downloadedBytes).toBe(1000);
    finish();
    await downloader.settled();
    expect(onDownloaded).toHaveBeenCalledOnce();
    expect(downloader.status().state).toBe("preparing");
  });

  it("runs one download at a time", () => {
    const { downloader, download } = setup();
    downloader.start();
    downloader.start();
    expect(download).toHaveBeenCalledOnce();
  });

  it("does not download a model that is ready", () => {
    const { downloader, download } = setup("ready");
    downloader.start();
    expect(download).not.toHaveBeenCalled();
  });

  it("reports a failed download and can try again", async () => {
    const { downloader, fail, download, onDownloaded } = setup();
    downloader.start();
    fail(new Error("offline"));
    await downloader.settled();
    expect(downloader.status()).toMatchObject({
      state: "failed",
      message: "The download did not finish: offline",
    });
    expect(onDownloaded).not.toHaveBeenCalled();
    downloader.start();
    expect(download).toHaveBeenCalledTimes(2);
    expect(downloader.status().state).toBe("downloading");
  });
});
