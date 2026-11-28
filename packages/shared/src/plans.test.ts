import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN, lockedText, PLAN_FEATURES, planAllows } from "./plans";

describe("plans", () => {
  it("defaults to the top tier, so every feature can be tried", () => {
    expect(DEFAULT_PLAN).toBe("pro");
    for (const feature of PLAN_FEATURES) expect(planAllows(DEFAULT_PLAN, feature)).toBe(true);
  });

  it("gates every feature on Free", () => {
    for (const feature of PLAN_FEATURES) expect(planAllows("free", feature)).toBe(false);
    expect(lockedText()).toBe("Available on Pro");
  });
});
