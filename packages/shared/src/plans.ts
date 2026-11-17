import { z } from "zod";

/**
 * Plan tiers (RW-22, HB-19, TM-25). A local setting that unlocks features for testing; there
 * is no payment, billing or subscription of any kind. The owner's build is on the top tier so
 * every feature can be tried; lower tiers exist to test the gates.
 */

export const PLAN_TIERS = ["free", "pro", "team", "growth", "enterprise"] as const;
export const planTierSchema = z.enum(PLAN_TIERS);
export type PlanTier = z.infer<typeof planTierSchema>;

export const PLAN_LABELS: Record<PlanTier, string> = {
  free: "Free",
  pro: "Pro",
  team: "Team",
  growth: "Growth",
  enterprise: "Enterprise",
};

/** The owner's build (canonical rules): the top tier. */
export const DEFAULT_PLAN: PlanTier = "enterprise";

/** Features Free does not have (RW-22). Every tier from Pro up has them all. */
export const PLAN_FEATURES = [
  "unlimitedRewrites",
  "unlimitedRewriteShortcuts",
  "autoApply",
  "commandMode",
  "qualityModel",
  "focusMode",
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

/** What Free allows where it allows some. */
export const FREE_LIMITS = {
  /** Custom Rewrites; the five built-ins are always there. */
  customRewrites: 3,
  /** Rewrites with their own shortcut. */
  rewriteShortcuts: 3,
} as const;

/** The tier a feature first appears on. */
const FEATURE_TIER: Record<PlanFeature, PlanTier> = {
  unlimitedRewrites: "pro",
  unlimitedRewriteShortcuts: "pro",
  autoApply: "pro",
  commandMode: "pro",
  qualityModel: "pro",
  focusMode: "pro",
};

export function planAllows(tier: PlanTier, feature: PlanFeature): boolean {
  return PLAN_TIERS.indexOf(tier) >= PLAN_TIERS.indexOf(FEATURE_TIER[feature]);
}

/** "Available on Pro". */
export function lockedText(feature: PlanFeature): string {
  return `Available on ${PLAN_LABELS[FEATURE_TIER[feature]]}`;
}
