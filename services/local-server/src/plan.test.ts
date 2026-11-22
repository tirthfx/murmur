import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PLAN_FEATURES,
  PLAN_TIERS,
  featureTier,
  planAllows,
  type PlanFeature,
  type PlanTier,
} from "../../../packages/shared/src/plans.ts";
import { UNGATED, gateOf } from "./plan-gates.ts";
import { startHarness, type Harness, type Json } from "./test-helpers.ts";

let h: Harness & { owner: { id: string; token: string } };
let team = "";
const p: Record<string, { id: string; token: string }> = {};

beforeAll(async () => {
  h = await startHarness();
  team = (await h.call("POST", "/v1/teams", { token: h.owner.token, body: { name: "Acme" } }))
    .json!["id"] as string;
  for (const [name, role] of [
    ["Ada", "admin"],
    ["Bea", "manager"],
    ["Cy", "member"],
  ] as const) {
    p[name] = await h.person(name);
    h.server.teams.addMember(team, p[name]!.id, role, null, { actorId: null, via: "test" });
  }
});
afterAll(() => h.close());

const tok = (name: string) => p[name]!.token;
const base = () => `/v1/teams/${team}`;
const setTier = (tier: string, who = h.owner.token) =>
  h.call("PUT", "/v1/plan", { token: who, body: { tier } });
const code = (result: { json: Json | null }) => result.json?.["error"]?.code as string | undefined;

describe("which route needs which feature", () => {
  it("has a decision for every route: a feature, or on the list of routes for every plan", () => {
    for (const route of h.server.routes) {
      const key = `${route.method} ${route.path}`;
      const gated = gateOf(route) !== null;
      const free = UNGATED.includes(key);
      expect(gated !== free, key).toBe(true);
    }
    // Nothing on the ungated list is a route that does not exist.
    const keys = h.server.routes.map((route) => `${route.method} ${route.path}`);
    for (const key of UNGATED) expect(keys, key).toContain(key);
  });

  it("only asks for features that exist, and each is one the server can enforce", () => {
    const used = new Set(
      h.server.routes.map(gateOf).filter((feature): feature is PlanFeature => feature !== null),
    );
    for (const feature of used) expect(PLAN_FEATURES).toContain(feature);
    expect([...used].sort()).toEqual(
      [
        "auditExport",
        "auditLog",
        "auditSiem",
        "complianceMode",
        "identity",
        "ipAllowlist",
        "leaderboard",
        "policyBasic",
        "teamVocabulary",
        "teams",
        "usageDashboards",
      ].sort(),
    );
  });

  it("passes on Enterprise and fails on Free for every feature a route needs", async () => {
    const examples: [PlanFeature, string, string][] = [
      ["teams", "GET", `${base()}/members`],
      ["teamVocabulary", "GET", `${base()}/dictionary`],
      ["leaderboard", "GET", `${base()}/leaderboard`],
      ["usageDashboards", "GET", `${base()}/usage`],
      ["auditLog", "GET", "/v1/audit"],
      ["auditExport", "GET", "/v1/audit/export"],
      ["auditSiem", "POST", "/v1/audit/siem/retry"],
      ["policyBasic", "GET", `${base()}/policy`],
      ["complianceMode", "GET", `${base()}/compliance`],
      ["ipAllowlist", "GET", "/v1/network/allowlist"],
      ["identity", "GET", `${base()}/identity`],
    ];
    for (const tier of ["enterprise", "free"] as const) {
      await setTier(tier);
      for (const [feature, method, path] of examples) {
        const result = await h.call(method, path, {
          token: h.owner.token,
          body: method === "POST" ? {} : undefined,
        });
        if (tier === "enterprise")
          expect(code(result), `${feature} on enterprise`).not.toBe("plan_required");
        else {
          expect(result.status, `${feature} on free`).toBe(403);
          expect(code(result)).toBe("plan_required");
          expect(result.json!["error"].message).toContain(
            `Available on ${featureTier(feature)[0]!.toUpperCase()}${featureTier(feature).slice(1)}`,
          );
        }
      }
    }
    await setTier("enterprise");
  });
});

