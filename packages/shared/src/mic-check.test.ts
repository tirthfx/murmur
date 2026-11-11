import { describe, expect, it } from "vitest";
import { MIC_CHECK_SENTENCES, micAdvice, micAdviceText } from "./mic-check";

describe("microphone check advice", () => {
  it("recommends from the gap between speech and background", () => {
    expect(micAdvice(-20, -60)).toBe("close-talk");
    expect(micAdvice(-25, -50)).toBe("quiet-room");
    expect(micAdvice(-25, -40)).toBe("noisy");
  });

  it("says when the voice was too quiet or not heard", () => {
    expect(micAdvice(-55, -70)).toBe("too-quiet");
    expect(micAdvice(null, null)).toBe("too-quiet");
    expect(micAdviceText("too-quiet")).toContain("Move closer");
  });

  it("has five sentences", () => {
    expect(MIC_CHECK_SENTENCES).toHaveLength(5);
  });
});
