import { describe, expect, it } from "vitest";
import { availableTours, referralCode, referralSettingsSchema, TOURS } from "./help";

describe("tours (HB-08)", () => {
  it("has five tours, each with steps on a Hub route", () => {
    expect(TOURS).toHaveLength(5);
    for (const tour of TOURS) {
      expect(tour.steps.length).toBeGreaterThan(0);
      for (const step of tour.steps) expect(step.hash).toMatch(/^#\/[a-z-]+(\/[a-z]+)?$/);
    }
  });

  it("leaves out the Command Mode step while that experiment is off", () => {
    const off = availableTours(false).find((tour) => tour.id === "rewrites-commands")!;
    expect(off.steps).toHaveLength(1);
    expect(
      availableTours(true).find((tour) => tour.id === "rewrites-commands")!.steps,
    ).toHaveLength(2);
  });
});

describe("referral code (HB-43)", () => {
  it("is eight unambiguous characters", () => {
    const code = referralCode((count) => new Uint8Array(count).map((_, i) => i * 37));
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(referralSettingsSchema.safeParse({ code, invites: 0 }).success).toBe(true);
  });
});
