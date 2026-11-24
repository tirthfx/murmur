import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startHarness } from "./test-helpers.ts";

/**
 * M7's exit criterion: the audit hash chain verifies after a day of simulated use. A day of what
 * a team does, with the clock moving hour by hour: accounts, teams, invites, shared entries,
 * policy, usage, Skills and folders, the second step. Then the chain is checked, and a changed
 * row is found.
 */
let h: Awaited<ReturnType<typeof startHarness>>;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(() => h.close());

const HOUR = 3_600_000;

describe("a day of simulated use", () => {
  it("leaves a chain that verifies, and a change to any row is found", async () => {
    const owner = h.owner.token;
    const team = (await h.call("POST", "/v1/teams", { token: owner, body: { name: "Acme" } }))
      .json!["id"] as string;
    const people = [];
    for (let hour = 0; hour < 24; hour++) {
      h.clock.now += HOUR;
      const person = await h.person(`Person ${hour}`);
      people.push(person);
      h.server.teams.addMember(team, person.id, hour % 5 === 0 ? "manager" : "member", null, {
        actorId: h.owner.id,
        via: "test",
      });
      await h.call("POST", `/v1/teams/${team}/dictionary`, {
        token: person.token,
        body: { term: `Term ${hour}`, scope: "company" },
      });
      if (hour % 3 === 0)
        await h.call("POST", `/v1/teams/${team}/invites`, { token: owner, body: {} });
      if (hour % 4 === 0)
        await h.call("PUT", `/v1/teams/${team}/policy`, {
          token: owner,
          body: { set: { adminContact: `it${hour}@acme.test` } },
        });
      if (hour % 6 === 0)
        await h.call("POST", `/v1/teams/${team}/skills`, {
          token: owner,
          body: { name: `Skill ${hour}`, body: "Summarise." },
        });
      if (hour % 8 === 0)
        await h.call("POST", `/v1/teams/${team}/folders`, {
          token: person.token,
          body: { name: `Folder ${hour}`, kind: "shared" },
        });
      // A wrong password now and then, as people do.
      if (hour % 7 === 0)
        await h.call("POST", "/v1/sessions", {
          body: { email: person.email, password: "not the password at all" },
        });
    }
    // The second step is set up and used.
    await h.call("POST", "/v1/admin/mfa/begin", {
      body: { email: "owner@example.com", password: "a long enough password" },
    });

    const verified = await h.call("POST", "/v1/audit/verify", { token: owner });
    expect(verified.status).toBe(200);
    expect(verified.json).toMatchObject({ ok: true });
    expect(verified.json!["count"]).toBeGreaterThan(80);
    const first = h.server.db
      .prepare("SELECT MIN(ts) AS a, MAX(ts) AS b FROM audit_events")
      .get() as {
      a: number;
      b: number;
    };
    expect(first.b - first.a).toBeGreaterThanOrEqual(23 * HOUR);

    // Any change to a stored row breaks the chain, and the check says where.
    const rows = h.server.db.prepare("SELECT seq FROM audit_events ORDER BY seq").all() as {
      seq: number;
    }[];
    const middle = rows[Math.floor(rows.length / 2)]!.seq;
    h.server.db.prepare("UPDATE audit_events SET action = 'tampered' WHERE seq = ?").run(middle);
    const broken = await h.call("POST", "/v1/audit/verify", { token: owner });
    expect(broken.json).toMatchObject({ ok: false });
    expect(JSON.stringify(broken.json)).toContain(String(middle));
  });
});