describe("each tier", () => {
  const can = async (method: string, path: string, who: string, body?: unknown) => {
    const result = await h.call(method, path, {
      token: who === "owner" ? h.owner.token : tok(who),
      body,
    });
    return code(result) !== "plan_required";
  };
  const expectations: Record<PlanTier, Record<string, boolean>> = {
    free: {
      teams: false,
      vocabulary: false,
      leaderboard: false,
      usage: false,
      audit: false,
      policy: false,
      compliance: false,
      allowlist: false,
      identity: false,
    },
    pro: {
      teams: false,
      vocabulary: false,
      leaderboard: false,
      usage: false,
      audit: false,
      policy: false,
      compliance: false,
      allowlist: false,
      identity: false,
    },
    team: {
      teams: true,
      vocabulary: true,
      leaderboard: true,
      usage: true,
      audit: true,
      policy: true,
      compliance: false,
      allowlist: false,
      identity: false,
    },
    growth: {
      teams: true,
      vocabulary: true,
      leaderboard: true,
      usage: true,
      audit: true,
      policy: true,
      compliance: true,
      allowlist: true,
      identity: false,
    },
    enterprise: {
      teams: true,
      vocabulary: true,
      leaderboard: true,
      usage: true,
      audit: true,
      policy: true,
      compliance: true,
      allowlist: true,
      identity: true,
    },
  };

  for (const tier of PLAN_TIERS) {
    it(`${tier}: offers exactly what the matrix says`, async () => {
      expect((await setTier(tier)).status).toBe(200);
      const got = {
        teams: await can("GET", `${base()}/members`, "Cy"),
        vocabulary: await can("GET", `${base()}/dictionary`, "Cy"),
        leaderboard: await can("GET", `${base()}/leaderboard`, "Cy"),
        usage: await can("GET", `${base()}/usage`, "Ada"),
        audit: await can("GET", "/v1/audit", "owner"),
        policy: await can("GET", `${base()}/policy`, "Ada"),
        compliance: await can("GET", `${base()}/compliance`, "Ada"),
        allowlist: await can("GET", "/v1/network/allowlist", "owner"),
        identity: await can("GET", `${base()}/identity`, "Ada"),
      };
      expect(got).toEqual(expectations[tier]);
      // Whatever the tier, signing in, accounts and the plan itself work.
      expect((await h.call("GET", "/v1/me", { token: tok("Cy") })).status).toBe(200);
      expect((await h.call("GET", "/v1/plan", { token: tok("Cy") })).status).toBe(200);
      expect((await h.call("GET", "/v1/health")).status).toBe(200);
      // And a stranger is turned away first, without learning the plan.
      expect((await h.call("GET", `${base()}/members`)).status).toBe(401);
    });
  }

  it("keeps back the parts of a feature that belong to a higher tier", async () => {
    await setTier("team");
    // Policy: the basic controls yes, retention and domains no.
    const put = (set: unknown, who = "Ada") =>
      h.call("PUT", `${base()}/policy`, { token: tok(who), body: { set } });
    expect((await put({ "features.mcp": false })).status).toBe(200);
    expect(code(await put({ blockedDomains: ["example.com"] }))).toBe("plan_required");
    expect(code(await put({ "retention.audio.max": 30 }))).toBe("plan_required");
    expect(
      code(
        await h.call("PUT", `${base()}/policy`, {
          token: tok("Ada"),
          body: { unset: ["connectors.readOnly"] },
        }),
      ),
    ).toBe("plan_required");
    // Usage: admins only until Growth.
    expect((await h.call("GET", `${base()}/usage`, { token: tok("Ada") })).status).toBe(200);
    expect(code(await h.call("GET", `${base()}/usage`, { token: tok("Bea") }))).toBe(
      "plan_required",
    );
    // Audit: viewing and verifying yes, export no.
    expect((await h.call("POST", "/v1/audit/verify", { token: h.owner.token })).status).toBe(200);
    expect(code(await h.call("GET", "/v1/audit/export", { token: h.owner.token }))).toBe(
      "plan_required",
    );

    await setTier("growth");
    expect((await put({ "retention.audio.max": 30 })).status).toBe(200);
    expect((await h.call("GET", `${base()}/usage`, { token: tok("Ada") })).status).toBe(200);
    expect(code(await h.call("GET", "/v1/audit/export", { token: h.owner.token }))).not.toBe(
      "plan_required",
    );
    // SIEM streaming is Enterprise.
    const siem = await h.call("PUT", "/v1/audit/settings", {
      token: h.owner.token,
      body: { siemMode: "file" },
    });
    expect(code(siem)).toBe("plan_required");
    expect(
      (
        await h.call("PUT", "/v1/audit/settings", {
          token: h.owner.token,
          body: { retentionDays: 90 },
        })
      ).status,
    ).toBe(200);

    await setTier("enterprise");
    expect(
      (
        await h.call("PUT", "/v1/audit/settings", {
          token: h.owner.token,
          body: { siemMode: "file" },
        })
      ).status,
    ).toBe(200);
    await h.call("PUT", "/v1/audit/settings", { token: h.owner.token, body: { siemMode: "off" } });
    await h.call("PUT", `${base()}/policy`, {
      token: tok("Ada"),
      body: { unset: ["features.mcp", "retention.audio.max"] },
    });
  });
});

