import { describe, expect, it, vi } from "vitest";
import { cleanTitle, titleFromSummary } from "./meeting-title";

describe("a title from a summary (NT-05)", () => {
  it("takes the first line without quotes, marks or a full stop", () => {
    expect(cleanTitle('"Roadmap review."\nMore words')).toBe("Roadmap review");
    expect(cleanTitle("## Title: Budget for March")).toBe("Budget for March");
    expect(cleanTitle("**Hiring plan**")).toBe("Hiring plan");
  });

  it("refuses nothing, a sentence and an over-long line", () => {
    expect(cleanTitle("  \n")).toBeNull();
    expect(
      cleanTitle("The team met to talk about the roadmap and then moved on to hiring and money"),
    ).toBeNull();
    expect(cleanTitle("x".repeat(400))).toBeNull();
  });

  it("gives the model the start of the summary", async () => {
    const ask = vi.fn(async () => "Roadmap review");
    await expect(titleFromSummary(ask, "a".repeat(10_000))).resolves.toBe("Roadmap review");
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ prompt: "a".repeat(4_000) }));
  });
});
