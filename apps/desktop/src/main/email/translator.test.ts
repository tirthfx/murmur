import { describe, expect, it, vi } from "vitest";
import { createTestLogger } from "../helper/fakes";
import { LlmTimeoutError, type LlmClient } from "../cleanup/llm-client";
import { createTranslator } from "./translator";

function llmWith(translate: LlmClient["translate"]): LlmClient {
  return {
    prepare: vi.fn(),
    clean: vi.fn(),
    generate: vi.fn(),
    stop: vi.fn(),
    translate: vi.fn(translate),
  };
}

describe("email translator", () => {
  it("asks for the language by name, within six seconds, and keeps a good answer", async () => {
    const llm = llmWith(async () => " Rendez-vous à 5 h avec Rahul. ");
    const translate = createTranslator({
      llm,
      modelReady: async () => true,
      logger: createTestLogger(),
    });
    await expect(translate("See you at 5 with Rahul.", "fr", ["Rahul"])).resolves.toBe(
      "Rendez-vous à 5 h avec Rahul.",
    );
    expect(llm.translate).toHaveBeenCalledWith("See you at 5 with Rahul.", "French", 6000, [
      "Rahul",
    ]);
  });

  it("gives null on a timeout, a refused answer or no model", async () => {
    const logger = createTestLogger();
    const slow = createTranslator({
      llm: llmWith(async () => {
        throw new LlmTimeoutError();
      }),
      modelReady: async () => true,
      logger,
    });
    await expect(slow("Hello.", "fr", [])).resolves.toBeNull();

    const dropsNumber = createTranslator({
      llm: llmWith(async () => "Rendez-vous ce soir."),
      modelReady: async () => true,
      logger,
    });
    await expect(dropsNumber("See you at 5 tonight.", "fr", [])).resolves.toBeNull();

    const noModel = createTranslator({ llm: null, modelReady: async () => false, logger });
    await expect(noModel("Hello.", "fr", [])).resolves.toBeNull();
  });
});
