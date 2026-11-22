import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OPEN_POLICY,
  POLICY_FEATURES,
  POLICY_KEYS,
  POLICY_NOTICES,
  appBlocked,
  blockingDomain,
  checkPolicyValue,
  clampRetention,
  domainBlocked,
  effectivePolicySchema,
  featureAllowed,
  isPolicyKey,
  mergePolicy,
  normalizeDomain,
  type PolicyValues,
} from "./policy";

describe("domains", () => {
  it("are written the same way however they are typed", () => {
    expect(normalizeDomain("Example.COM")).toBe("example.com");
    expect(normalizeDomain("https://www.Example.com/path?q=1#x")).toBe("example.com");
    expect(normalizeDomain("http://user:pw@news.example.com:8080/a")).toBe("news.example.com");
    expect(normalizeDomain("example.com.")).toBe("example.com");
    expect(normalizeDomain("bücher.de")).toBe("xn--bcher-kva.de");
    expect(normalizeDomain("192.168.1.5")).toBe("192.168.1.5");
  });

  it("refuse what is not a host name", () => {
    for (const bad of [
      "",
      "   ",
      "not a domain",
      "a_b.com",
      "-bad.com",
      "bad-.com",
      "..",
      "a..b",
      "http://",
      "x".repeat(64) + ".com",
    ])
      expect(normalizeDomain(bad), bad).toBeNull();
  });

  it("block subdomains of an entry, and not look-alikes", () => {
    const list = ["example.com"];
    expect(domainBlocked("example.com", list)).toBe(true);
    expect(domainBlocked("sub.example.com", list)).toBe(true);
    expect(domainBlocked("a.b.example.com", list)).toBe(true);
    expect(domainBlocked("https://www.example.com/x", list)).toBe(true);
    expect(domainBlocked("notexample.com", list)).toBe(false);
    expect(domainBlocked("example.com.evil.org", list)).toBe(false);
    expect(domainBlocked("example.org", list)).toBe(false);
    expect(domainBlocked("", list)).toBe(false);
    expect(domainBlocked("sub.example.com", [])).toBe(false);
    expect(blockingDomain("a.example.com", ["other.net", "example.com"])).toBe("example.com");
    expect(blockingDomain("fine.org", ["example.com"])).toBeNull();
  });

  it("are normalised when a policy value is checked", () => {
    const ok = checkPolicyValue("blockedDomains", ["HTTPS://Example.com/x", "news.site.org"]);
    expect(ok).toEqual({ ok: true, value: ["example.com", "news.site.org"] });
    const bad = checkPolicyValue("blockedDomains", ["fine.com", "not a domain"]);
    expect(bad.ok).toBe(false);
  });
});

describe("apps", () => {
  const policy = {
    blockedApps: [
      { bundleId: "com.apple.Notes", name: "Notes" },
      { bundleId: "/Applications/Legacy Tool.app", name: "Legacy" },
    ],
    appliesTo: "dictation" as const,
  };

  it("match by bundle identifier, ignoring case, or by path when there is none", () => {
    expect(appBlocked({ bundleId: "com.apple.notes" }, policy, "dictation")?.name).toBe("Notes");
    expect(appBlocked({ bundleId: "com.apple.Mail" }, policy, "dictation")).toBeNull();
    expect(appBlocked({ path: "/Applications/Legacy Tool.app" }, policy, "dictation")?.name).toBe(
      "Legacy",
    );
    expect(appBlocked({ path: "/Applications/Other.app" }, policy, "dictation")).toBeNull();
    expect(appBlocked({}, policy, "dictation")).toBeNull();
    expect(appBlocked({ bundleId: null, path: null }, policy, "dictation")).toBeNull();
  });

  it("apply to Notetaker only when the policy says so", () => {
    expect(appBlocked({ bundleId: "com.apple.Notes" }, policy, "notetaker")).toBeNull();
    const both = { ...policy, appliesTo: "dictation_and_notetaker" as const };
    expect(appBlocked({ bundleId: "com.apple.Notes" }, both, "notetaker")?.name).toBe("Notes");
  });
});

describe("features and retention", () => {
  it("turns a feature off for everything, or one connector off", () => {
    const policy = mergePolicy([{ "features.mcp": false, "connectors.disabled": ["slack"] }]);
    expect(featureAllowed(policy, "mcp")).toBe(false);
    expect(featureAllowed(policy, "notetaker")).toBe(true);
    expect(featureAllowed(policy, "connectors", "slack")).toBe(false);
    expect(featureAllowed(policy, "connectors", "github")).toBe(true);
    expect(featureAllowed(policy, "connectors")).toBe(true);
    expect(
      featureAllowed(mergePolicy([{ "features.connectors": false }]), "connectors", "github"),
    ).toBe(false);
  });

  it("clamps a choice to the maximum, never lets forever through, and keeps the minimum", () => {
    const limit = { max: 90, min: 7 };
    expect(clampRetention(limit, null)).toEqual({
      days: 90,
      limited: true,
      reason: POLICY_NOTICES.setByOrganization,
    });
    expect(clampRetention(limit, 365)).toMatchObject({ days: 90, limited: true });
    expect(clampRetention(limit, 30)).toEqual({ days: 30, limited: false, reason: "" });
    expect(clampRetention(limit, 3)).toMatchObject({ days: 7, limited: true });
    expect(clampRetention({ max: null, min: null }, null)).toEqual({
      days: null,
      limited: false,
      reason: "",
    });
    expect(clampRetention({ max: null, min: 30 }, null)).toMatchObject({
      days: null,
      limited: false,
    });
    expect(clampRetention({ max: null, min: 30 }, 5)).toMatchObject({ days: 30, limited: true });
  });
});

