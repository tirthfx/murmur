import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMPLIANCE_NOTICE } from "./compliance.ts";
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
    ["Cy", "member"],
  ] as const) {
    p[name] = await h.person(name);
    h.server.teams.addMember(team, p[name]!.id, role, null, { actorId: null, via: "test" });
  }
});
afterAll(() => h.close());

const tok = (name: string) => p[name]!.token;
const base = () => `/v1/teams/${team}`;
const mode = (value: unknown, who = "Ada") =>
  h.call("PUT", `${base()}/compliance`, { token: tok(who), body: { mode: value } });
const raw = async () => (await h.call("GET", `${base()}/policy`, { token: tok("Ada") })).json!;
const effective = async () =>
  (await h.call("GET", `${base()}/policy/effective`, { token: tok("Cy") })).json!["policy"];
const eventsOf = async (prefix: string) =>
  (await h.call("GET", `/v1/audit?action=${prefix}`, { token: h.owner.token })).json![
    "events"
  ] as Json[];
const report = (body: unknown, who = "Cy") =>
  h.call("POST", `${base()}/compliance/report`, { token: tok(who), body });

describe("compliance mode", () => {
  it("starts off, says it is not a certification, and is for admins", async () => {
    const view = (await h.call("GET", `${base()}/compliance`, { token: tok("Ada") })).json!;
    expect(view).toMatchObject({
      mode: "none",
      auditViews: false,
      auditDeletions: false,
      notice: COMPLIANCE_NOTICE,
    });
    expect(view["notice"]).toContain("not a certification");
    expect((view["bundles"] as Json[]).map((b) => b["id"])).toEqual(["strict_data", "records"]);
    expect((await mode("strict_data", "Cy")).status).toBe(403);
    expect((await h.call("GET", `${base()}/compliance`, { token: tok("Cy") })).status).toBe(403);
    expect((await mode("hipaa")).json!["error"].code).toBe("invalid_mode");
  });

  it("sets every mapped value in strict_data and marks each one as set by compliance mode", async () => {
    const result = await mode("strict_data");
    expect(result.json).toMatchObject({
      mode: "strict_data",
      auditViews: true,
      auditDeletions: false,
    });
    const layer = await raw();
    expect(layer["values"]).toEqual({
      "retention.audio.max": 7,
      "retention.transcript.max": 365,
      "features.exportToFile": false,
      "features.shareLinksTeam": false,
      "features.shareLinksAnyone": false,
      "features.mcp": false,
      "connectors.readOnly": true,
    });
    expect(
      Object.values(layer["sources"] as Record<string, string>).every(
        (source) => source === "compliance",
      ),
    ).toBe(true);
    expect(Object.keys(layer["sources"])).toHaveLength(7);
    const policy = await effective();
    expect(policy.features).toMatchObject({
      exportToFile: false,
      shareLinksTeam: false,
      shareLinksAnyone: false,
      mcp: false,
      notetaker: true,
    });
    expect(policy).toMatchObject({
      connectorsReadOnly: true,
      retention: { audio: { max: 7 }, transcript: { max: 365 } },
    });
    expect((await eventsOf("compliance.mode_changed"))[0]!["detail"]).toEqual({
      from: "none",
      to: "strict_data",
    });
  });

  it("lets only the owner override one value, and logs the old and the new", async () => {
    const put = (set: unknown, who: { token: string }) =>
      h.call("PUT", `${base()}/policy`, { token: who.token, body: { set } });
    const refused = await put({ "retention.audio.max": 30 }, p["Ada"]!);
    expect(refused.status).toBe(403);
    expect(refused.json!["error"].code).toBe("compliance_locked");
    expect((await raw())["values"]["retention.audio.max"]).toBe(7);

    const allowed = await put({ "retention.audio.max": 30 }, h.owner);
    expect(allowed.status).toBe(200);
    const layer = await raw();
    expect(layer["values"]["retention.audio.max"]).toBe(30);
    // The overridden one is no longer "set by compliance mode"; the others still are.
    expect(layer["sources"]["retention.audio.max"]).toBe("admin");
    expect(layer["sources"]["features.mcp"]).toBe("compliance");
    const override = (await eventsOf("compliance.overridden"))[0]!;
    expect(override["detail"]).toEqual({ setting: "retention.audio.max", from: 7, to: 30 });
    // Clearing a compliance value is an override too.
    expect(
      (
        await h.call("PUT", `${base()}/policy`, {
          token: tok("Ada"),
          body: { unset: ["features.mcp"] },
        })
      ).status,
    ).toBe(403);
    // Values compliance did not set are the admin's to change as usual.
    expect((await put({ "features.scratchpad": false }, p["Ada"]!)).status).toBe(200);
    await h.call("PUT", `${base()}/policy`, {
      token: tok("Ada"),
      body: { unset: ["features.scratchpad"] },
    });
  });

  it("puts the bundle's value back when the mode is set again", async () => {
    await mode("strict_data");
    const layer = await raw();
    expect(layer["values"]["retention.audio.max"]).toBe(7);
    expect(layer["sources"]["retention.audio.max"]).toBe("compliance");
  });

  it("swaps one bundle for another, and clears everything it set when turned off", async () => {
    const records = await mode("records");
    expect(records.json).toMatchObject({
      mode: "records",
      auditViews: false,
      auditDeletions: true,
    });
    const layer = await raw();
    expect(layer["values"]).toEqual({
      "retention.audio.min": 365,
      "retention.transcript.min": 365,
      "deletion.requiresApproval": true,
    });
    expect((await effective())["deletionRequiresApproval"]).toBe(true);
    expect((await effective())["features"].mcp).toBe(true);

    await h.call("PUT", `${base()}/policy`, {
      token: tok("Ada"),
      body: { set: { "features.notetaker": false } },
    });
    expect((await mode("none")).json).toMatchObject({
      mode: "none",
      auditViews: false,
      auditDeletions: false,
    });
    const after = await raw();
    // What the admin set stays; what compliance set is gone.
    expect(after["values"]).toEqual({ "features.notetaker": false });
    await h.call("PUT", `${base()}/policy`, {
      token: tok("Ada"),
      body: { unset: ["features.notetaker"] },
    });
  });
});

