import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness, type Json } from "./test-helpers.ts";

let h: Harness & { owner: { id: string; token: string } };
let team = "";
let sales = "";
let support = "";
const p: Record<string, { id: string; token: string }> = {};

beforeAll(async () => {
  h = await startHarness();
  team = (await h.call("POST", "/v1/teams", { token: h.owner.token, body: { name: "Acme" } }))
    .json!["id"] as string;
  const dept = async (name: string) =>
    (
      await h.call("POST", `/v1/teams/${team}/departments`, {
        token: h.owner.token,
        body: { name },
      })
    ).json!["id"] as string;
  sales = await dept("Sales");
  support = await dept("Support");
  const add = async (
    name: string,
    role: "admin" | "manager" | "member" | "viewer",
    department: string | null,
  ) => {
    p[name] = await h.person(name);
    h.server.teams.addMember(team, p[name]!.id, role, department, { actorId: null, via: "test" });
  };
  await add("Ada", "admin", null);
  await add("Cy", "member", sales);
  await add("Dee", "member", support);
  await add("Fay", "member", null);
});
afterAll(() => h.close());

const tok = (name: string) => p[name]!.token;
const put = (body: unknown, who = "Ada") =>
  h.call("PUT", `/v1/teams/${team}/policy`, { token: tok(who), body });
const effective = async (who: string) =>
  (await h.call("GET", `/v1/teams/${team}/policy/effective`, { token: tok(who) })).json!;
const eventsOf = async (prefix: string) =>
  (await h.call("GET", `/v1/audit?action=${prefix}`, { token: h.owner.token })).json![
    "events"
  ] as Json[];

describe("what a person's app downloads", () => {
  it("is an open policy when nothing is set", async () => {
    const result = await effective("Cy");
    expect(result["policy"]).toMatchObject({
      blockedApps: [],
      appliesTo: "dictation",
      connectorsDisabled: [],
      blockedDomains: [],
      adminContact: "",
      retention: { audio: { max: null, min: null }, transcript: { max: null, min: null } },
    });
    expect(Object.values(result["policy"].features).every((on) => on === true)).toBe(true);
    expect(result["pollMinutes"]).toBe(5);
    expect(result["revision"]).toBe(0);
  });

  it("is refused to someone who is not in the team", async () => {
    const eve = await h.person("Eve");
    expect(
      (await h.call("GET", `/v1/teams/${team}/policy/effective`, { token: eve.token })).status,
    ).toBe(403);
  });
});

