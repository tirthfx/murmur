import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEV_IDP_ENTITY_ID } from "./dev-idp.ts";
import { DOMAIN_CHECK_MINUTES } from "./identity.ts";
import { runScimSequence } from "./scim-test-client.ts";
import { PASSWORD, startHarness, type Harness, type Json } from "./test-helpers.ts";

const records: Record<string, string[]> = {};
let h: Harness & { owner: { id: string; token: string } };
let team = "";
let sales = "";
const p: Record<string, { id: string; email: string; token: string }> = {};

beforeAll(async () => {
  h = await startHarness({
    devIdp: true,
    resolveTxt: async (name) => (records[name] ?? []).map((value) => [value]),
  });
  team = (await h.call("POST", "/v1/teams", { token: h.owner.token, body: { name: "Acme" } }))
    .json!["id"] as string;
  sales = (
    await h.call("POST", `/v1/teams/${team}/departments`, {
      token: h.owner.token,
      body: { name: "Sales" },
    })
  ).json!["id"] as string;
  const add = async (name: string, role: "admin" | "member") => {
    p[name] = await h.person(name);
    h.server.teams.addMember(team, p[name]!.id, role, null, { actorId: null, via: "test" });
  };
  await add("Ada", "admin");
  await add("Cy", "member");
});
afterAll(() => h.close());

const tok = (name: string) => p[name]!.token;
const base = () => `/v1/teams/${team}`;
const eventsOf = async (prefix: string) =>
  (
    (await h.call("GET", `/v1/audit?action=${prefix}`, { token: h.owner.token })).json![
      "events"
    ] as Json[]
  ).map((event) => event["action"] as string);

async function devMetadata(): Promise<string> {
  const res = await fetch(`${h.base}/dev-idp/metadata`);
  return res.text();
}

describe("labelling: every screen says it is a simulation", () => {
  it("carries the simulation label in every identity response", async () => {
    const xml = await devMetadata();
    const responses: Json[] = [
      (await h.call("GET", `${base()}/identity`, { token: tok("Ada") })).json!,
      (await h.call("GET", `${base()}/identity`, { token: tok("Ada") })).json!["sso"],
      (await h.call("GET", `${base()}/identity`, { token: tok("Ada") })).json!["scim"],
      (await h.call("GET", `${base()}/identity/domains`, { token: tok("Ada") })).json!,
      (
        await h.call("PUT", `${base()}/identity/sso`, {
          token: tok("Ada"),
          body: { metadataXml: xml },
        })
      ).json!,
      (await h.call("POST", `${base()}/identity/sso/test`, { token: tok("Ada") })).json!,
      (await h.call("GET", "/v1/me/capture-offers", { token: tok("Cy") })).json!,
    ];
    for (const response of responses) {
      expect(response["simulation"].label).toBe("Simulation");
      expect(response["simulation"].notice).toContain(
        "does not check anything with a real identity provider",
      );
    }
  });
});

describe("configuring single sign-on", () => {
  const put = (body: unknown, who = "Ada") =>
    h.call("PUT", `${base()}/identity/sso`, { token: tok(who), body });

  it("is for admins", async () => {
    expect((await put({ enabled: false }, "Cy")).status).toBe(403);
    expect((await h.call("GET", `${base()}/identity`, { token: tok("Cy") })).status).toBe(403);
  });

  it("rejects metadata with no signing certificate, with the reason, and saves nothing", async () => {
    const xml = (await devMetadata()).replace(/<ds:X509Data>[\s\S]*?<\/ds:X509Data>/, "");
    const result = await put({ metadataXml: xml });
    expect(result.status).toBe(400);
    expect(result.json!["error"].code).toBe("invalid_metadata");
    expect(result.json!["error"].message).toContain("no signing certificate");
  });

  it("will not turn on without metadata, or require sign-on that is off", async () => {
    const fresh = (
      await h.call("POST", "/v1/teams", { token: h.owner.token, body: { name: "Bare" } })
    ).json!["id"] as string;
    const code = async (body: unknown) =>
      (await h.call("PUT", `/v1/teams/${fresh}/identity/sso`, { token: h.owner.token, body }))
        .json!["error"]?.code;
    expect(await code({ enabled: true })).toBe("not_configured");
    expect(await code({ enforce: true })).toBe("not_enabled");
  });

  it("saves good metadata and shows the address and entity id Murmur would expose", async () => {
    const saved = await put({ metadataXml: await devMetadata(), enabled: true, jitCreate: false });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({
      enabled: true,
      configured: true,
      idp: {
        entityId: DEV_IDP_ENTITY_ID,
        certificate: { subject: "CN=Murmur Test IdP (simulation only)" },
      },
      sp: { entityId: `urn:murmur:team:${team}`, acsUrl: `${h.base}/v1/sso/acs` },
      devIdp: { available: true },
    });
    expect(await eventsOf("identity.sso_changed")).toContain("identity.sso_changed");
  });

  it("reports the structure on Test connection, and says the real provider was not checked", async () => {
    const result = (await h.call("POST", `${base()}/identity/sso/test`, { token: tok("Ada") }))
      .json!;
    expect(result["passed"]).toBe(true);
    const checks = result["checks"] as Json[];
    expect(checks.map((c) => [c["name"], c["ok"]])).toEqual([
      ["metadata", true],
      ["sign-on address", true],
      ["signing certificate", true],
      ["real provider", false],
    ]);
    expect(checks.at(-1)!["message"]).toContain("Not checked");
  });
});

