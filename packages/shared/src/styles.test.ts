import { describe, expect, it } from "vitest";
import { applyStyleRules, PRESETS, STYLE_EXAMPLE_INPUT } from "./styles";

const flags = (preset: keyof typeof PRESETS) => PRESETS[preset].flags;

describe("style rules", () => {
  it("leaves text alone with caps and punctuation", () => {
    expect(applyStyleRules(STYLE_EXAMPLE_INPUT, flags("caps"))).toBe(STYLE_EXAMPLE_INPUT);
  });

  it("drops sentence capitals and the final full stop for no caps, less punctuation", () => {
    expect(applyStyleRules("Sounds good. See you at 5.", flags("no-caps-less"))).toBe(
      "sounds good. see you at 5",
    );
    expect(applyStyleRules(STYLE_EXAMPLE_INPUT, flags("no-caps-less"))).toBe(
      "sounds good. I'll send the notes tonight. can you check them tomorrow?",
    );
  });

  it("drops every full stop after a word for no caps, no full stops, but keeps numbers and links", () => {
    expect(
      applyStyleRules("Sounds good. Price is 3.50 at example.com today.", flags("no-caps-no-stop")),
    ).toBe("sounds good price is 3.50 at example.com today");
  });

  it("keeps the capitals of I, acronyms, inner capitals and known names", () => {
    expect(
      applyStyleRules(
        "Priya said hi. NASA called. GitHub is down. I'm out. Kubernetes too.",
        flags("no-caps-less"),
        new Set(["priya"]),
      ),
    ).toBe("Priya said hi. NASA called. GitHub is down. I'm out. kubernetes too");
  });

  it("works line by line and keeps an ellipsis", () => {
    expect(applyStyleRules("First line.\nSecond line...", flags("no-caps-less"))).toBe(
      "first line\nsecond line...",
    );
  });
});
