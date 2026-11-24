import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PASSWORD, startHarness } from "../../local-server/src/test-helpers.ts";
import {
  applyImport,
  describePlan,
  planImport,
  projectApi,
  temporaryPassword,
  verifyImport,
  type ImportPlan,
  type ProjectApi,
} from "./migrate.ts";

/**
 * Moving a local server to Supabase (SW-01 phase 4). The plan is read from a real local server's
 * database after real use of it; the live part (writing to a project and counting afterwards) runs
 * only when a throwaway project is configured, like the contract suite.
 */
let dir = "";
let h: Awaited<ReturnType<typeof startHarness>>;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "murmur-migrate-"));
  h = await startHarness({ dbPath: join(dir, "server.db") });
});
afterEach(async () => {
  await h.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A server that has been used: a team with departments, people, shared content and usage. */
async function seed() {
  const call = h.call;
  const team = (await call("POST", "/v1/teams", { token: h.owner.token, body: { name: "Acme" } }))
    .json!["id"] as string;
  const dept = async (name: string, parentId?: string) =>
    (
      await call("POST", `/v1/teams/${team}/departments`, {
        token: h.owner.token,
        body: { name, costCenter: "CC-1", ...(parentId ? { parentId } : {}) },
      })
    ).json!["id"] as string;
  const sales = await dept("Sales");
  const emea = await dept("EMEA", sales);
  const bea = await h.person("Bea Member");
  h.server.teams.addMember(team, bea.id, "member", emea, { actorId: h.owner.id, via: "test" });
  const gone = await h.person("Gone Person");
  h.server.accounts.setStatus(gone.id, "deactivated");

  await call("POST", `/v1/teams/${team}/dictionary`, {
    token: h.owner.token,
    body: { term: "Kubernetes", replacement: "K8s", scope: "company" },
  });
  await call("POST", `/v1/teams/${team}/snippets`, {
    token: h.owner.token,
    body: { trigger: "sig", expansion: "Best, {{me}}", scope: "company" },
  });
  // A proposal that waits for a review.
  await call("POST", `/v1/teams/${team}/dictionary`, {
    token: bea.token,
    body: { term: "Zendesk" },
  });
  await call("PUT", `/v1/teams/${team}/policy`, {
    token: h.owner.token,
    body: { set: { "features.scratchpad": false, adminContact: "it@acme.test" } },
  });
  await call("POST", `/v1/teams/${team}/usage`, {
    token: bea.token,
    body: {
      batchId: "batch-0001",
      events: [{ day: "2001-09-09", metric: "words", count: 120, bucket: "mail" }],
    },
  });
  const skill = await call("POST", `/v1/teams/${team}/skills`, {
    token: h.owner.token,
    body: { name: "Call recap", description: "d", body: "---\nname: Call recap\n---\nFive lines." },
  });
  await call("PATCH", `/v1/teams/${team}/skills/${skill.json!["skill"].id}`, {
    token: h.owner.token,
    body: { body: "---\nname: Call recap\n---\nThree lines." },
  });
  const folder = await call("POST", `/v1/teams/${team}/folders`, {
    token: bea.token,
    body: { name: "Q4 deal", kind: "shared" },
  });
  await call("POST", `/v1/teams/${team}/folders/${folder.json!["folder"].id}/items`, {
    token: bea.token,
    body: { title: "Kickoff", body: "# Kickoff", sourceRef: "meeting:1" },
  });
  await call("POST", `/v1/teams/${team}/invites`, { token: h.owner.token, body: {} });
  return { team, sales, emea, bea, gone };
}

function planOf(): ImportPlan {
  const db = new DatabaseSync(join(dir, "server.db"), { readOnly: true });
  try {
    return planImport(db);
  } finally {
    db.close();
  }
}

describe("planning an import from a local server", () => {
  it("lists every account with its own id, the owner, and those that were turned off", async () => {
    const { bea, gone } = await seed();
    const plan = planOf();
    expect(plan.users.map((u) => u["email"]).sort()).toEqual([
      "bea.member@example.com",
      "gone.person@example.com",
      "owner@example.com",
    ]);
    expect(plan.users.find((u) => u["email"] === "bea.member@example.com")!["id"]).toBe(bea.id);
    expect(plan.owner).toBe(h.owner.id);
    expect(plan.deactivated).toEqual([gone.id]);
  });

  it("moves the team with its departments in order, its members, plan and settings", async () => {
    const { team, sales, emea, bea } = await seed();
    const plan = planOf();
    expect(plan.teams).toHaveLength(1);
    expect(plan.teams[0]).toMatchObject({ id: team, name: "Acme", created_by: h.owner.id });
    expect(plan.teamPlans).toEqual([{ team_id: team, tier: "enterprise" }]);
    expect(plan.departments.map((d) => d["id"]).sort()).toEqual([sales, emea].sort());
    expect(plan.departments.find((d) => d["id"] === emea)).toMatchObject({
      parent_id: sales,
      cost_center: "CC-1",
    });
    const member = plan.teamMembers.find((m) => m["user_id"] === bea.id)!;
    expect(member).toMatchObject({ role: "member", department_id: emea });
    expect(typeof member["joined_at"]).toBe("string");
  });

  it("moves the shared entries as they are, the live ones and the ones waiting for a review", async () => {
    await seed();
    const plan = planOf();
    const byKey = Object.fromEntries(plan.vocabularyItems.map((i) => [String(i["key"]), i]));
    expect(byKey["kubernetes"]).toMatchObject({
      kind: "dictionary",
      status: "active",
      payload: { term: "Kubernetes", replacement: "K8s" },
    });
    expect(byKey["sig"]).toMatchObject({ kind: "snippet", payload: { trigger: "sig" } });
    expect(byKey["zendesk"]).toMatchObject({ status: "pending" });
    expect(plan.vocabularyVersions.length).toBeGreaterThanOrEqual(2);
  });

  it("moves policy, usage, Skills with their versions, and folders with their notes", async () => {
    const { team, bea } = await seed();
    const plan = planOf();
    expect(plan.policyValues.find((p) => p["key"] === "features.scratchpad")).toMatchObject({
      team_id: team,
      scope: "team",
      value: false,
    });
    expect(plan.usageDaily).toEqual([
      {
        team_id: team,
        user_id: bea.id,
        day: "2001-09-09",
        metric: "words",
        bucket: "mail",
        count: 120,
      },
    ]);
    expect(plan.teamSkills[0]).toMatchObject({ name: "Call recap", version: 2 });
    expect(plan.teamSkillVersions.map((v) => v["version"])).toEqual([1, 2]);
    expect(plan.sharedFolders[0]).toMatchObject({ name: "Q4 deal", kind: "shared" });
    expect(plan.folderMembers[0]).toMatchObject({ user_id: bea.id, can_write: true });
    expect(plan.folderItems[0]).toMatchObject({ title: "Kickoff", source_ref: "meeting:1" });
  });

  it("says what is left behind: the invite, the audit log, and no hash or password is in the plan", async () => {
    await seed();
    const plan = planOf();
    expect(plan.dropped.invites).toBe(1);
    expect(plan.dropped.auditEvents).toBeGreaterThan(5);
    expect(plan.audit.events).toBe(plan.dropped.auditEvents);
    expect(plan.audit.lastHash).toMatch(/^[0-9a-f]{64}$/);
    const text = JSON.stringify(plan);
    expect(text).not.toMatch(/password_hash|scrypt|mst_|inv_/);
    expect(describePlan(plan)).toContain("audit log");
    expect(describePlan(plan)).toContain("passwords");
  });

  it("plans an empty server as nothing to move", () => {
    const plan = planOf();
    expect(plan.teams).toEqual([]);
    expect(plan.counts["auth.users"]).toBe(1); // the owner only
  });

  it("makes temporary passwords that are long, random and easy to type", () => {
    const a = temporaryPassword();
    expect(a).toMatch(/^[A-Za-z0-9_-]{6}(-[A-Za-z0-9_-]{6}){3}$/);
    expect(temporaryPassword()).not.toBe(a);
  });
});

describe("applying a plan, with a project that records what it is asked", () => {
  /** A project that remembers what was written, so the order and the content can be read. */
  function recorder() {
    const calls: { kind: string; table?: string; rows?: unknown[]; user?: string }[] = [];
    const existing = { teams: 0 };
    const api: ProjectApi = {
      insert: async (table, rows) => void calls.push({ kind: "insert", table, rows }),
      update: async (table) => void calls.push({ kind: "update", table }),
      createUser: async (user) => void calls.push({ kind: "user", user: user.email }),
      rpc: async (name) => void calls.push({ kind: "rpc", table: name }),
      count: async (table) => (table === "teams" ? existing.teams : 0),
    };
    return { api, calls, existing };
  }

  it("makes the accounts first, then writes each table after the tables it refers to", async () => {
    await seed();
    const { api, calls } = recorder();
    const report = await applyImport(planOf(), api, {
      passwordFor: (id) => `pw-${id.slice(0, 4)}`,
    });
    const order = calls.filter((c) => c.kind === "insert").map((c) => c.table);
    expect(calls[0]).toMatchObject({ kind: "user" });
    expect(order.indexOf("teams")).toBeLessThan(order.indexOf("departments"));
    expect(order.indexOf("departments")).toBeLessThan(order.indexOf("team_members"));
    expect(order.indexOf("vocabulary_items")).toBeLessThan(order.indexOf("vocabulary_versions"));
    expect(order.indexOf("team_skills")).toBeLessThan(order.indexOf("team_skill_versions"));
    expect(order.indexOf("shared_folders")).toBeLessThan(order.indexOf("folder_items"));
    expect(report.accounts).toHaveLength(3);
    expect(report.accounts[0]!.temporaryPassword).toMatch(/^pw-/);
    // A parent department comes before its child.
    const departments = calls.find((c) => c.table === "departments")!.rows as { name: string }[];
    expect(departments.map((d) => d.name)).toEqual(["Sales", "EMEA"]);
    // The owner and the turned-off account are marked, and each team gets the event for its log.
    expect(calls.filter((c) => c.kind === "update")).toHaveLength(2);
    expect(calls.filter((c) => c.kind === "rpc" && c.table === "record_import")).toHaveLength(1);
  });

  it("refuses a project that already has these teams, and writes nothing", async () => {
    await seed();
    const { api, calls, existing } = recorder();
    existing.teams = 1;
    await expect(applyImport(planOf(), api)).rejects.toThrow(/already in the project/);
    expect(calls).toEqual([]);
  });

  it("reports a count that does not match when the project has fewer rows", async () => {
    await seed();
    const { api } = recorder();
    const lines = await verifyImport(planOf(), api);
    expect(lines.find((l) => l.table === "teams")).toMatchObject({
      local: 1,
      remote: 0,
      ok: false,
    });
  });
});

// The live run: a throwaway project, configured like the contract suite (see docs/supabase.md).
const URL = process.env["MURMUR_SUPABASE_TEST_URL"] ?? "";
const SERVICE = process.env["MURMUR_SUPABASE_TEST_SERVICE_KEY"] ?? "";
const LIVE = URL !== "" && SERVICE !== "" && process.env["MURMUR_SUPABASE_TEST_WIPE"] === "yes";

describe.skipIf(!LIVE)("moving a server into a Supabase test project", () => {
  it("writes everything, every table then matches, and an account can sign in with its temporary password", async () => {
    const api = projectApi(URL, SERVICE);
    await api.rpc("murmur_test_reset", {});
    await seed();
    const plan = planOf();
    const report = await applyImport(plan, api);
    const lines = await verifyImport(plan, api);
    expect(lines.filter((l) => !l.ok)).toEqual([]);
    expect(lines.length).toBeGreaterThan(8);
    const bea = report.accounts.find((a) => a.email === "bea.member@example.com")!;
    const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: process.env["MURMUR_SUPABASE_TEST_ANON_KEY"] ?? "",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: bea.email, password: bea.temporaryPassword }),
    });
    expect(res.status).toBe(200);
    // And the old password does not work: the hashes were not carried over.
    const old = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: process.env["MURMUR_SUPABASE_TEST_ANON_KEY"] ?? "",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: bea.email, password: PASSWORD }),
    });
    expect(old.status).toBe(400);
    // Importing again is refused.
    await expect(applyImport(plan, api)).rejects.toThrow(/already in the project/);
  });
});
