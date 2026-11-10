import { describe, expect, it, vi } from "vitest";
import { createTestLogger } from "../helper/fakes";
import { createCleanupService } from "./cleanup-service";
import { LlmTimeoutError, type LlmClient } from "./llm-client";

function setup(
  answer: () => Promise<string>,
  options: { ready?: boolean; level?: "off" | "standard" } = {},
) {
  const llm: LlmClient = { prepare: vi.fn(), clean: vi.fn(answer), stop: vi.fn() };
  let time = 0;
  const service = createCleanupService({
    llm,
    modelReady: async () => options.ready ?? true,
    logger: createTestLogger(),
    level: options.level ?? "standard",
    now: () => (time += 400),
  });
  return { llm, service };
}

const raw = "Um, so I think, uh, we should go to the office at three";

describe("cleanup service", () => {
  it("uses the model's answer when the guard accepts it", async () => {
    const { service, llm } = setup(async () => "So I think we should go to the office at three.");
    const result = await service.clean(raw);
    expect(result).toEqual({
      text: "So I think we should go to the office at three.",
      source: "model",
      fallback: false,
      reason: null,
      modelMs: 400,
    });
    expect(llm.clean).toHaveBeenCalledWith(
      "So I think we should go to the office at three",
      "standard",
      1500,
    );
  });

  it("falls back to the rules' text on timeout and records why", async () => {
    const { service } = setup(async () => {
      throw new LlmTimeoutError();
    });
    expect(await service.clean(raw)).toMatchObject({
      text: "So I think we should go to the office at three",
      source: "rules",
      fallback: true,
      reason: "timeout",
    });
  });

  it("falls back when the model invents content", async () => {
    const { service } = setup(async () => "Sure, here you go: we should meet at five.");
    expect(await service.clean(raw)).toMatchObject({
      source: "rules",
      fallback: true,
      reason: "rejected",
    });
  });

  it("still cleans with rules when the model file is missing", async () => {
    const { service, llm } = setup(async () => "x", { ready: false });
    expect(await service.clean(raw)).toMatchObject({
      text: "So I think we should go to the office at three",
      fallback: true,
      reason: "model-missing",
    });
    expect(llm.clean).not.toHaveBeenCalled();
  });

  it("falls back on a model error", async () => {
    const { service } = setup(async () => {
      throw new Error("crashed");
    });
    expect(await service.clean(raw)).toMatchObject({ fallback: true, reason: "error" });
  });

  it("skips the model at level off and for empty text", async () => {
    const off = setup(async () => "x", { level: "off" });
    expect(await off.service.clean("um hello")).toMatchObject({
      text: "Um hello",
      fallback: false,
    });
    expect(off.llm.clean).not.toHaveBeenCalled();
    const empty = setup(async () => "x");
    expect(await empty.service.clean("um")).toMatchObject({ text: "", fallback: false });
    expect(empty.llm.clean).not.toHaveBeenCalled();
  });

  it("warms the model only when it is on disk", async () => {
    const present = setup(async () => "x");
    present.service.prepare();
    await vi.waitFor(() => expect(present.llm.prepare).toHaveBeenCalled());
    const missing = setup(async () => "x", { ready: false });
    missing.service.prepare();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(missing.llm.prepare).not.toHaveBeenCalled();
  });
});