describe("signing in through the simulated identity provider", () => {
  async function signIn(email: string, name = "Someone") {
    const start = await h.call("POST", `${base()}/identity/sso/start`);
    expect(start.status).toBe(200);
    const issued = await h.call("POST", "/dev-idp/authorize", {
      body: { requestId: start.json!["requestId"], email, name },
    });
    expect(issued.status).toBe(200);
    const acs = await h.call("POST", "/v1/sso/acs", {
      body: { samlResponse: issued.json!["samlResponse"] },
    });
    return { start, issued, acs };
  }

  it("goes through redirect, assertion and session for a member, and the session works", async () => {
    const { start, issued, acs } = await signIn(p["Cy"]!.email);
    expect(start.json!["redirectUrl"]).toBe(`${h.base}/dev-idp/authorize`);
    expect(issued.json!["acsUrl"]).toBe(`${h.base}/v1/sso/acs`);
    expect(acs.status).toBe(200);
    expect(acs.json).toMatchObject({
      created: false,
      teamId: team,
      simulation: { label: "Simulation" },
    });
    expect((await h.call("GET", "/v1/me", { token: acs.json!["token"] })).json).toMatchObject({
      email: p["Cy"]!.email,
    });
    expect(await eventsOf("sso.sign_in")).toContain("sso.sign_in");
  });

  it("uses a response once", async () => {
    const { issued } = await signIn(p["Cy"]!.email);
    const again = await h.call("POST", "/v1/sso/acs", {
      body: { samlResponse: issued.json!["samlResponse"] },
    });
    expect(again.status).toBe(401);
    expect(again.json!["error"].code).toBe("replayed");
  });

  it("refuses a response that was changed, one that is not in the format, and one for a request nobody started", async () => {
    const start = await h.call("POST", `${base()}/identity/sso/start`);
    const issued = await h.call("POST", "/dev-idp/authorize", {
      body: { requestId: start.json!["requestId"], email: p["Cy"]!.email, name: "Cy" },
    });
    const decoded = JSON.parse(
      Buffer.from(issued.json!["samlResponse"], "base64url").toString("utf8"),
    );
    decoded.assertion.email = "ada@example.com";
    const forged = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    const result = await h.call("POST", "/v1/sso/acs", { body: { samlResponse: forged } });
    expect(result.json!["error"].code).toBe("invalid_assertion");
    expect(result.json!["error"].message).toContain("signature");
    expect(
      (await h.call("POST", "/v1/sso/acs", { body: { samlResponse: "garbage" } })).json!["error"]
        .code,
    ).toBe("invalid_assertion");
    expect(
      (
        await h.call("POST", "/dev-idp/authorize", {
          body: { requestId: "req_unknown", email: "a@example.com", name: "A" },
        })
      ).status,
    ).toBe(404);
    expect(await eventsOf("sso.rejected")).toContain("sso.rejected");
  });

  it("refuses a sign-in that took too long", async () => {
    const start = await h.call("POST", `${base()}/identity/sso/start`);
    const issued = await h.call("POST", "/dev-idp/authorize", {
      body: { requestId: start.json!["requestId"], email: p["Cy"]!.email, name: "Cy" },
    });
    h.clock.now += 11 * 60_000;
    const late = await h.call("POST", "/v1/sso/acs", {
      body: { samlResponse: issued.json!["samlResponse"] },
    });
    // The assertion itself has run out first (five minutes), which is also a refusal.
    expect(late.status).toBe(401);
    h.clock.now -= 11 * 60_000;
  });

  it("refuses an identity provider that is not the one the team trusts", async () => {
    const other = (await devMetadata()).replace(DEV_IDP_ENTITY_ID, "https://other-idp.example.com");
    await h.call("PUT", `${base()}/identity/sso`, {
      token: tok("Ada"),
      body: { metadataXml: other },
    });
    const { acs } = await signIn(p["Cy"]!.email);
    expect(acs.json!["error"].code).toBe("issuer_mismatch");
    await h.call("PUT", `${base()}/identity/sso`, {
      token: tok("Ada"),
      body: { metadataXml: await devMetadata() },
    });
  });

  it("does not make accounts unless just-in-time creation is on, and does when it is", async () => {
    const off = await signIn("newhire@example.com", "New Hire");
    expect(off.acs.json!["error"].code).toBe("not_provisioned");
    expect(h.server.accounts.findByEmail("newhire@example.com")).toBeNull();

    await h.call("PUT", `${base()}/identity/sso`, { token: tok("Ada"), body: { jitCreate: true } });
    const on = await signIn("newhire@example.com", "New Hire");
    expect(on.acs.json).toMatchObject({ created: true });
    expect(on.acs.json!["user"]).toMatchObject({
      email: "newhire@example.com",
      name: "New Hire",
      isOwner: false,
    });
    expect(h.server.teams.member(team, on.acs.json!["user"].id)).toMatchObject({ role: "member" });
    expect(await eventsOf("sso.jit_created")).toContain("sso.jit_created");
    // The account has a password nobody knows: it can only sign in through SSO.
    expect(
      (
        await h.call("POST", "/v1/sessions", {
          body: { email: "newhire@example.com", password: "guess guess guess" },
        })
      ).status,
    ).toBe(401);
    // Someone with an account who is not in the team is added.
    const outsider = await h.person("Outsider");
    const added = await signIn(outsider.email);
    expect(added.acs.json).toMatchObject({ created: false });
    expect(h.server.teams.member(team, outsider.id)).not.toBeNull();
    await h.call("PUT", `${base()}/identity/sso`, {
      token: tok("Ada"),
      body: { jitCreate: false },
    });
  });

  it("does not sign in an account that was turned off", async () => {
    const off = await h.person("Gone");
    h.server.teams.addMember(team, off.id, "member", null, { actorId: null, via: "test" });
    h.server.accounts.setStatus(off.id, "deactivated");
    expect((await signIn(off.email)).acs.json!["error"].code).toBe("deactivated");
  });

  it("is off when the test identity provider is off", async () => {
    const quiet = await startHarness();
    expect((await fetch(`${quiet.base}/dev-idp/metadata`)).status).toBe(404);
    const made = await quiet.call("POST", "/v1/teams", {
      token: quiet.owner.token,
      body: { name: "Q" },
    });
    const id = made.json!["id"];
    const res = await quiet.call("PUT", `/v1/teams/${id}/identity/sso`, {
      token: quiet.owner.token,
      body: { metadataXml: await devMetadata(), enabled: true },
    });
    expect(res.status).toBe(200);
    const start = await quiet.call("POST", `/v1/teams/${id}/identity/sso/start`);
    expect(start.status).toBe(503);
    expect(start.json!["error"].code).toBe("dev_idp_off");
    await quiet.close();
  });
});

