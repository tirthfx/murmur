import { describe, expect, it, vi } from "vitest";
import { FREE_MEETINGS_PER_MONTH } from "@murmur/shared";
import { OPEN_POLICY, type EffectivePolicy } from "@murmur/shared";
import { createPolicyService } from "./policy-service";
import { blockedAppRefusal, meetingStartRefusal, meetingsThisMonth, planRefusal } from "./gates";

const AT = new Date(2026, 10, 15, 12).getTime();
const inNov = (day: number) => ({ startedAt: new Date(2026, 10, day, 9).getTime() });
const inOct = { startedAt: new Date(2026, 9, 30, 23).getTime() };

describe("meetingsThisMonth", () => {
  it("counts only the meetings started in the month of now", () => {
    expect(meetingsThisMonth([inNov(1), inNov(2), inOct, inNov(15)], AT)).toBe(3);
    expect(meetingsThisMonth([{ startedAt: AT + 1 }], AT)).toBe(0);
  });
});

describe("meetingStartRefusal", () => {
  const open = { featureRefusal: () => null };
  const many = (count: number) => Array.from({ length: count }, (_, i) => inNov(i + 1));

  it("lets Free record up to the monthly limit, and then says so", () => {
    const base = { policy: open, now: () => AT };
    expect(
      meetingStartRefusal({
        ...base,
        plan: () => "free",
        meetings: () => many(FREE_MEETINGS_PER_MONTH - 1),
      }),
    ).toBeNull();
    const refused = meetingStartRefusal({
      ...base,
      plan: () => "free",
      meetings: () => many(FREE_MEETINGS_PER_MONTH),
    });
    expect(refused).toBe("Available on Pro. Free records 5 meetings a month.");
  });

  it("does not limit Pro and up, and counts only this month", () => {
    const base = { policy: open, now: () => AT };
    expect(
      meetingStartRefusal({ ...base, plan: () => "pro", meetings: () => many(30) }),
    ).toBeNull();
    expect(
      meetingStartRefusal({
        ...base,
        plan: () => "free",
        meetings: () => [inOct, inOct, inOct, inOct, inOct, inOct],
      }),
    ).toBeNull();
  });

  it("refuses when the policy turns Notetaker off, on any plan", () => {
    const refusal = meetingStartRefusal({
      plan: () => "enterprise",
      policy: { featureRefusal: () => "Notetaker: turned off by your organization." },
      meetings: () => [],
      now: () => AT,
    });
    expect(refusal).toContain("Notetaker");
  });
});

describe("planRefusal", () => {
  it("names the plan that has the feature", () => {
    expect(planRefusal("free", "askMeetings")).toBe("Available on Pro");
    expect(planRefusal("pro", "askMeetings")).toBeNull();
    expect(planRefusal("pro", "auditLog")).toBe("Available on Team");
  });
});

describe("blockedAppRefusal (TM-13)", () => {
  const withBlocked = () => {
    const policy = createPolicyService({ managed: () => ({ config: null, invalid: null }) });
    const team: EffectivePolicy = {
      ...structuredClone(OPEN_POLICY),
      blockedApps: [{ bundleId: "com.bank.app", name: "Bank" }],
    };
    policy.setTeam([team]);
    return policy;
  };

  it("refuses dictation in a blocked app, so no capture starts", async () => {
    const refusal = await blockedAppRefusal(
      { policy: withBlocked(), focus: async () => ({ bundleId: "com.bank.app" }) },
      "dictation",
    );
    expect(refusal).toContain("Dictation is turned off in this app");
  });

  it("allows other apps, and an app that cannot be read", async () => {
    const policy = withBlocked();
    expect(
      await blockedAppRefusal(
        { policy, focus: async () => ({ bundleId: "com.notes" }) },
        "dictation",
      ),
    ).toBeNull();
    expect(await blockedAppRefusal({ policy, focus: async () => null }, "dictation")).toBeNull();
    expect(
      await blockedAppRefusal({ policy, focus: () => Promise.reject(new Error("x")) }, "dictation"),
    ).toBeNull();
  });

  it("does not ask for the focused app when nothing is blocked", async () => {
    const policy = createPolicyService({ managed: () => ({ config: null, invalid: null }) });
    const focus = vi.fn(async () => ({ bundleId: "com.bank.app" }));
    expect(await blockedAppRefusal({ policy, focus }, "dictation")).toBeNull();
    expect(focus).not.toHaveBeenCalled();
  });
});