describe("the plan itself", () => {
  it("starts on the top tier, for the owner's own build, and is a local switch", async () => {
    const fresh = await startHarness();
    const view = (await fresh.call("GET", "/v1/plan", { token: fresh.owner.token })).json!;
    expect(view).toMatchObject({ tier: "enterprise", label: "Enterprise" });
    expect(view["note"]).toContain("Nothing is charged");
    expect((view["features"] as Json[]).every((f) => f["allowed"] === true)).toBe(true);
    expect((view["features"] as Json[]).map((f) => f["name"])).toEqual([...PLAN_FEATURES]);
    await fresh.close();
  });

  it("is changed by the owner of the server, and the change is audited", async () => {
    expect((await setTier("pro", tok("Ada"))).status).toBe(403);
    expect(code(await setTier("platinum"))).toBe("invalid_tier");
    expect(code(await h.call("PUT", "/v1/plan", { token: h.owner.token, body: {} }))).toBe(
      "invalid_tier",
    );
    await setTier("team");
    expect((await h.call("GET", "/v1/plan", { token: tok("Cy") })).json).toMatchObject({
      tier: "team",
    });
    const events = (await h.call("GET", "/v1/audit?action=plan.changed", { token: h.owner.token }))
      .json!["events"] as Json[];
    expect(
      events.some(
        (e) =>
          (e["detail"] as Json)["from"] === "enterprise" && (e["detail"] as Json)["to"] === "team",
      ),
    ).toBe(true);
    // Setting the tier it is already on writes nothing new.
    const count = events.length;
    await setTier("team");
    expect(
      (
        (await h.call("GET", "/v1/audit?action=plan.changed", { token: h.owner.token })).json![
          "events"
        ] as Json[]
      ).length,
    ).toBe(count);
    await setTier("enterprise");
  });

  it("locks the training choice off on Growth and Enterprise, never turns it on, and writes the lock to the log when it changes", async () => {
    for (const tier of PLAN_TIERS) {
      await setTier(tier);
      const training = (await h.call("GET", "/v1/plan", { token: tok("Cy") })).json!["training"];
      expect(training.optIn, tier).toBe(false);
      expect(training.locked, tier).toBe(planAllows(tier, "complianceMode"));
      expect(training.notice.length).toBeGreaterThan(20);
    }
    await setTier("pro");
    await setTier("growth");
    await setTier("team");
    const locks = (
      await h.call("GET", "/v1/audit?action=plan.training_lock", { token: h.owner.token })
    ).json!["events"] as Json[];
    expect(locks.map((e) => (e["detail"] as Json)["locked"])).toContain(true);
    expect(locks.map((e) => (e["detail"] as Json)["locked"])).toContain(false);
    expect(locks.every((e) => (e["detail"] as Json)["optIn"] === false)).toBe(true);
    await setTier("enterprise");
  });
});
