import { describe, expect, it } from "vitest";
import type { FocusContext } from "@murmur/shared";
import { contextTerms, describeContext, speechPrompt } from "./context";

const base: FocusContext = {
  appName: "Slack",
  bundleId: "com.tinyspeck.slackmacgap",
  windowTitle: "Priya Raghunathan (DM)",
  role: "AXTextArea",
  subrole: null,
  editable: true,
  secure: false,
  textBefore: "Hi Priya, the GitHub build for v2 failed on the iPhone target. ",
  textAfter: "",
};

describe("context", () => {
  it("uses the text before the caret as the speech prompt", () => {
    expect(speechPrompt(base)).toBe(
      "Hi Priya, the GitHub build for v2 failed on the iPhone target.",
    );
  });

  it("keeps only the last part of a long text, starting at a word", () => {
    const prompt = speechPrompt({ ...base, textBefore: "word ".repeat(400) + "Raghunathan" });
    expect(prompt.length).toBeLessThanOrEqual(600);
    expect(prompt.startsWith("word")).toBe(true);
    expect(prompt.endsWith("Raghunathan")).toBe(true);
  });

  it("collects names and terms, not common words", () => {
    expect(contextTerms(base)).toEqual(["Priya", "Raghunathan", "DM", "GitHub", "v2", "iPhone"]);
  });

  it("gives nothing for a secure field or no context", () => {
    const secure = { ...base, secure: true };
    expect(speechPrompt(secure)).toBe("");
    expect(contextTerms(secure)).toEqual([]);
    expect(speechPrompt(null)).toBe("");
    expect(contextTerms(null)).toEqual([]);
  });

  it("logs sizes, never the text", () => {
    const line = describeContext(base);
    expect(line).toContain("Slack");
    expect(line).not.toContain("Priya");
    expect(describeContext({ ...base, secure: true })).toContain("nothing read");
  });
});
