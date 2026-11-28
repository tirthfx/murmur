import { describe, expect, it } from "vitest";
import type { Settings } from "@murmur/shared";
import { SAMPLE_SETTINGS } from "../../renderer/hub/test-api";
import { createLanguagePrompt, LANGUAGE_PROMPT_SNOOZE_MS } from "./language-prompt";

function setup(over: Partial<Settings> = {}) {
  let settings: Settings = { ...SAMPLE_SETTINGS.settings, languages: ["en", "fr"], ...over };
  const clock = { now: 1_000 };
  const prompt = createLanguagePrompt({
    settings: () => settings,
    save: (patch) => (settings = { ...settings, ...patch }),
    now: () => clock.now,
  });
  return { prompt, clock, settings: () => settings };
}

const german = { language: "de", confidence: 0.99 };

describe("offering to add a spoken language (DC-17)", () => {
  it("asks only after two confident dictations in a row", () => {
    const { prompt } = setup();
    expect(prompt.heard(german)).toBeNull();
    expect(prompt.heard(german)).toBe("de");
    // The count starts again.
    expect(prompt.heard(german)).toBeNull();
  });

  it("starts again after anything else in between", () => {
    for (const between of [
      undefined,
      { language: "en", confidence: 0.99 },
      { language: "de", confidence: 0.85 },
      { language: "es", confidence: 0.99 },
    ]) {
      const { prompt } = setup();
      prompt.heard(german);
      prompt.heard(between);
      expect(prompt.heard(german)).toBeNull();
    }
  });

  it("never asks about a chosen language, one it cannot offer, or with the list full", () => {
    const chosen = setup({ languages: ["en", "hi-Latn"] });
    chosen.prompt.heard({ language: "hi", confidence: 0.99 });
    expect(chosen.prompt.heard({ language: "hi", confidence: 0.99 })).toBeNull();

    const unknown = setup();
    unknown.prompt.heard({ language: "sw", confidence: 0.99 });
    expect(unknown.prompt.heard({ language: "sw", confidence: 0.99 })).toBeNull();

    const full = setup({ languages: ["en", "fr", "es", "it", "pt"] });
    full.prompt.heard(german);
    expect(full.prompt.heard(german)).toBeNull();
  });

  it("can be turned off", () => {
    const { prompt } = setup({ languagePrompt: { enabled: false, snoozed: {} } });
    prompt.heard(german);
    expect(prompt.heard(german)).toBeNull();
  });

  it("adds the language at the end of the list", () => {
    const { prompt, settings } = setup();
    prompt.add("de");
    prompt.add("de");
    expect(settings().languages).toEqual(["en", "fr", "de"]);
  });

  it("keeps quiet about a language for a week after Not now", () => {
    const { prompt, clock, settings } = setup({
      languagePrompt: { enabled: true, snoozed: { es: 500 } },
    });
    prompt.notNow("de");
    // An old snooze is dropped.
    expect(settings().languagePrompt.snoozed).toEqual({ de: 1_000 + LANGUAGE_PROMPT_SNOOZE_MS });
    prompt.heard(german);
    expect(prompt.heard(german)).toBeNull();
    clock.now += LANGUAGE_PROMPT_SNOOZE_MS;
    prompt.heard(german);
    expect(prompt.heard(german)).toBe("de");
  });
});