describe("requiring single sign-on", () => {
  it("blocks password sign-in for members and admins, and never for the owner", async () => {
    const password = (email: string) =>
      h.call("POST", "/v1/sessions", { body: { email, password: PASSWORD } });
    expect((await password(p["Cy"]!.email)).status).toBe(200);
    expect(
      (
        await h.call("PUT", `${base()}/identity/sso`, {
          token: tok("Ada"),
          body: { enforce: true },
        })
      ).json,
    ).toMatchObject({ enforce: true });
    const refused = await password(p["Cy"]!.email);
    expect(refused.status).toBe(403);
    expect(refused.json!["error"].code).toBe("sso_required");
    expect((await password(p["Ada"]!.email)).status).toBe(403);
    expect((await password("owner@example.com")).status).toBe(200);
    expect(await eventsOf("auth.password_refused")).toContain("auth.password_refused");
    // Single sign-on still works.
    const start = await h.call("POST", `${base()}/identity/sso/start`);
    const issued = await h.call("POST", "/dev-idp/authorize", {
      body: { requestId: start.json!["requestId"], email: p["Cy"]!.email, name: "Cy" },
    });
    expect(
      (
        await h.call("POST", "/v1/sso/acs", {
          body: { samlResponse: issued.json!["samlResponse"] },
        })
      ).status,
    ).toBe(200);
    // Turning it off gives passwords back.
    await h.call("PUT", `${base()}/identity/sso`, { token: tok("Ada"), body: { enforce: false } });
    expect((await password(p["Cy"]!.email)).status).toBe(200);
  });
});

