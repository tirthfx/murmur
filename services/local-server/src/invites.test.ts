import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVITE_DEFAULTS, REQUEST_DAYS } from "./invites.ts";
import { PASSWORD, startHarness, type Harness, type Json } from "./test-helpers.ts";

let h: Harness & { owner: { id: string; token: string } };
let team = "";
let sales = "";
const people: Record<string, { id: string; email: string; token: string }> = {};

beforeAll(async () => {
  h = await startHarness();
  team = (await h.call("POST", "/v1/teams", { token: h.owner.token, body: { name: "Acme" } }))
    .json!["id"] as string;
  sales = (
    await h.call("POST", `/v1/teams/${team}/departments`, {
      token: h.owner.token,
      body: { name: "Sales" },
    })
  ).json!["id"] as string;
  for (const name of ["Ada", "Bea", "Cy", "Dee"]) people[name] = await h.person(name);
  h.server.teams.addMember(team, people["Ada"]!.id, "admin", null, { actorId: null, via: "test" });
  h.server.teams.addMember(team, people["Bea"]!.id, "manager", null, {
    actorId: null,
    via: "test",
  });
});
afterAll(() => h.close());

const as = (name: string) => people[name]!.token;
const invite = (body: unknown = {}, token = h.owner.token) =>
  h.call("POST", `/v1/teams/${team}/invites`, { token, body });
const redeem = (body: unknown, token: string | null = null) =>
  h.call("POST", "/v1/invites/redeem", { token, body });
const eventsOf = async (prefix: string) =>
  (
    (await h.call("GET", `/v1/audit?action=${prefix}`, { token: h.owner.token })).json![
      "events"
    ] as Json[]
  ).map((event) => event["action"] as string);

describe("making an invite", () => {
  it("uses the defaults: a Member, 7 days, one use, approval required", async () => {
    const made = await invite({}, as("Ada"));
    expect(made.status).toBe(201);
    expect(made.json!["code"]).toMatch(/^inv_/);
    expect(made.json!["link"]).toContain(`/join?code=${made.json!["code"]}`);
    expect(made.json!["invite"]).toMatchObject({
      role: "member",
      maxUses: INVITE_DEFAULTS.maxUses,
      approvalRequired: INVITE_DEFAULTS.approvalRequired,
      uses: 0,
      state: "active",
    });
    const span = made.json!["invite"].expiresAt - made.json!["invite"].createdAt;
    expect(span).toBe(INVITE_DEFAULTS.expiryDays * 86_400_000);
  });

  it("keeps only the hash of the code, and never lists it", async () => {
    const made = await invite({}, as("Ada"));
    const code = made.json!["code"] as string;
    const rows = h.server.db.prepare("SELECT code_hash FROM invites").all() as {
      code_hash: string;
    }[];
    expect(
      rows.some((row) => row.code_hash === createHash("sha256").update(code).digest("hex")),
    ).toBe(true);
    expect(JSON.stringify(h.server.db.prepare("SELECT * FROM invites").all())).not.toContain(code);
    const listed = await h.call("GET", `/v1/teams/${team}/invites`, { token: as("Ada") });
    expect(listed.json!["invites"].length).toBeGreaterThan(0);
    expect(listed.raw).not.toContain(code);
    expect(listed.raw).not.toContain("code_hash");
    const log = (await h.call("GET", "/v1/audit/export", { token: h.owner.token })).raw;
    expect(log).not.toContain(code);
  });

  it("gives a role below the maker's, in a department of the same team", async () => {
    expect((await invite({ role: "admin" }, as("Ada"))).status).toBe(403);
    expect((await invite({ role: "manager" }, as("Ada"))).status).toBe(201);
    expect((await invite({ role: "admin" })).status).toBe(201);
    expect((await invite({ role: "owner" })).status).toBe(400);
    expect((await invite({ role: "boss" })).status).toBe(400);
    expect((await invite({ departmentId: sales })).json!["invite"].departmentId).toBe(sales);
    expect((await invite({ departmentId: "not-a-department" })).status).toBe(400);
    // A Manager cannot make invites at all.
    expect((await invite({}, as("Bea"))).status).toBe(403);
  });

  it("limits the expiry and the number of uses", async () => {
    expect((await invite({ expiresInDays: 0 })).status).toBe(400);
    expect((await invite({ expiresInDays: 91 })).status).toBe(400);
    expect((await invite({ maxUses: 0 })).status).toBe(400);
    expect((await invite({ maxUses: 1001 })).status).toBe(400);
    expect((await invite({ expiresInDays: 1.5 })).status).toBe(400);
    expect((await invite({ expiresInDays: 30, maxUses: 5 })).status).toBe(201);
  });

  it("reads its defaults from the server settings", async () => {
    h.server.db
      .prepare(
        "INSERT INTO server_settings (key, value_json, updated_at) VALUES (?, ?, 0), (?, ?, 0), (?, ?, 0)",
      )
      .run(
        "team.invite.expiryDays",
        "3",
        "team.invite.maxUses",
        "4",
        "team.invite.approvalRequired",
        "false",
      );
    const made = await invite({});
    expect(made.json!["invite"]).toMatchObject({ maxUses: 4, approvalRequired: false });
    expect(made.json!["invite"].expiresAt - made.json!["invite"].createdAt).toBe(3 * 86_400_000);
    h.server.db.prepare("DELETE FROM server_settings WHERE key LIKE 'team.invite.%'").run();
  });
});