describe("reports of views, exports and deletions", () => {
  it("are written only when the mode asks for it, and never with content", async () => {
    await mode("none");
    const off = await report({ event: "meeting_viewed", meetingId: "m-1" });
    expect(off.json).toEqual({ recorded: false });
    expect(await eventsOf("compliance.meeting_viewed")).toHaveLength(0);

    await mode("strict_data");
    expect((await report({ event: "meeting_viewed", meetingId: "m-1" })).json).toEqual({
      recorded: true,
    });
    expect((await report({ event: "export", kind: "meeting-markdown", count: 3 })).json).toEqual({
      recorded: true,
    });
    // Strict data does not audit deletions; records does.
    expect((await report({ event: "deletion", kind: "meeting" })).json).toEqual({
      recorded: false,
    });
    const viewed = (await eventsOf("compliance.meeting_viewed"))[0]!;
    expect(viewed).toMatchObject({ targetId: "m-1", detail: {} });
    expect((await eventsOf("compliance.exported"))[0]!["detail"]).toEqual({
      kind: "meeting-markdown",
      count: 3,
    });

    await mode("records");
    expect((await report({ event: "deletion", kind: "meeting", count: 2 })).json).toEqual({
      recorded: true,
    });
    expect((await eventsOf("compliance.deleted"))[0]!["detail"]).toEqual({
      kind: "meeting",
      count: 2,
    });
    expect((await report({ event: "meeting_viewed", meetingId: "m-2" })).json).toEqual({
      recorded: false,
    });
    await mode("none");
  });

  it("are checked", async () => {
    const code = async (body: unknown) => (await report(body)).json!["error"]?.code;
    expect(await code({ event: "meeting_viewed" })).toBe("invalid_report");
    expect(await code({ event: "meeting_viewed", meetingId: "x".repeat(101) })).toBe(
      "invalid_report",
    );
    expect(await code({ event: "export" })).toBe("invalid_report");
    expect(await code({ event: "export", kind: "k", count: -1 })).toBe("invalid_report");
    expect(await code({ event: "export", kind: "k", count: 1.5 })).toBe("invalid_report");
    expect(await code({ event: "typed_something" })).toBe("invalid_report");
    expect(await code({})).toBe("invalid_report");
    const stranger = await h.person("Stranger");
    expect((await report({ event: "export", kind: "k" }, "Cy")).status).toBe(200);
    expect(
      (
        await h.call("POST", `${base()}/compliance/report`, {
          token: stranger.token,
          body: { event: "export", kind: "k" },
        })
      ).status,
    ).toBe(403);
  });
});