describe("SCIM", () => {
  let scimToken = "";
  const scim = (method: string, path: string, body?: unknown, token = scimToken) =>
    fetch(`${h.base}/scim/v2${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/scim+json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }).then(async (res) => {
      const raw = await res.text();
      return {
        status: res.status,
        json: raw ? (JSON.parse(raw) as Json) : null,
        type: res.headers.get("content-type") ?? "",
      };
    });
  const patch = (ops: unknown[]) => ({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    Operations: ops,
  });

  it("shows its token once, when SCIM is turned on, and says no real provider calls it", async () => {
    const result = await h.call("PUT", `${base()}/identity/scim`, {
      token: tok("Ada"),
      body: { enabled: true },
    });
    scimToken = result.json!["token"] as string;
    expect(scimToken).toMatch(/^scim_/);
    expect(result.json).toMatchObject({
      enabled: true,
      tokenSet: true,
      simulation: { label: "Simulation" },
    });
    expect(result.json!["note"]).toContain("No real provider");
    const again = await h.call("GET", `${base()}/identity`, { token: tok("Ada") });
    expect(JSON.stringify(again.json)).not.toContain(scimToken);
    expect(JSON.stringify(h.server.db.prepare("SELECT * FROM identity_scim").all())).not.toContain(
      scimToken,
    );
    expect(await eventsOf("identity.scim_changed")).toContain("identity.scim_changed");
  });

  it("answers 401 to a wrong token and changes nothing", async () => {
    const before = (h.server.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number })
      .n;
    for (const token of ["scim_wrong", "", scimToken + "x"]) {
      const res = await scim("POST", "/Users", { userName: "intruder@example.com" }, token);
      expect(res.status, token).toBe(401);
      expect(res.json!["schemas"]).toEqual(["urn:ietf:params:scim:api:messages:2.0:Error"]);
    }
    expect((h.server.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(
      before,
    );
    // A session token is not a SCIM token.
    expect((await scim("GET", "/Users", undefined, tok("Ada"))).status).toBe(401);
  });

  it("runs the standard provider sequence from the test client", async () => {
    const steps = await runScimSequence({ baseUrl: h.base, token: scimToken });
    expect(steps.filter((step) => !step.ok)).toEqual([]);
    expect(steps.map((step) => step.step)).toEqual(
      expect.arrayContaining([
        "create a user",
        "find the user by userName",
        "change the name",
        "turn the user off",
        "delete the group",
      ]),
    );
    expect(await eventsOf("scim.")).toEqual(
      expect.arrayContaining([
        "scim.user_created",
        "scim.user_updated",
        "scim.user_deactivated",
        "scim.group_created",
        "scim.group_deleted",
      ]),
    );
  });

  it("turns a user off: they cannot sign in, and their sessions end", async () => {
    const cy = await h.person("Dana");
    h.server.teams.addMember(team, cy.id, "member", null, { actorId: null, via: "test" });
    expect((await h.call("GET", "/v1/me", { token: cy.token })).status).toBe(200);
    const off = await scim(
      "PATCH",
      `/Users/${cy.id}`,
      patch([{ op: "replace", path: "active", value: false }]),
    );
    expect(off.status).toBe(200);
    expect(off.json!["active"]).toBe(false);
    expect((await h.call("GET", "/v1/me", { token: cy.token })).status).toBe(401);
    const signIn = await h.call("POST", "/v1/sessions", {
      body: { email: cy.email, password: PASSWORD },
    });
    expect(signIn.status).toBe(403);
    expect(signIn.json!["error"].code).toBe("deactivated");
    // Nothing was deleted, and it can be turned back on.
    expect(h.server.accounts.findById(cy.id)).not.toBeNull();
    await scim("PATCH", `/Users/${cy.id}`, patch([{ op: "replace", value: { active: true } }]));
    expect(
      (await h.call("POST", "/v1/sessions", { body: { email: cy.email, password: PASSWORD } }))
        .status,
    ).toBe(200);
    expect(await eventsOf("scim.user_reactivated")).toContain("scim.user_reactivated");
  });

  it("creates, reads, replaces and filters users, in the SCIM shape", async () => {
    const created = await scim("POST", "/Users", {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: "Rae@Example.com",
      externalId: "okta-1",
      name: { givenName: "Rae", familyName: "Ray" },
    });
    expect(created.status).toBe(201);
    expect(created.type).toContain("application/scim+json");
    expect(created.json).toMatchObject({
      userName: "rae@example.com",
      externalId: "okta-1",
      active: true,
      displayName: "Rae Ray",
      emails: [{ value: "rae@example.com", primary: true }],
      meta: { resourceType: "User" },
    });
    const id = created.json!["id"] as string;
    expect(h.server.teams.member(team, id)).toMatchObject({ role: "member" });
    expect((await scim("POST", "/Users", { userName: "rae@example.com" })).json!["scimType"]).toBe(
      "uniqueness",
    );
    expect((await scim("POST", "/Users", { name: { givenName: "x" } })).status).toBe(400);

    const byName = await scim(
      "GET",
      `/Users?filter=${encodeURIComponent('userName eq "RAE@example.com"')}`,
    );
    expect(byName.json).toMatchObject({ totalResults: 1, startIndex: 1, itemsPerPage: 1 });
    const byExternal = await scim(
      "GET",
      `/Users?filter=${encodeURIComponent('externalId eq "okta-1"')}`,
    );
    expect((byExternal.json!["Resources"] as Json[])[0]!["id"]).toBe(id);
    const unsupported = await scim(
      "GET",
      `/Users?filter=${encodeURIComponent('name.givenName sw "R"')}`,
    );
    expect(unsupported.status).toBe(400);
    expect(unsupported.json!["scimType"]).toBe("invalidFilter");
    expect(
      ((await scim("GET", "/Users?count=2&startIndex=1")).json!["Resources"] as Json[]).length,
    ).toBe(2);

    const replaced = await scim("PUT", `/Users/${id}`, {
      userName: "rae@example.com",
      name: { formatted: "Rae R. Ray" },
      externalId: "okta-2",
    });
    expect(replaced.json).toMatchObject({ displayName: "Rae R. Ray", externalId: "okta-2" });
    expect(
      (
        await scim(
          "PATCH",
          `/Users/${id}`,
          patch([{ op: "replace", path: "nickName", value: "x" }]),
        )
      ).json!["scimType"],
    ).toBe("invalidPath");
    expect(
      (await scim("PATCH", `/Users/${id}`, patch([{ op: "remove", path: "name" }]))).status,
    ).toBe(400);
    expect((await scim("PATCH", `/Users/${id}`, { Operations: [] })).status).toBe(400);
    expect((await scim("DELETE", `/Users/${id}`)).status).toBe(204);
    expect((await scim("GET", `/Users/${id}`)).json).toMatchObject({ active: false });
  });

  it("does not show or change anyone outside the team, and never the owner", async () => {
    const stranger = await h.person("Stranger");
    expect((await scim("GET", `/Users/${stranger.id}`)).status).toBe(404);
    expect(
      (
        await scim(
          "PATCH",
          `/Users/${stranger.id}`,
          patch([{ op: "replace", path: "active", value: false }]),
        )
      ).status,
    ).toBe(404);
    const owner = await scim(
      "PATCH",
      `/Users/${h.owner.id}`,
      patch([{ op: "replace", path: "active", value: false }]),
    );
    expect(owner.status).toBe(403);
    expect(owner.json!["scimType"]).toBe("mutability");
    expect((await scim("DELETE", `/Users/${h.owner.id}`)).status).toBe(403);
    expect((await h.call("GET", "/v1/me", { token: h.owner.token })).status).toBe(200);
  });

  it("maps a group to a department or a role when someone joins or leaves it", async () => {
    expect(
      (
        await h.call("PUT", `${base()}/identity/scim`, {
          token: tok("Ada"),
          body: {
            groupMap: [
              { group: "Sales", departmentId: sales },
              { group: "Admins", role: "admin" },
            ],
          },
        })
      ).status,
    ).toBe(200);
    const user = await h.person("Mia");
    h.server.teams.addMember(team, user.id, "member", null, { actorId: null, via: "test" });

    const sg = await scim("POST", "/Groups", {
      displayName: "Sales",
      members: [{ value: user.id }],
    });
    expect(sg.status).toBe(201);
    expect(h.server.teams.member(team, user.id)).toMatchObject({ department_id: sales });
    const ag = await scim("POST", "/Groups", { displayName: "Admins" });
    await scim(
      "PATCH",
      `/Groups/${ag.json!["id"]}`,
      patch([{ op: "add", path: "members", value: [{ value: user.id }] }]),
    );
    expect(h.server.teams.member(team, user.id)).toMatchObject({ role: "admin" });
    await scim(
      "PATCH",
      `/Groups/${ag.json!["id"]}`,
      patch([{ op: "remove", path: `members[value eq "${user.id}"]` }]),
    );
    expect(h.server.teams.member(team, user.id)).toMatchObject({ role: "member" });
    await scim("PUT", `/Groups/${sg.json!["id"]}`, { displayName: "Sales", members: [] });
    expect(h.server.teams.member(team, user.id)).toMatchObject({ department_id: null });
    expect(
      (
        (await scim("GET", `/Groups?filter=${encodeURIComponent('displayName eq "admins"')}`))
          .json!["Resources"] as Json[]
      ).length,
    ).toBe(1);
    expect((await scim("POST", "/Groups", { displayName: "Sales" })).json!["scimType"]).toBe(
      "uniqueness",
    );
    expect(
      (await scim("POST", "/Groups", { displayName: "X", members: [{ value: "nobody" }] })).status,
    ).toBe(404);
    // The owner's role is never changed by a mapping.
    await scim(
      "PATCH",
      `/Groups/${ag.json!["id"]}`,
      patch([{ op: "add", path: "members", value: [{ value: h.owner.id }] }]),
    );
    expect(h.server.teams.member(team, h.owner.id)).toMatchObject({ role: "owner" });
    expect((await scim("DELETE", `/Groups/${ag.json!["id"]}`)).status).toBe(204);
  });

  it("checks the group map when it is saved", async () => {
    const put = (groupMap: unknown) =>
      h.call("PUT", `${base()}/identity/scim`, { token: tok("Ada"), body: { groupMap } });
    expect((await put("nope")).json!["error"].code).toBe("invalid_group_map");
    expect((await put([{ group: "", role: "admin" }])).status).toBe(400);
    expect((await put([{ group: "A" }])).status).toBe(400);
    expect((await put([{ group: "A", role: "admin", departmentId: sales }])).status).toBe(400);
    expect((await put([{ group: "A", role: "owner" }])).status).toBe(400);
    expect((await put([{ group: "A", departmentId: "nope" }])).status).toBe(400);
  });

  it("stops the old token when a new one is made, and stops all of them when SCIM is turned off", async () => {
    const rotated = await h.call("POST", `${base()}/identity/scim/token`, { token: tok("Ada") });
    const next = rotated.json!["token"] as string;
    expect((await scim("GET", "/Users", undefined, scimToken)).status).toBe(401);
    expect((await scim("GET", "/Users", undefined, next)).status).toBe(200);
    await h.call("PUT", `${base()}/identity/scim`, { token: tok("Ada"), body: { enabled: false } });
    expect((await scim("GET", "/Users", undefined, next)).status).toBe(401);
    expect(
      (await h.call("POST", `${base()}/identity/scim/token`, { token: tok("Cy") })).status,
    ).toBe(403);
  });
});

describe("domains and capture", () => {
  let acme = "";
  let other = "";
  const domain = (id: string, who = "Ada") =>
    h.call("POST", `${base()}/identity/domains/${id}/verify`, { token: tok(who) });

  it("lists a domain with the record to put in DNS, normalised, once", async () => {
    const add = (body: unknown) =>
      h.call("POST", `${base()}/identity/domains`, { token: tok("Ada"), body });
    const made = await add({ domain: "https://www.Acme.Test/path", defaultRole: "viewer" });
    expect(made.status).toBe(201);
    acme = made.json!["id"] as string;
    expect(made.json).toMatchObject({
      domain: "acme.test",
      verified: false,
      defaultRole: "viewer",
      record: { name: "_murmur-challenge.acme.test", type: "TXT" },
    });
    expect(made.json!["record"].value).toMatch(/^murmur-verify=[0-9a-f]{32}$/);
    expect((await add({ domain: "acme.test" })).json!["error"].code).toBe("domain_exists");
    expect((await add({ domain: "not a domain" })).json!["error"].code).toBe("invalid_domain");
    expect((await add({ domain: "localhost" })).json!["error"].code).toBe("invalid_domain");
    expect((await add({ domain: "ok.test", defaultRole: "owner" })).json!["error"].code).toBe(
      "invalid_role",
    );
    expect(
      (
        await h.call("POST", `${base()}/identity/domains`, {
          token: tok("Cy"),
          body: { domain: "x.test" },
        })
      ).status,
    ).toBe(403);
  });

  it("stays unverified without the TXT record, and cannot be used for join or capture", async () => {
    const result = await domain(acme);
    expect(result.status).toBe(422);
    expect(result.json!["error"].code).toBe("not_verified");
    expect(
      (
        await h.call("PATCH", `${base()}/identity/domains/${acme}`, {
          token: tok("Ada"),
          body: { capture: true },
        })
      ).json!["error"].code,
    ).toBe("not_verified");
    const user = await h.person("Alex");
    const join = await h.call("POST", `${base()}/domain-join`, { token: user.token });
    expect(join.status).toBe(403);
  });

  it("looks at DNS at most once in ten minutes", async () => {
    const soon = await domain(acme);
    expect(soon.status).toBe(429);
    expect(soon.json!["error"].retryAfterSeconds).toBeGreaterThan(0);
    h.clock.now += DOMAIN_CHECK_MINUTES * 60_000 + 1000;
    // Sessions last a month, so the tokens still work.
    expect((await domain(acme)).status).toBe(422);
  });

  it("is verified when the record is there", async () => {
    const record = (await h.call("GET", `${base()}/identity/domains`, { token: tok("Ada") })).json![
      "domains"
    ][0].record;
    records[record.name] = ["unrelated", record.value];
    h.clock.now += DOMAIN_CHECK_MINUTES * 60_000 + 1000;
    const verified = await domain(acme);
    expect(verified.status).toBe(200);
    expect(verified.json).toMatchObject({ verified: true });
    expect(await eventsOf("domain.")).toEqual(
      expect.arrayContaining(["domain.added", "domain.verify_failed", "domain.verified"]),
    );
    // Asking again is harmless.
    expect((await domain(acme)).status).toBe(200);
  });

  it("is not verified for a second team, which would be a claim on the first's domain", async () => {
    const second = (
      await h.call("POST", "/v1/teams", { token: h.owner.token, body: { name: "Copy" } })
    ).json!["id"] as string;
    const made = await h.call("POST", `/v1/teams/${second}/identity/domains`, {
      token: h.owner.token,
      body: { domain: "acme.test" },
    });
    other = made.json!["id"] as string;
    records[made.json!["record"].name] = [made.json!["record"].value];
    const result = await h.call("POST", `/v1/teams/${second}/identity/domains/${other}/verify`, {
      token: h.owner.token,
    });
    expect(result.status).toBe(409);
    expect(result.json!["error"].code).toBe("domain_taken");
  });

  it("lets someone with an address in the domain ask to join without an invite", async () => {
    const alex = h.server.accounts.createAccount(
      { name: "Alex", email: "alex@acme.test", password: PASSWORD },
      h.owner.id,
    );
    if (!alex.ok) throw new Error("account");
    const token = (
      h.server.accounts.signIn("alex@acme.test", PASSWORD) as {
        ok: true;
        session: { token: string };
      }
    ).session.token;
    const join = await h.call("POST", `${base()}/domain-join`, { token });
    expect(join.status).toBe(202);
    expect(join.json!["role"]).toBe("viewer");
    expect((await h.call("POST", `${base()}/domain-join`, { token })).json!["error"].code).toBe(
      "request_pending",
    );
    const pending = (
      await h.call("GET", `${base()}/requests?status=pending`, { token: tok("Ada") })
    ).json!["requests"] as Json[];
    const request = pending.find((r) => r["userId"] === alex.user.id)!;
    expect(request).toMatchObject({ role: "viewer" });
    expect(
      (await h.call("POST", `${base()}/requests/${request["id"]}/approve`, { token: tok("Ada") }))
        .status,
    ).toBe(200);
    expect(h.server.teams.member(team, alex.user.id)).toMatchObject({ role: "viewer" });
    expect((await h.call("POST", `${base()}/domain-join`, { token })).json!["error"].code).toBe(
      "already_member",
    );
    // Someone with another address is refused.
    expect((await h.call("POST", `${base()}/domain-join`, { token: tok("Cy") })).status).toBe(403);
  });

  it("offers a personal account to join, and leaves it alone if they decline", async () => {
    await h.call("PATCH", `${base()}/identity/domains/${acme}`, {
      token: tok("Ada"),
      body: { capture: true, defaultRole: "member" },
    });
    const made = h.server.accounts.createAccount(
      { name: "Bo", email: "bo@acme.test", password: PASSWORD },
      h.owner.id,
    );
    if (!made.ok) throw new Error("account");
    const bo = (
      h.server.accounts.signIn("bo@acme.test", PASSWORD) as { ok: true; session: { token: string } }
    ).session.token;
    const offers = (await h.call("GET", "/v1/me/capture-offers", { token: bo })).json![
      "offers"
    ] as Json[];
    expect(offers).toEqual([
      { teamId: team, teamName: "Acme", domain: "acme.test", role: "member" },
    ]);
    // Nothing moves by itself.
    expect(h.server.teams.member(team, made.user.id)).toBeNull();
    expect((await h.call("POST", `${base()}/capture/decline`, { token: bo })).status).toBe(204);
    expect(h.server.teams.member(team, made.user.id)).toBeNull();
    expect(
      (await h.call("GET", "/v1/me/capture-offers", { token: bo })).json!["offers"] as Json[],
    ).toEqual([]);
    expect((await h.call("POST", `${base()}/capture/accept`, { token: bo })).status).toBe(404);
    // Another person with the address is offered it and says yes.
    const cai = h.server.accounts.createAccount(
      { name: "Cai", email: "cai@acme.test", password: PASSWORD },
      h.owner.id,
    );
    if (!cai.ok) throw new Error("account");
    const caiToken = (
      h.server.accounts.signIn("cai@acme.test", PASSWORD) as {
        ok: true;
        session: { token: string };
      }
    ).session.token;
    expect((await h.call("POST", `${base()}/capture/accept`, { token: caiToken })).json).toEqual({
      role: "member",
    });
    expect(h.server.teams.member(team, cai.user.id)).toMatchObject({ role: "member" });
    expect(await eventsOf("domain.")).toEqual(
      expect.arrayContaining(["domain.capture_accepted", "domain.capture_declined"]),
    );
    // Someone with another domain is offered nothing.
    expect(
      (await h.call("GET", "/v1/me/capture-offers", { token: tok("Cy") })).json![
        "offers"
      ] as Json[],
    ).toEqual([]);
  });

  it("limits sign-ups to the verified domain when asked: by invite and by single sign-on", async () => {
    await h.call("PATCH", `${base()}/identity/domains/${acme}`, {
      token: tok("Ada"),
      body: { restrictSignup: true },
    });
    const invite = async () =>
      (
        await h.call("POST", `${base()}/invites`, {
          token: tok("Ada"),
          body: { approvalRequired: false, role: "viewer", maxUses: 5 },
        })
      ).json!["code"] as string;
    const redeem = (code: string, email: string) =>
      h.call("POST", "/v1/invites/redeem", {
        body: { code, name: "N", email, password: PASSWORD },
      });
    expect((await redeem(await invite(), "someone@elsewhere.test")).json!["error"].code).toBe(
      "domain_not_allowed",
    );
    expect((await redeem(await invite(), "someone@acme.test")).status).toBe(201);
    // Subdomains are not the domain.
    expect((await redeem(await invite(), "x@sub.acme.test")).status).toBe(403);

    await h.call("PUT", `${base()}/identity/sso`, { token: tok("Ada"), body: { jitCreate: true } });
    const start = await h.call("POST", `${base()}/identity/sso/start`);
    const issued = await h.call("POST", "/dev-idp/authorize", {
      body: { requestId: start.json!["requestId"], email: "hire@elsewhere.test", name: "H" },
    });
    expect(
      (
        await h.call("POST", "/v1/sso/acs", {
          body: { samlResponse: issued.json!["samlResponse"] },
        })
      ).json!["error"].code,
    ).toBe("domain_not_allowed");
    const start2 = await h.call("POST", `${base()}/identity/sso/start`);
    const issued2 = await h.call("POST", "/dev-idp/authorize", {
      body: { requestId: start2.json!["requestId"], email: "hire@acme.test", name: "H" },
    });
    const ok = await h.call("POST", "/v1/sso/acs", {
      body: { samlResponse: issued2.json!["samlResponse"] },
    });
    expect(ok.status).toBe(200);
    // The domain's default role is the role they get.
    expect(h.server.teams.member(team, ok.json!["user"].id)).toMatchObject({ role: "member" });
  });

  it("can be removed", async () => {
    expect(
      (await h.call("DELETE", `${base()}/identity/domains/${acme}`, { token: tok("Ada") })).status,
    ).toBe(204);
    expect(
      (await h.call("DELETE", `${base()}/identity/domains/${acme}`, { token: tok("Ada") })).status,
    ).toBe(404);
  });
});
