import { describe, expect, it, vi } from "vitest";
import type { HelperStatus, SpeechModel } from "@murmur/shared";
import { createTestLogger, flush } from "../helper/fakes";
import { HelperError } from "../helper/types";
import type { ModelCheck } from "./model-store";
import { createSpeechService } from "./speech-service";

const model: SpeechModel = {
  id: "test-model",
  label: "Test model",
  totalBytes: 648_000_000,
  files: [],
};

function setup(checkResult: ModelCheck = { ok: true }) {
  const statusHandlers = new Set<(status: HelperStatus) => void>();
  let state: HelperStatus["state"] = "ready";
  const helper = {
    loadSpeechModel: vi.fn(async () => ({
      loadedModel: "test-model",
      loadMs: 4200,
      computeUnits: "ane",
    })),
    transcribeFile: vi.fn(async () => ({
      text: "Hello there.",
      language: "en",
      segments: [],
      decodeMs: 300,
      audioMs: 2000,
    })),
    onStatusChange: (handler: (status: HelperStatus) => void) => {
      statusHandlers.add(handler);
      return () => statusHandlers.delete(handler);
    },
    getStatus: (): HelperStatus => ({ state, helperVersion: null, message: null }),
  };
  const check = vi.fn(async () => checkResult);
  const logger = createTestLogger();
  const service = createSpeechService({ helper, model, root: "/models", logger, check });
  return {
    helper,
    check,
    logger,
    service,
    setStatus(next: HelperStatus["state"]) {
      state = next;
      for (const handler of statusHandlers) handler(status(next));
    },
  };
}

function status(state: HelperStatus["state"]): HelperStatus {
  return { state, helperVersion: null, message: null };
}

describe("speech service", () => {
  it("checks the files, then loads the model from its folders", async () => {
    const { service, helper, logger } = setup();
    service.start();
    await flush();
    expect(helper.loadSpeechModel).toHaveBeenCalledWith({
      model: "test-model",
      modelDir: "/models/test-model/model",
      tokenizerDir: "/models/test-model/tokenizer",
    });
    expect(service.getState()).toBe("ready");
    expect(logger.lines).toContain("info: speech model ready in 4200 ms (ane)");
  });

  it("does not load a model that failed its checksum check", async () => {
    const { service, helper, logger } = setup({
      ok: false,
      reason: "checksum",
      file: "model/config.json",
    });
    service.start();
    await flush();
    expect(service.getState()).toBe("corrupt");
    expect(helper.loadSpeechModel).not.toHaveBeenCalled();
    expect(logger.lines.join("\n")).toContain("failed its checksum check (model/config.json)");
    await expect(service.transcribe("/a.pcm")).rejects.toThrow("not ready (corrupt)");
  });

  it("says how to download a missing model", async () => {
    const { service, logger } = setup({ ok: false, reason: "missing", file: "model/config.json" });
    service.start();
    await flush();
    expect(service.getState()).toBe("missing");
    expect(logger.lines.join("\n")).toContain("npm run model:download");
  });

  it("checks the files once but loads again after a helper restart", async () => {
    const { service, helper, check, setStatus } = setup();
    service.start();
    await flush();
    setStatus("starting");
    expect(service.getState()).toBe("idle");
    setStatus("ready");
    await flush();
    expect(check).toHaveBeenCalledTimes(1);
    expect(helper.loadSpeechModel).toHaveBeenCalledTimes(2);
    expect(service.getState()).toBe("ready");
  });

  it("looks again after a download and loads the model", async () => {
    const { service, helper, check } = setup({ ok: false, reason: "missing", file: "a" });
    service.start();
    await flush();
    expect(service.getState()).toBe("missing");
    check.mockResolvedValue({ ok: true });
    service.recheck();
    await flush();
    expect(check).toHaveBeenCalledTimes(2);
    expect(helper.loadSpeechModel).toHaveBeenCalledOnce();
    expect(service.getState()).toBe("ready");
  });

  it("reports a load failure", async () => {
    const { service, helper, logger } = setup();
    helper.loadSpeechModel.mockRejectedValueOnce(
      new HelperError("MODEL_LOAD_FAILED", "missing tokenizer.json"),
    );
    service.start();
    await flush();
    expect(service.getState()).toBe("failed");
    expect(logger.lines.join("\n")).toContain("missing tokenizer.json");
  });

  it("transcribes with the configured languages once ready", async () => {
    const { service, helper } = setup();
    service.start();
    await flush();
    await expect(service.transcribe("/tmp/a.pcm")).resolves.toMatchObject({ text: "Hello there." });
    expect(helper.transcribeFile).toHaveBeenCalledWith({ path: "/tmp/a.pcm", languages: [] });
  });
});