describe("setting policy", () => {
  it("is for admins: a Member's direct call is refused, and nothing changes", async () => {
    expect((await put({ set: { "features.mcp": false } }, "Cy")).status).toBe(403);
    expect((await h.call("GET", `/v1/teams/${team}/policy`, { token: tok("Cy") })).status).toBe(
      403,
    );
    expect((await effective("Cy"))["policy"].features.mcp).toBe(true);
  });

  it("applies team values to everyone, and moves the revision", async () => {
    const before = (await effective("Cy"))["revision"] as number;
    const result = await put({
      set: {
        "features.notetaker": false,
        blockedApps: [{ bundleId: "com.apple.Notes", name: "Notes" }],
        "blockedApps.appliesTo": "dictation_and_notetaker",
        blockedDomains: ["HTTPS://Example.com/path"],
        "retention.audio.max": 90,
        "retention.audio.min": 7,
        "retention.transcript.max": 365,
        adminContact: "it@acme.test",
      },
    });
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ scope: "team", changed: 8 });
    for (const who of ["Cy", "Dee", "Fay"]) {
      const policy = (await effective(who))["policy"];
      expect(policy.features.notetaker, who).toBe(false);
      expect(policy.blockedApps, who).toEqual([{ bundleId: "com.apple.Notes", name: "Notes" }]);
      expect(policy.appliesTo).toBe("dictation_and_notetaker");
      expect(policy.blockedDomains).toEqual(["example.com"]);
      expect(policy.retention.audio).toEqual({ max: 90, min: 7 });
      expect(policy.retention.transcript).toEqual({ max: 365, min: null });
      expect(policy.adminContact).toBe("it@acme.test");
    }
    expect((await effective("Cy"))["revision"]).toBeGreaterThan(before);
  });

  it("does not let a department turn on a feature the team turned off", async () => {
    await put({
      scope: "department",
      scopeId: sales,
      set: { "features.notetaker": true, "features.mcp": false },
    });
    const sales1 = (await effective("Cy"))["policy"];
    expect(sales1.features.notetaker).toBe(false);
    expect(sales1.features.mcp).toBe(false);
    // The other department is not touched by Sales' own setting.
    expect((await effective("Dee"))["policy"].features.mcp).toBe(true);
    expect((await effective("Fay"))["policy"].features.mcp).toBe(true);
  });

  it("adds a department's blocks and takes the strictest retention", async () => {
    await put({
      scope: "department",
      scopeId: support,
      set: {
        blockedApps: [{ bundleId: "com.slack.Slack" }, { bundleId: "COM.APPLE.NOTES" }],
        blockedDomains: ["social.example.org", "example.com"],
        "retention.audio.max": 30,
        "connectors.disabled": ["slack"],
      },
    });
    const policy = (await effective("Dee"))["policy"];
    expect(policy.blockedApps.map((app: Json) => app["bundleId"])).toEqual([
      "com.apple.Notes",
      "com.slack.Slack",
    ]);
    expect(policy.blockedDomains).toEqual(["example.com", "social.example.org"]);
    expect(policy.retention.audio).toEqual({ max: 30, min: 7 });
    expect(policy.connectorsDisabled).toEqual(["slack"]);
    expect((await effective("Cy"))["policy"].retention.audio.max).toBe(90);
  });

  it("holds a member's own override on top", async () => {
    await put({ scope: "member", scopeId: p["Fay"]!.id, set: { "features.scratchpad": false } });
    expect((await effective("Fay"))["policy"].features.scratchpad).toBe(false);
    expect((await effective("Cy"))["policy"].features.scratchpad).toBe(true);
  });

  it("clears a setting and goes back to what is above it", async () => {
    await put({ scope: "member", scopeId: p["Fay"]!.id, unset: ["features.scratchpad"] });
    expect((await effective("Fay"))["policy"].features.scratchpad).toBe(true);
    // Clearing a setting that is not there changes nothing and writes nothing.
    const before = (await effective("Fay"))["revision"];
    expect(
      (await put({ scope: "member", scopeId: p["Fay"]!.id, unset: ["features.scratchpad"] })).json,
    ).toMatchObject({ changed: 0 });
    expect((await effective("Fay"))["revision"]).toBe(before);
  });

  it("shows an admin what is set in one layer", async () => {
    const layer = (
      await h.call("GET", `/v1/teams/${team}/policy?scope=department&scopeId=${support}`, {
        token: tok("Ada"),
      })
    ).json!;
    expect(layer).toMatchObject({
      scope: "department",
      values: { "retention.audio.max": 30 },
      sources: { "retention.audio.max": "admin" },
    });
    expect(
      (await h.call("GET", `/v1/teams/${team}/policy`, { token: tok("Ada") })).json!["values"][
        "adminContact"
      ],
    ).toBe("it@acme.test");
  });
});

