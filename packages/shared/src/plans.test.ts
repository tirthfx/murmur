import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAN,
  featureTier,
  hasFeature,
  lockedText,
  PLAN_FEATURES,
  PLAN_TIERS,
  planAllows,
  trainingLock,
  type PlanFeature,
  type PlanTier,
} from "./plans";

/** The matrix in TM-25 written out by hand: the lowest tier of each gated feature. */
const EXPECTED: Record<PlanFeature, PlanTier> = {
  unlimitedRewrites: "pro",
  unlimitedRewriteShortcuts: "pro",
  autoApply: "pro",
  commandMode: "pro",
  qualityModel: "pro",
  focusMode: "pro",
  unlimitedMeetings: "pro",
  askMeetings: "pro",
  connectors: "pro",
  mcp: "pro",
  teams: "team",
  teamVocabulary: "team",
  leaderboard: "team",
  usageDashboards: "team",
  auditLog: "team",
  policyBasic: "team",
  adminConsole: "team",
  usageDashboardsFull: "growth",
  auditExport: "growth",
  policyFull: "growth",
  complianceMode: "growth",
  ipAllowlist: "growth",
  auditSiem: "enterprise",
  identity: "enterprise",
};

describe("plans", () => {
  it("defaults to the top tier, so every feature can be tried", () => {
    expect(DEFAULT_PLAN).toBe("enterprise");
    for (const feature of PLAN_FEATURES) expect(planAllows(DEFAULT_PLAN, feature)).toBe(true);
  });

  it("has exactly the features of the matrix, each from its tier up and not below it", () => {
    expect([...PLAN_FEATURES].sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const feature of PLAN_FEATURES) {
      const from = PLAN_TIERS.indexOf(EXPECTED[feature]);
      expect(featureTier(feature), feature).toBe(EXPECTED[feature]);
      PLAN_TIERS.forEach((tier, index) => {
        expect(hasFeature(tier, feature), `${tier} ${feature}`).toBe(index >= from);
      });
      // Passes on Enterprise, fails on Free (every gated feature is a "No" on Free).
      expect(planAllows("enterprise", feature)).toBe(true);
      expect(planAllows("free", feature)).toBe(false);
      expect(lockedText(feature)).toBe(
        `Available on ${EXPECTED[feature][0]!.toUpperCase()}${EXPECTED[feature].slice(1)}`,
      );
    }
  });

  it("locks the training choice off from Growth up, and the flag is false on every tier", () => {
    for (const tier of PLAN_TIERS) {
      const lock = trainingLock(tier);
      expect(lock.optIn, tier).toBe(false);
      expect(lock.locked, tier).toBe(tier === "growth" || tier === "enterprise");
    }
    expect(trainingLock("growth").notice).toContain("not a network control");
    expect(trainingLock("pro").notice).toContain("never sends");
  });
});