describe("redeeming", () => {
  it("joins a signed-in person straight away when no approval is needed", async () => {
    const made = await invite({ approvalRequired: false, role: "viewer", departmentId: sales });
    const result = await redeem({ code: made.json!["code"] }, as("Cy"));
    expect(result.status).toBe(201);
    expect(result.json).toMatchObject({ status: "joined", team: { id: team, name: "Acme" } });
    const member = h.server.teams.members(team).find((m) => m.userId === people["Cy"]!.id);
    expect(member).toMatchObject({ role: "viewer", departmentId: sales });
    expect(await eventsOf("invite.")).toContain("invite.redeemed");
    expect(await eventsOf("member.joined")).toContain("member.joined");
  });

  it("makes the account for someone who has none, and signs them in", async () => {
    const made = await invite({ approvalRequired: false });
    const result = await redeem({
      code: made.json!["code"],
      name: "Newcomer",
      email: "New@Example.com",
      password: PASSWORD,
    });
    expect(result.status).toBe(201);
    expect(result.json!["session"].token).toMatch(/^mst_/);
    expect(result.json!["session"].user).toMatchObject({
      email: "new@example.com",
      isOwner: false,
    });
    const token = result.json!["session"].token as string;
    expect((await h.call("GET", `/v1/teams/${team}`, { token })).status).toBe(200);
  });

  it("refuses a bad new account without using the invite", async () => {
    const made = await invite({ approvalRequired: false });
    const code = made.json!["code"];
    expect((await redeem({ code, name: "A", email: "bad", password: PASSWORD })).status).toBe(400);
    expect(
      (await redeem({ code, name: "A", email: "a@example.com", password: "short" })).status,
    ).toBe(400);
    expect(
      (await redeem({ code, name: "A", email: people["Ada"]!.email, password: PASSWORD })).json![
        "error"
      ].code,
    ).toBe("email_taken");
    expect((await redeem({ code })).status).toBe(400);
    const row = h.server.db
      .prepare("SELECT uses FROM invites WHERE id = ?")
      .get(made.json!["invite"].id) as { uses: number };
    expect(row.uses).toBe(0);
    expect(
      (await redeem({ code, name: "Ok", email: "ok@example.com", password: PASSWORD })).status,
    ).toBe(201);
  });

  it("returns already used on the second redemption of a single-use invite", async () => {
    const made = await invite({ approvalRequired: false });
    const code = made.json!["code"];
    expect((await redeem({ code }, as("Dee"))).status).toBe(201);
    const again = await redeem({ code, name: "B", email: "b@example.com", password: PASSWORD });
    expect(again.status).toBe(410);
    expect(again.json!["error"].code).toBe("already_used");
    expect(again.json!["error"].message).toContain("already used");
  });

  it("can be used several times when it allows several", async () => {
    const made = await invite({ approvalRequired: false, maxUses: 2 });
    const code = made.json!["code"];
    for (const email of ["m1@example.com", "m2@example.com"])
      expect((await redeem({ code, name: "M", email, password: PASSWORD })).status).toBe(201);
    expect(
      (await redeem({ code, name: "M", email: "m3@example.com", password: PASSWORD })).status,
    ).toBe(410);
  });

  it("cannot be redeemed after it expires, or after it is revoked", async () => {
    const soon = await invite({ approvalRequired: false, expiresInDays: 1 });
    h.clock.now += 2 * 86_400_000;
    const expired = await redeem({
      code: soon.json!["code"],
      name: "E",
      email: "e@example.com",
      password: PASSWORD,
    });
    expect(expired.status).toBe(410);
    expect(expired.json!["error"].code).toBe("expired");
    const listed = (await h.call("GET", `/v1/teams/${team}/invites`, { token: h.owner.token }))
      .json!["invites"] as Json[];
    expect(listed.find((i) => i["id"] === soon.json!["invite"].id)!["state"]).toBe("expired");

    const gone = await invite({ approvalRequired: false });
    expect(
      (
        await h.call("DELETE", `/v1/teams/${team}/invites/${gone.json!["invite"].id}`, {
          token: as("Ada"),
        })
      ).status,
    ).toBe(204);
    const revoked = await redeem({
      code: gone.json!["code"],
      name: "R",
      email: "r@example.com",
      password: PASSWORD,
    });
    expect(revoked.json!["error"].code).toBe("revoked");
    expect(await eventsOf("invite.revoked")).toContain("invite.revoked");
  });

  it("does not know a code that was never made, and does not let a member join twice", async () => {
    expect(
      (await redeem({ code: "inv_nothing", name: "N", email: "n@example.com", password: PASSWORD }))
        .status,
    ).toBe(404);
    const made = await invite({ approvalRequired: false, maxUses: 3 });
    // Ada is already in the team.
    expect((await redeem({ code: made.json!["code"] }, as("Ada"))).json!["error"].code).toBe(
      "already_member",
    );
    const row = h.server.db
      .prepare("SELECT uses FROM invites WHERE id = ?")
      .get(made.json!["invite"].id) as { uses: number };
    expect(row.uses).toBe(0);
  });
});