describe("what is refused", () => {
  it("unknown settings, wrong values and wrong places", async () => {
    const code = async (body: unknown) => (await put(body)).json!["error"]?.code;
    expect(await code({ set: { "features.teleport": true } })).toBe("unknown_setting");
    expect(await code({ unset: ["nope"] })).toBe("unknown_setting");
    expect(await code({ set: { "features.mcp": "no" } })).toBe("invalid_policy");
    expect(await code({ set: { "retention.audio.max": 0 } })).toBe("invalid_policy");
    expect(await code({ set: { blockedDomains: ["not a domain"] } })).toBe("invalid_policy");
    expect(await code({ set: { blockedApps: [{ bundleId: "" }] } })).toBe("invalid_policy");
    expect(await code({ set: {} })).toBe("invalid_policy");
    expect(await code({ set: [] })).toBe("invalid_policy");
    expect(await code({ unset: "features.mcp" })).toBe("invalid_policy");
    expect(await code({ scope: "galaxy", set: { "features.mcp": false } })).toBe("invalid_scope");
    expect(await code({ scope: "department", set: { "features.mcp": false } })).toBe(
      "invalid_scope",
    );
    expect(
      await code({ scope: "department", scopeId: "nope", set: { "features.mcp": false } }),
    ).toBe("not_found");
    expect(await code({ scope: "member", scopeId: "nobody", set: { "features.mcp": false } })).toBe(
      "not_found",
    );
    expect(await code({ scope: "department", scopeId: sales, set: { adminContact: "x" } })).toBe(
      "invalid_policy",
    );
  });

  it("a minimum above the maximum in one layer", async () => {
    const result = await put({
      scope: "member",
      scopeId: p["Cy"]!.id,
      set: { "retention.transcript.max": 30, "retention.transcript.min": 60 },
    });
    expect(result.status).toBe(400);
    expect(result.json!["error"].message).toContain("minimum");
    // And across layers the minimum is brought down to the maximum rather than refused.
    await put({ scope: "department", scopeId: sales, set: { "retention.audio.min": 200 } });
    expect((await effective("Cy"))["policy"].retention.audio).toEqual({ max: 90, min: 90 });
    await put({ scope: "department", scopeId: sales, unset: ["retention.audio.min"] });
  });

  it("a webhook address that a team blocks", async () => {
    const blocked = await h.call("PUT", "/v1/audit/settings", {
      token: h.owner.token,
      body: { siemMode: "webhook", siemWebhookUrl: "http://siem.example.com/hook" },
    });
    expect(blocked.json!["error"].code).toBe("blocked_by_policy");
    expect(h.server.policy.hostBlockedAnywhere("http://sub.example.com")).toBe(true);
    expect(h.server.policy.hostBlockedAnywhere("http://127.0.0.1:9000")).toBe(false);
  });
});

describe("the audit log", () => {
  it("has an entry for each setting changed, with the old and new value and no list contents", async () => {
    const events = await eventsOf("policy.changed");
    expect(events.length).toBeGreaterThanOrEqual(12);
    const notetaker = events.find(
      (e) => e["detail"].setting === "features.notetaker" && e["detail"].scope === "team",
    )!;
    expect(notetaker["detail"]).toMatchObject({ from: "unset", to: false, source: "admin" });
    const apps = events.find(
      (e) => e["detail"].setting === "blockedApps" && e["detail"].scope === "team",
    )!;
    expect(apps["detail"]).toMatchObject({ from: "unset", to: "1 items" });
    const cleared = events.find(
      (e) => e["detail"].setting === "features.scratchpad" && e["detail"].to === "unset",
    )!;
    expect(cleared["detail"].from).toBe(false);
    const log = (await h.call("GET", "/v1/audit/export", { token: h.owner.token })).raw;
    for (const text of [
      "com.apple.Notes",
      "com.slack.Slack",
      "example.com",
      "it@acme.test",
      "social.example.org",
    ])
      expect(log).not.toContain(text);
  });

  it("records only counts when an app reports that it applied a retention limit", async () => {
    const report = (body: unknown, who = "Cy") =>
      h.call("POST", `/v1/teams/${team}/policy/report`, { token: tok(who), body });
    expect((await report({ event: "retention_applied", audio: 12, transcripts: 3 })).status).toBe(
      204,
    );
    expect((await report({ event: "retention_applied" })).status).toBe(204);
    expect((await report({ event: "other" })).status).toBe(400);
    expect((await report({ event: "retention_applied", audio: -1 })).status).toBe(400);
    expect((await report({ event: "retention_applied", audio: "many" })).status).toBe(400);
    const event = (await eventsOf("policy.retention_applied"))[0]!;
    expect(event["detail"]).toEqual({ recordings: 0, meetings: 0 });
    expect(
      (await eventsOf("policy.retention_applied")).some(
        (e) => e["detail"].recordings === 12 && e["detail"].meetings === 3,
      ),
    ).toBe(true);
  });
});
