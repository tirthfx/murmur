import {
  DEFAULT_PLAN,
  PLAN_FEATURES,
  PLAN_LABELS,
  PLAN_TIERS,
  featureTier,
  lockedText,
  planAllows,
  trainingLock,
  type PlanFeature,
  type PlanTier,
} from "../../../packages/shared/src/plans.ts";
import type { AuditInput } from "./audit.ts";
import { fail, type Failure } from "./http.ts";
import type { Settings } from "./settings.ts";

/**
 * The plan tier of this server (TM-24, TM-25): a local setting that decides which features the
 * team side offers. It is a switch for testing. There is no billing, no payment and no
 * subscription anywhere in Murmur, and the tier is not tied to any account.
 */
export interface PlanDeps {
  settings: Settings;
  audit(input: AuditInput): void;
}

export function createPlan(deps: PlanDeps) {
  const tier = (): PlanTier => {
    const saved = deps.settings.get<string>("plan.tier", DEFAULT_PLAN);
    return (PLAN_TIERS as readonly string[]).includes(saved) ? (saved as PlanTier) : DEFAULT_PLAN;
  };

  return {
    tier,
    allows: (feature: PlanFeature) => planAllows(tier(), feature),

    /** The failure to give when a feature is not on this tier, or null when it is. */
    require(feature: PlanFeature): Failure | null {
      return planAllows(tier(), feature)
        ? null
        : fail(
            403,
            "plan_required",
            `${lockedText(feature)}. This server is on the ${PLAN_LABELS[tier()]} plan.`,
          );
    },

    view() {
      const current = tier();
      return {
        tier: current,
        label: PLAN_LABELS[current],
        note: "A local switch for testing. Nothing is charged and no payment is ever made.",
        training: trainingLock(current),
        features: PLAN_FEATURES.map((name) => ({
          name,
          availableFrom: featureTier(name),
          allowed: planAllows(current, name),
        })),
      };
    },

    /** The owner changes the tier. The change is audited, and so is a change in the training lock. */
    setTier(actorId: string, next: unknown): { ok: true; tier: PlanTier } | Failure {
      if (typeof next !== "string" || !(PLAN_TIERS as readonly string[]).includes(next))
        return fail(400, "invalid_tier", `The tier is ${PLAN_TIERS.join(", ")}.`);
      const before = tier();
      if (before !== next) {
        deps.settings.set("plan.tier", next);
        deps.audit({ actorId, action: "plan.changed", detail: { from: before, to: next } });
        const was = trainingLock(before).locked;
        const now = trainingLock(next as PlanTier).locked;
        if (was !== now)
          deps.audit({
            actorId,
            action: "plan.training_lock",
            detail: { locked: now, optIn: false },
          });
      }
      return { ok: true, tier: next as PlanTier };
    },
  };
}

export type Plan = ReturnType<typeof createPlan>;
