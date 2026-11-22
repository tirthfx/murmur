import { describe, expect, it } from "vitest";
import { canCheckForUpdates, parseManagedConfig, updatePolicyOf } from "./managed";

describe("update policy", () => {
  it("is notify by default, and the check button is open", () => {
    expect(updatePolicyOf(null)).toBe("notify");
    expect(canCheckForUpdates(null)).toBe(true);
  });

  it("disables the check button whenever updates are managed, and says off when off", () => {
    for (const policy of ["off", "automatic", "notify"] as const) {
      const parsed = parseManagedConfig(JSON.stringify({ version: 1, updates: { policy } }));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(updatePolicyOf(parsed.config)).toBe(policy);
      expect(canCheckForUpdates(parsed.config)).toBe(false);
    }
    const unmanagedUpdates = parseManagedConfig(
      JSON.stringify({ version: 1, serverUrl: "http://127.0.0.1:7830" }),
    );
    expect(unmanagedUpdates.ok && canCheckForUpdates(unmanagedUpdates.config)).toBe(true);
  });

  it("names the field that is wrong", () => {
    const result = parseManagedConfig(JSON.stringify({ version: 1, updates: { policy: "never" } }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).toContain("updates.policy");
  });
});
