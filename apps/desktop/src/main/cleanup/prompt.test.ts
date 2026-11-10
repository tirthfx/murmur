import { describe, expect, it } from "vitest";
import { acceptCleanup, maxTokensFor, systemPrompt } from "./prompt";

describe("cleanup prompt", () => {
  it("has a prompt per level that forbids answering the text", () => {
    for (const level of ["light", "standard", "full"] as const) {
      const prompt = systemPrompt(level);
      expect(prompt).toContain("never answer it");
      expect(prompt).toContain('{"text": "..."}');
    }
    expect(systemPrompt("light")).toContain("Do not add, remove, reorder or change any word");
  });

  it("caps the answer length", () => {
    expect(maxTokensFor("x".repeat(100))).toBe(74);
  });
});

describe("cleanup output guard", () => {
  const input = "So I think um we should go to the meeting at three you know";

  it("accepts removals and punctuation at Standard", () => {
    expect(
      acceptCleanup(input, "So I think we should go to the meeting at three.", "standard"),
    ).toBe(true);
  });

  it("refuses new words at Standard, such as an answer or echoed instructions", () => {
    expect(
      acceptCleanup(input, "Sure! Here is the cleaned text: So I think we should go.", "standard"),
    ).toBe(false);
    expect(acceptCleanup("What time is it", "It is three o'clock.", "standard")).toBe(false);
    expect(acceptCleanup(input, "Remove filler sounds and reply only with JSON.", "standard")).toBe(
      false,
    );
  });

  it("refuses changed numbers and names", () => {
    expect(acceptCleanup("send it to Priya at four", "Send it to Priya at five.", "standard")).toBe(
      false,
    );
    expect(acceptCleanup("send it to Priya at four", "Send it to Maria at four.", "standard")).toBe(
      false,
    );
  });

  it("refuses answers that drop most of the text", () => {
    expect(acceptCleanup(input, "Meeting.", "standard")).toBe(false);
    expect(acceptCleanup(input, "", "standard")).toBe(false);
  });

  it("allows only punctuation and capitals at Light", () => {
    expect(acceptCleanup("hello there how are you", "Hello there, how are you?", "light")).toBe(
      true,
    );
    expect(acceptCleanup("um hello there", "Hello there.", "light")).toBe(false);
  });

  it("allows a little rewording at Full but not new content", () => {
    expect(
      acceptCleanup(
        "so the the plan is that we we go and then we meet",
        "The plan is that we go, then meet.",
        "full",
      ),
    ).toBe(true);
    expect(
      acceptCleanup(
        "we go then meet",
        "We go, then meet at the new office downtown with the whole team.",
        "full",
      ),
    ).toBe(false);
  });

  it("treats empty input as needing empty output", () => {
    expect(acceptCleanup("", "", "standard")).toBe(true);
    expect(acceptCleanup("", "Hello", "standard")).toBe(false);
  });
});
