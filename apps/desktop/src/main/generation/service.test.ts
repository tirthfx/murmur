import { GENERATION_MESSAGES } from "@murmur/shared";
import { describe, expect, it, vi } from "vitest";
import { createTestLogger } from "../helper/fakes";
import {
  LlmCancelledError,
  LlmPreemptedError,
  LlmTimeoutError,
  LlmTooLongError,
  type GenerateOptions,
  type LlmClient,
} from "../cleanup/llm-client";
import type { GenerateRequest } from "../cleanup/engine";
import { RETRY_NOTE, createGenerationService, errorCode, GenerationError } from "./service";

/** Each call streams the given chunks, then resolves with them joined (or rejects). */
function fakeLlm(answers: (string[] | Error)[]) {
  const calls: { request: GenerateRequest; options: GenerateOptions }[] = [];
  const cancel = vi.fn();
  const llm: LlmClient = {
    prepare: vi.fn(),
    clean: vi.fn(),
    translate: vi.fn(),
    stop: vi.fn(),
    generate(request, options) {
      calls.push({ request, options });
      const answer = answers[calls.length - 1] ?? [""];
      options.onStart?.();
      if (answer instanceof Error) return { result: Promise.reject(answer), cancel };
      for (const chunk of answer) options.onChunk?.(chunk);
      return { result: Promise.resolve(answer.join("")), cancel };
    },
  };
  return { llm, calls, cancel };
}

function service(llm: LlmClient | null, ready = true) {
  const logger = createTestLogger();
  let time = 0;
  return {
    logger,
    generation: createGenerationService({
      llm,
      modelReady: async () => ready,
      logger,
      now: () => (time += 100),
    }),
  };
}

const rewrite = {
  kind: "rewrite" as const,
  instruction: "Make it shorter.",
  text: "The long text.",
};

describe("generation service", () => {
  it("streams without the preface and returns the cleaned text, logging no text", async () => {
    const { llm, calls } = fakeLlm([["Sure! Here is a shorter version:\n", "Short text."]]);
    const { generation, logger } = service(llm);
    const chunks: string[] = [];
    const result = await generation.generate(rewrite, { onChunk: (c) => chunks.push(c) }).result;
    expect(result.text).toBe("Short text.");
    expect(result.retried).toBe(false);
    expect(chunks.join("")).toBe("Short text.");
    expect(calls[0]!.request.maxTokens).toBe(4000);
    expect(calls[0]!.options.timeoutMs).toBe(20_000);
    expect(logger.lines.join("\n")).not.toContain("Short text");
  });

  it("uses each kind's limits, and the shorter one for follow-ups", async () => {
    const { llm, calls } = fakeLlm([["a"], ["b"], ["c"]]);
    const { generation } = service(llm);
    await generation.generate({ ...rewrite, kind: "command" }).result;
    await generation.generate({ ...rewrite, kind: "instruct" }).result;
    await generation.generate({ ...rewrite, kind: "instruct", followUp: true }).result;
    expect(calls.map((call) => [call.request.maxTokens, call.options.timeoutMs])).toEqual([
      [2000, 5000],
      [4000, 30_000],
      [4000, 20_000],
    ]);
  });

  it("asks once more when the answer repeats the instruction", async () => {
    const instruction =
      "Turn this into a short, warm reply that thanks the customer and offers a call.";
    const { llm, calls } = fakeLlm([[instruction], ["Thanks so much! Happy to call."]]);
    const { generation } = service(llm);
    const reset = vi.fn();
    const result = await generation.generate({ ...rewrite, instruction }, { onReset: reset })
      .result;
    expect(result).toMatchObject({ text: "Thanks so much! Happy to call.", retried: true });
    expect(reset).toHaveBeenCalledOnce();
    expect(calls[1]!.request.system.endsWith(RETRY_NOTE)).toBe(true);
    expect(calls[1]!.options.timeoutMs).toBeLessThan(20_000);
  });

  it("gives up after a second repeat, and on an empty answer", async () => {
    const instruction =
      "Turn this into a short, warm reply that thanks the customer and offers a call.";
    const twice = fakeLlm([[instruction], [instruction]]);
    await expect(
      service(twice.llm).generation.generate({ ...rewrite, instruction }).result,
    ).rejects.toMatchObject({ code: "empty", message: GENERATION_MESSAGES.empty });
    const blank = fakeLlm([["Sure! Here is the text:\n"]]);
    await expect(service(blank.llm).generation.generate(rewrite).result).rejects.toMatchObject({
      code: "empty",
    });
    expect(blank.calls).toHaveLength(1);
  });

  it("says the model is missing", async () => {
    await expect(service(null).generation.generate(rewrite).result).rejects.toMatchObject({
      code: "model-missing",
    });
    const { llm } = fakeLlm([["x"]]);
    await expect(service(llm, false).generation.generate(rewrite).result).rejects.toMatchObject({
      code: "model-missing",
    });
  });

  it("maps client errors to codes and the spec's messages", async () => {
    for (const [error, code] of [
      [new LlmTimeoutError(), "timeout"],
      [new LlmPreemptedError(), "preempted"],
      [new LlmCancelledError(), "cancelled"],
      [new LlmTooLongError(), "too-long"],
      [new Error("failed to allocate VRAM"), "memory"],
      [new Error("boom"), "error"],
    ] as const) {
      const { llm } = fakeLlm([error]);
      const rejected = service(llm).generation.generate(rewrite).result;
      await expect(rejected).rejects.toBeInstanceOf(GenerationError);
      await expect(rejected).rejects.toMatchObject({ code, message: GENERATION_MESSAGES[code] });
    }
    expect(GENERATION_MESSAGES.timeout).toBe(
      "Taking too long. Try again or pick a smaller selection.",
    );
    expect(errorCode(new GenerationError("empty"))).toBe("empty");
  });

  it("cancel() passes to the running request", async () => {
    let finish: (value: string) => void = () => {};
    const cancel = vi.fn(() => finish(""));
    const llm: LlmClient = {
      ...fakeLlm([]).llm,
      generate: () => ({
        result: new Promise<string>((resolve) => {
          finish = resolve;
        }),
        cancel,
      }),
    };
    const run = service(llm).generation.generate(rewrite);
    await Promise.resolve();
    await Promise.resolve();
    run.cancel();
    expect(cancel).toHaveBeenCalledOnce();
    await expect(run.result).rejects.toMatchObject({ code: "cancelled" });
  });
});