describe("approval", () => {
  const ask = async (email: string) => {
    const made = await invite({ role: "member", departmentId: sales });
    const result = await redeem({
      code: made.json!["code"],
      name: "Asker",
      email,
      password: PASSWORD,
    });
    return { made, result };
  };

  it("holds a request until an admin decides, and a request is not a membership", async () => {
    const { result } = await ask("ask1@example.com");
    expect(result.status).toBe(202);
    expect(result.json).toMatchObject({ status: "pending" });
    const asker = result.json!["session"];
    expect(h.server.teams.member(team, asker.user.id)).toBeNull();
    expect((await h.call("GET", `/v1/teams/${team}`, { token: asker.token })).status).toBe(403);

    const mine = (await h.call("GET", "/v1/me/join-requests", { token: asker.token })).json![
      "requests"
    ] as Json[];
    expect(mine).toMatchObject([{ status: "pending", teamId: team }]);

    const pending = (
      await h.call("GET", `/v1/teams/${team}/requests?status=pending`, { token: as("Ada") })
    ).json!["requests"] as Json[];
    const request = pending.find((r) => r["userId"] === asker.user.id)!;
    expect(request).toMatchObject({
      email: "ask1@example.com",
      role: "member",
      departmentId: sales,
    });
    // A manager cannot decide.
    expect(
      (
        await h.call("POST", `/v1/teams/${team}/requests/${request["id"]}/approve`, {
          token: as("Bea"),
        })
      ).status,
    ).toBe(403);

    const approved = await h.call("POST", `/v1/teams/${team}/requests/${request["id"]}/approve`, {
      token: as("Ada"),
    });
    expect(approved.json).toMatchObject({ status: "approved" });
    expect(h.server.teams.member(team, asker.user.id)).toMatchObject({
      role: "member",
      department_id: sales,
    });
    expect((await h.call("GET", `/v1/teams/${team}`, { token: asker.token })).status).toBe(200);
    expect(
      (
        await h.call("POST", `/v1/teams/${team}/requests/${request["id"]}/approve`, {
          token: as("Ada"),
        })
      ).status,
    ).toBe(409);
    expect(await eventsOf("join_request.")).toEqual(
      expect.arrayContaining(["join_request.created", "join_request.approved"]),
    );
  });

  it("leaves no membership row when a request is rejected", async () => {
    const { result } = await ask("ask2@example.com");
    const asker = result.json!["session"];
    const request = (
      (await h.call("GET", `/v1/teams/${team}/requests?status=pending`, { token: as("Ada") }))
        .json!["requests"] as Json[]
    ).find((r) => r["userId"] === asker.user.id)!;
    const rejected = await h.call("POST", `/v1/teams/${team}/requests/${request["id"]}/reject`, {
      token: as("Ada"),
    });
    expect(rejected.json).toMatchObject({ status: "rejected" });
    expect(h.server.teams.member(team, asker.user.id)).toBeNull();
    const rows = h.server.db
      .prepare("SELECT 1 FROM team_members WHERE user_id = ?")
      .all(asker.user.id);
    expect(rows).toHaveLength(0);
    const mine = (await h.call("GET", "/v1/me/join-requests", { token: asker.token })).json![
      "requests"
    ] as Json[];
    expect(mine[0]!["status"]).toBe("rejected");
    expect(await eventsOf("join_request.rejected")).toContain("join_request.rejected");
  });

  it("expires a request nobody decides in 14 days", async () => {
    const { result } = await ask("ask3@example.com");
    const asker = result.json!["session"];
    h.clock.now += (REQUEST_DAYS + 1) * 86_400_000;
    const listed = (await h.call("GET", `/v1/teams/${team}/requests`, { token: as("Ada") })).json![
      "requests"
    ] as Json[];
    expect(listed.find((r) => r["userId"] === asker.user.id)!["status"]).toBe("expired");
    const request = listed.find((r) => r["userId"] === asker.user.id)!;
    expect(
      (
        await h.call("POST", `/v1/teams/${team}/requests/${request["id"]}/approve`, {
          token: as("Ada"),
        })
      ).json!["error"].code,
    ).toBe("already_decided");
    expect(h.server.teams.member(team, asker.user.id)).toBeNull();
  });

  it("does not let an admin approve a role at or above their own, and does not stack requests", async () => {
    const made = await invite({ role: "admin" });
    const result = await redeem({
      code: made.json!["code"],
      name: "Up",
      email: "up@example.com",
      password: PASSWORD,
    });
    const asker = result.json!["session"];
    const request = (
      (await h.call("GET", `/v1/teams/${team}/requests?status=pending`, { token: as("Ada") }))
        .json!["requests"] as Json[]
    ).find((r) => r["userId"] === asker.user.id)!;
    expect(
      (
        await h.call("POST", `/v1/teams/${team}/requests/${request["id"]}/approve`, {
          token: as("Ada"),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await h.call("POST", `/v1/teams/${team}/requests/${request["id"]}/approve`, {
          token: h.owner.token,
        })
      ).status,
    ).toBe(200);

    const again = await invite({ role: "member" });
    const other = await redeem({
      code: again.json!["code"],
      name: "P",
      email: "p@example.com",
      password: PASSWORD,
    });
    const second = await invite({ role: "member" });
    const twice = await redeem({ code: second.json!["code"] }, other.json!["session"].token);
    expect(twice.status).toBe(409);
    expect(twice.json!["error"].code).toBe("request_pending");
  });
});
