import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAN_STATE,
  trialDaysLeft,
  weeklyLimitReached,
  type PlanState,
  type PlanTier,
} from "@murmur/shared";
import { createPlanController } from "./plan-controller";

const DAY = 86_400_000;

function setup(tier: PlanTier = "free") {
  const box: { tier: PlanTier; state: PlanState; now: number } = {
    tier,
    state: DEFAULT_PLAN_STATE,
    now: 0,
  };
  const plan = createPlanController({
    tier: () => box.tier,
    state: () => box.state,
    save: ({ plan: next, planState }) => {
      if (next) box.tier = next;
      box.state = planState;
    },
    now: () => box.now,
  });
  return { plan, box };
}

describe("plans (HB-19)", () => {
  it("limits Free to 2,000 words a week and nothing else", () => {
    expect(weeklyLimitReached("free", 1999)).toBe(false);
    expect(weeklyLimitReached("free", 2000)).toBe(true);
    expect(weeklyLimitReached("pro", 10_000)).toBe(false);
  });

  it("runs a 14-day trial of Pro and goes back to Free when it ends", () => {
    const { plan, box } = setup();
    plan.act({ type: "startTrial" });
    expect(box.tier).toBe("pro");
    expect(trialDaysLeft(box.state.trial!.endsAt, 0)).toBe(14);
    box.now = 13 * DAY;
    expect(plan.expire()).toBe(false);
    box.now = 14 * DAY;
    expect(plan.expire()).toBe(true);
    expect(box.tier).toBe("free");
    expect(box.state.trial).toBeNull();
    expect(box.state.log[0]!.text).toBe("Trial ended; back to Free");
  });

  it("extends once by 7 days and can end early", () => {
    const { plan, box } = setup();
    plan.act({ type: "startTrial" });
    plan.act({ type: "extendTrial" });
    plan.act({ type: "extendTrial" });
    expect(trialDaysLeft(box.state.trial!.endsAt, 0)).toBe(21);
    plan.act({ type: "endTrial" });
    expect(box.tier).toBe("free");
    expect(box.state.log.map((entry) => entry.text)).toEqual([
      "Trial ended early; back to Free",
      "Trial extended by 7 days",
      "Trial of Pro started for 14 days",
    ]);
  });

  it("logs tier changes and the student label, which changes nothing else", () => {
    const { plan, box } = setup("pro");
    plan.tierChanged("pro", "free");
    plan.act({ type: "student", on: true });
    expect(box.tier).toBe("pro");
    expect(box.state.student).toBe(true);
    expect(box.state.log.map((entry) => entry.text)).toEqual([
      "Student label on",
      "Plan changed from Pro to Free",
    ]);
  });
});
