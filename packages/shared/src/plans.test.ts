import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN, lockedText, PLAN_FEATURES, PLAN_TIERS, planAllows } from "./plans";

describe("plans", () => {
  it("defaults to the top tier, so every feature can be tried", () => {
    expect(DEFAULT_PLAN).toBe("enterprise");
    for (const feature of PLAN_FEATURES) expect(planAllows(DEFAULT_PLAN, feature)).toBe(true);
  });

  it("locks every gated feature on Free and unlocks them from Pro up", () => {
    for (const feature of PLAN_FEATURES) {
      expect(planAllows("free", feature)).toBe(false);
      for (const tier of PLAN_TIERS.slice(1)) expect(planAllows(tier, feature)).toBe(true);
      expect(lockedText(feature)).toBe("Available on Pro");
    }
  });
});
