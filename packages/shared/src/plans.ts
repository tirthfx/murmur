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

/** HB-19: Free's weekly dictation limit, in words; the week starts on Monday. */
export const FREE_WEEKLY_WORDS = 2000;

/** HB-19: a trial of Pro, extended once. */
export const TRIAL = { days: 14, extendDays: 7 } as const;

export const PLAN_MESSAGES = {
  weeklyLimit: "Weekly limit reached. Resets Monday.",
  noCharge: "Nothing is charged and no payment is ever made: this is a local switch for testing.",
} as const;

export const planStateSchema = z.strictObject({
  /** A trial of Pro; the tier before it comes back when it ends. */
  trial: z
    .strictObject({
      startedAt: z.number(),
      endsAt: z.number(),
      extended: z.boolean(),
      previousTier: planTierSchema,
    })
    .nullable(),
  /** Display only; no effect on anything. */
  student: z.boolean(),
  /** Each change, newest first, at most 50. */
  log: z.array(z.strictObject({ at: z.number(), text: z.string().max(120) })).max(50),
});
export type PlanState = z.infer<typeof planStateSchema>;

export const DEFAULT_PLAN_STATE: PlanState = { trial: null, student: false, log: [] };

export const planViewSchema = z.strictObject({
  tier: planTierSchema,
  /** Words dictated this week (Monday to now). */
  weekWords: z.number(),
  /** The limit on the current tier, or null for none. */
  weeklyLimit: z.number().nullable(),
  state: planStateSchema,
});
export type PlanView = z.infer<typeof planViewSchema>;

export const planActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("startTrial") }),
  z.strictObject({ type: z.literal("extendTrial") }),
  z.strictObject({ type: z.literal("endTrial") }),
  z.strictObject({ type: z.literal("student"), on: z.boolean() }),
]);
export type PlanAction = z.infer<typeof planActionSchema>;

/** Whether this week's words already reached the tier's limit. */
export function weeklyLimitReached(tier: PlanTier, weekWords: number): boolean {
  return tier === "free" && weekWords >= FREE_WEEKLY_WORDS;
}

/** Whole days left in a trial, rounded up. */
export function trialDaysLeft(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 86_400_000));
}
