import { describe, expect, it } from "vitest";
import { OPEN_POLICY, type EffectivePolicy, type ManagedConfig } from "@murmur/shared";
import { createPolicyService } from "./policy-service";

const teamPolicy = (patch: Partial<EffectivePolicy>): EffectivePolicy => ({
  ...structuredClone(OPEN_POLICY),
  ...patch,
});

function service(managed: ManagedConfig | null = null, invalid: string | null = null) {
  const seen: unknown[] = [];
  const policy = createPolicyService({
    managed: () => ({ config: managed, invalid }),
    onChange: (view) => seen.push(view),
  });
  return { policy, seen };
}

describe("the policy in force", () => {
  it("allows everything when there is no team policy and no managed file", () => {
    const { policy } = service();
    expect(policy.appRefusal({ bundleId: "com.any.app" }, "dictation")).toBeNull();
    expect(policy.featureRefusal("notetaker")).toBeNull();
    expect(policy.urlRefusal("https://example.com/a")).toBeNull();
    expect(policy.retention("audio", null)).toMatchObject({ days: null, limited: false });
    expect(policy.view()).toMatchObject({ active: false, managed: false, featuresOff: [] });
  });

  it("refuses dictation in a blocked app, and Notetaker there only when the policy says so", () => {
    const { policy } = service();
    policy.setTeam([
      teamPolicy({
        blockedApps: [{ bundleId: "com.bank.app", name: "Bank" }],
        adminContact: "it@acme.test",
      }),
    ]);
    const refusal = policy.appRefusal({ bundleId: "COM.BANK.APP" }, "dictation");
    expect(refusal).toContain("Dictation is turned off in this app (Bank)");
    expect(refusal).toContain("Ask it@acme.test");
    expect(policy.appRefusal({ bundleId: "com.bank.app" }, "notetaker")).toBeNull();
    expect(policy.appRefusal({ bundleId: "com.other" }, "dictation")).toBeNull();
    policy.setTeam([
      teamPolicy({
        blockedApps: [{ bundleId: "com.bank.app", name: "" }],
        appliesTo: "dictation_and_notetaker",
      }),
    ]);
    expect(policy.appRefusal({ bundleId: "com.bank.app" }, "notetaker")).not.toBeNull();
  });

  it("turns features off, and one connector off, with the reason", () => {
    const { policy } = service();
    policy.setTeam([
      teamPolicy({
        features: { ...OPEN_POLICY.features, scratchpad: false },
        connectorsDisabled: ["slack"],
      }),
    ]);
    expect(policy.featureRefusal("scratchpad")).toBe(
      "The Scratchpad: turned off by your organization.",
    );
    expect(policy.featureRefusal("connectors", "gmail")).toBeNull();
    expect(policy.featureRefusal("connectors", "slack")).toContain("Connectors");
    expect(policy.view().featuresOff).toEqual(["scratchpad"]);
  });

  it("refuses an address on a blocked host, and its subdomains", () => {
    const { policy } = service();
    policy.setTeam([teamPolicy({ blockedDomains: ["files.example"] })]);
    expect(policy.urlRefusal("https://files.example/x")).toContain("files.example");
    expect(policy.urlRefusal("https://a.files.example/x")).not.toBeNull();
    expect(policy.urlRefusal("https://notfiles.example/x")).toBeNull();
  });

  it("keeps retention inside the limits", () => {
    const { policy } = service();
    policy.setTeam([
      teamPolicy({
        retention: { audio: { max: 7, min: null }, transcript: { max: null, min: 30 } },
      }),
    ]);
    expect(policy.retention("audio", null)).toMatchObject({ days: 7, limited: true });
    expect(policy.retention("audio", 3)).toMatchObject({ days: 3, limited: false });
    expect(policy.retention("transcript", 7)).toMatchObject({ days: 30, limited: true });
  });

  it("takes the strictest of several teams, and drops them all when none is set", () => {
    const { policy, seen } = service();
    policy.setTeam([
      teamPolicy({ features: { ...OPEN_POLICY.features, mcp: false } }),
      teamPolicy({ blockedDomains: ["x.example"], adminContact: "ops" }),
    ]);
    expect(policy.featureRefusal("mcp")).not.toBeNull();
    expect(policy.urlRefusal("https://x.example")).not.toBeNull();
    policy.setTeam([]);
    expect(policy.featureRefusal("mcp")).toBeNull();
    expect(seen).toHaveLength(2);
  });
});

describe("the managed file", () => {
  const managed: ManagedConfig = {
    version: 1,
    policy: { "features.exportToFile": false, blockedDomains: ["managed.example"] },
    updates: { policy: "off" },
  };

  it("applies on top of the team's policy, and without any team", () => {
    const { policy } = service(managed);
    expect(policy.featureRefusal("exportToFile")).not.toBeNull();
    expect(policy.urlRefusal("https://managed.example")).not.toBeNull();
    policy.setTeam([teamPolicy({ features: { ...OPEN_POLICY.features, mcp: false } })]);
    expect(policy.featureRefusal("mcp")).not.toBeNull();
    expect(policy.featureRefusal("exportToFile")).not.toBeNull();
  });

  it("is shown as managed, with the update policy", () => {
    const { policy } = service(managed);
    expect(policy.view()).toMatchObject({
      managed: true,
      active: true,
      updates: { policy: "off", managed: true, canCheck: false },
    });
  });

  it("is reported when it was ignored, and then changes nothing", () => {
    const { policy } = service(null, "The managed configuration is not valid JSON.");
    expect(policy.view()).toMatchObject({
      managed: false,
      managedProblem: "The managed configuration is not valid JSON.",
    });
    expect(policy.featureRefusal("mcp")).toBeNull();
  });

  it("leaves the update policy at notify when the file says nothing about updates", () => {
    const { policy } = service({ version: 1, serverUrl: "https://team.example/" });
    expect(policy.view().updates).toEqual({ policy: "notify", managed: false, canCheck: true });
  });
});