describe("merging layers", () => {
  const org: PolicyValues = {
    "features.notetaker": false,
    blockedApps: [{ bundleId: "com.a", name: "A" }],
    blockedDomains: ["example.com"],
    "retention.audio.max": 90,
    "retention.audio.min": 7,
    adminContact: "it@example.com",
  };

  it("starts open and stays open with no layers", () => {
    expect(mergePolicy([])).toEqual(OPEN_POLICY);
    expect(effectivePolicySchema.safeParse(mergePolicy([])).success).toBe(true);
    expect(Object.keys(OPEN_POLICY.features).sort()).toEqual([...POLICY_FEATURES].sort());
  });

  it("does not let a department turn on a feature the organisation turned off", () => {
    const merged = mergePolicy([org, { "features.notetaker": true, "features.mcp": false }]);
    expect(merged.features.notetaker).toBe(false);
    expect(merged.features.mcp).toBe(false);
    expect(merged.features.scratchpad).toBe(true);
    // And a department's off holds even if the organisation says nothing.
    expect(mergePolicy([{}, { "features.scratchpad": false }]).features.scratchpad).toBe(false);
  });

  it("adds lists together without repeating an entry", () => {
    const merged = mergePolicy([
      org,
      {
        blockedApps: [
          { bundleId: "COM.A", name: "again" },
          { bundleId: "com.b", name: "B" },
        ],
        blockedDomains: ["example.com", "other.org"],
      },
      { "connectors.disabled": ["slack"], "blockedApps.appliesTo": "dictation_and_notetaker" },
    ]);
    expect(merged.blockedApps.map((app) => [app.bundleId, app.name])).toEqual([
      ["com.a", "A"],
      ["com.b", "B"],
    ]);
    expect(merged.blockedDomains).toEqual(["example.com", "other.org"]);
    expect(merged.connectorsDisabled).toEqual(["slack"]);
    expect(merged.appliesTo).toBe("dictation_and_notetaker");
  });

  it("takes the strictest retention, and a minimum never above the maximum", () => {
    const merged = mergePolicy([
      org,
      { "retention.audio.max": 30, "retention.audio.min": 14 },
      { "retention.audio.max": 60 },
    ]);
    expect(merged.retention.audio).toEqual({ max: 30, min: 14 });
    const crossed = mergePolicy([
      { "retention.transcript.min": 365 },
      { "retention.transcript.max": 90 },
    ]);
    expect(crossed.retention.transcript).toEqual({ max: 90, min: 90 });
  });

  it("keeps the first admin contact", () => {
    expect(mergePolicy([org, { adminContact: "other@example.com" }]).adminContact).toBe(
      "it@example.com",
    );
    expect(mergePolicy([{}, { adminContact: "dept@example.com" }]).adminContact).toBe(
      "dept@example.com",
    );
  });
});

describe("policy values", () => {
  it("know every key and check each one", () => {
    expect(POLICY_KEYS.length).toBeGreaterThan(15);
    expect(isPolicyKey("features.mcp")).toBe(true);
    expect(isPolicyKey("features.nothing")).toBe(false);
    expect(isPolicyKey("toString")).toBe(false);
    expect(checkPolicyValue("features.mcp", true)).toEqual({ ok: true, value: true });
    expect(checkPolicyValue("features.mcp", "yes").ok).toBe(false);
    expect(checkPolicyValue("retention.audio.max", 0).ok).toBe(false);
    expect(checkPolicyValue("retention.audio.max", 3651).ok).toBe(false);
    expect(checkPolicyValue("retention.audio.max", 1.5).ok).toBe(false);
    expect(checkPolicyValue("retention.audio.max", null)).toEqual({ ok: true, value: null });
    expect(checkPolicyValue("blockedApps.appliesTo", "everything").ok).toBe(false);
    expect(checkPolicyValue("connectors.disabled", ["slack", "bad name"]).ok).toBe(false);
    expect(checkPolicyValue("blockedApps", [{ bundleId: "com.a", extra: 1 }]).ok).toBe(false);
    expect(checkPolicyValue("blockedApps", [{ bundleId: "com.a" }])).toMatchObject({
      ok: true,
      value: [{ bundleId: "com.a", name: "" }],
    });
  });

  it("is a file that imports nothing but zod, so the server can load it", () => {
    const source = readFileSync(new URL("./policy.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import .* from "(.*)";$/gm)].map((match) => match[1]);
    expect(imports).toEqual(["zod"]);
  });
});
