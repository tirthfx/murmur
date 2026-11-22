import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness, type Json } from "./test-helpers.ts";

let h: Harness & { owner: { id: string; token: string } };
let team = "";
const people: Record<string, { id: string; email: string; token: string }> = {};

beforeAll(async () => {
  h = await startHarness();
  team = (await h.call("POST", "/v1/teams", { token: h.owner.token, body: { name: "Acme" } }))
    .json!["id"] as string;
  for (const name of ["Ada", "Bea", "Cy", "Dee", "Eve"]) people[name] = await h.person(name);
  const add = (name: string, role: "admin" | "manager" | "member" | "viewer") =>
    h.server.teams.addMember(team, people[name]!.id, role, null, { actorId: null, via: "test" });
  add("Ada", "admin");
  add("Bea", "manager");
  add("Cy", "member");
  add("Dee", "viewer");
});
afterAll(() => h.close());

const as = (name: string) => people[name]!.token;
const actions = async (query = "") =>
  (
    (await h.call("GET", `/v1/audit${query}`, { token: h.owner.token })).json!["events"] as Json[]
  ).map((event) => event["action"] as string);

describe("teams", () => {
  it("are made by the server owner, who becomes the team's owner", async () => {
    const made = await h.call("POST", "/v1/teams", {
      token: h.owner.token,
      body: { name: "  Beta   Co " },
    });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ name: "Beta Co", myRole: "owner", memberCount: 1 });
    expect(
      (await h.call("POST", "/v1/teams", { token: as("Ada"), body: { name: "Mine" } })).status,
    ).toBe(403);
    expect(
      (await h.call("POST", "/v1/teams", { token: h.owner.token, body: { name: "" } })).status,
    ).toBe(400);
  });

  it("show a person the teams they are in, with their role", async () => {
    const mine = (await h.call("GET", "/v1/teams", { token: as("Cy") })).json!["teams"] as Json[];
    expect(mine.map((entry) => [entry["name"], entry["myRole"]])).toEqual([["Acme", "member"]]);
    const outsider = (await h.call("GET", "/v1/teams", { token: as("Eve") })).json![
      "teams"
    ] as Json[];
    expect(outsider).toEqual([]);
    const all = (await h.call("GET", "/v1/teams", { token: h.owner.token })).json![
      "teams"
    ] as Json[];
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("are renamed by an admin and deleted only by the owner", async () => {
    const other = (
      await h.call("POST", "/v1/teams", { token: h.owner.token, body: { name: "Temp" } })
    ).json!["id"] as string;
    h.server.teams.addMember(other, people["Ada"]!.id, "admin", null, {
      actorId: null,
      via: "test",
    });
    const renamed = await h.call("PATCH", `/v1/teams/${other}`, {
      token: as("Ada"),
      body: { name: "Temp 2" },
    });
    expect(renamed.json).toMatchObject({ name: "Temp 2" });
    expect((await h.call("DELETE", `/v1/teams/${other}`, { token: as("Ada") })).status).toBe(403);
    expect((await h.call("DELETE", `/v1/teams/${other}`, { token: h.owner.token })).status).toBe(
      204,
    );
    expect((await h.call("GET", `/v1/teams/${other}`, { token: h.owner.token })).status).toBe(404);
    expect(await actions("?action=team.")).toEqual(
      expect.arrayContaining(["team.created", "team.renamed", "team.deleted"]),
    );
  });

  it("are not visible to someone who is not in them", async () => {
    expect((await h.call("GET", `/v1/teams/${team}`, { token: as("Eve") })).status).toBe(403);
    expect((await h.call("GET", `/v1/teams/${team}/members`, { token: as("Eve") })).status).toBe(
      403,
    );
    expect((await h.call("GET", `/v1/teams/${team}`, { token: as("Dee") })).status).toBe(200);
  });
});

describe("members", () => {
  it("are listed for every role, and a Member's call to an admin endpoint is refused", async () => {
    const list = await h.call("GET", `/v1/teams/${team}/members`, { token: as("Cy") });
    expect((list.json!["members"] as Json[]).map((m) => m["role"]).sort()).toEqual(
      ["admin", "manager", "member", "owner", "viewer"].sort(),
    );
    expect(JSON.stringify(list.json)).not.toContain("password");
    const denied = await h.call("PATCH", `/v1/teams/${team}/members/${people["Dee"]!.id}`, {
      token: as("Cy"),
      body: { role: "member" },
    });
    expect(denied.status).toBe(403);
  });

  it("have a role changed by someone above it, never to a role at or above the changer's", async () => {
    const change = (who: string, target: string, body: unknown) =>
      h.call("PATCH", `/v1/teams/${team}/members/${people[target]!.id}`, { token: as(who), body });
    // An admin can make a viewer a member, but not an admin; and cannot touch another admin.
    expect((await change("Ada", "Dee", { role: "member" })).json).toMatchObject({ role: "member" });
    expect((await change("Ada", "Dee", { role: "admin" })).status).toBe(403);
    expect((await change("Ada", "Dee", { role: "owner" })).status).toBe(400);
    expect((await change("Ada", "Dee", { role: "boss" })).status).toBe(400);
    expect((await change("Ada", "Ada", { role: "viewer" })).status).toBe(403);
    // The server owner can make an admin, and an admin cannot then change that admin.
    const second = await h.person("Fay");
    h.server.teams.addMember(team, second.id, "member", null, { actorId: null, via: "test" });
    const promoted = await h.call("PATCH", `/v1/teams/${team}/members/${second.id}`, {
      token: h.owner.token,
      body: { role: "admin" },
    });
    expect(promoted.json).toMatchObject({ role: "admin" });
    expect(
      (
        await h.call("PATCH", `/v1/teams/${team}/members/${second.id}`, {
          token: as("Ada"),
          body: { role: "viewer" },
        })
      ).status,
    ).toBe(403);
    // Put Dee back for the tests after this one.
    await change("Ada", "Dee", { role: "viewer" });
    const events = (
      await h.call("GET", "/v1/audit?action=member.role_changed", { token: h.owner.token })
    ).json!["events"] as Json[];
    expect(
      events.some((event) => event["detail"].from === "viewer" && event["detail"].to === "member"),
    ).toBe(true);
  });

  it("cannot change the team owner", async () => {
    const result = await h.call("PATCH", `/v1/teams/${team}/members/${h.owner.id}`, {
      token: as("Ada"),
      body: { role: "viewer" },
    });
    expect(result.status).toBe(403);
    const removal = await h.call("DELETE", `/v1/teams/${team}/members/${h.owner.id}`, {
      token: as("Ada"),
    });
    expect(removal.status).toBe(403);
  });

  it("lose access on the next request when removed, and can leave on their own", async () => {
    const eve = people["Eve"]!;
    h.server.teams.addMember(team, eve.id, "member", null, { actorId: null, via: "test" });
    expect((await h.call("GET", `/v1/teams/${team}`, { token: eve.token })).status).toBe(200);
    // A manager cannot remove anyone; an admin can remove a member.
    expect(
      (await h.call("DELETE", `/v1/teams/${team}/members/${eve.id}`, { token: as("Bea") })).status,
    ).toBe(403);
    expect(
      (await h.call("DELETE", `/v1/teams/${team}/members/${eve.id}`, { token: as("Ada") })).status,
    ).toBe(204);
    expect((await h.call("GET", `/v1/teams/${team}`, { token: eve.token })).status).toBe(403);
    // The account itself is untouched.
    expect((await h.call("GET", "/v1/me", { token: eve.token })).status).toBe(200);

    h.server.teams.addMember(team, eve.id, "member", null, { actorId: null, via: "test" });
    expect((await h.call("POST", `/v1/teams/${team}/leave`, { token: eve.token })).status).toBe(
      204,
    );
    expect((await h.call("POST", `/v1/teams/${team}/leave`, { token: eve.token })).status).toBe(
      404,
    );
    expect((await h.call("POST", `/v1/teams/${team}/leave`, { token: h.owner.token })).status).toBe(
      403,
    );
    expect(await actions("?action=member.")).toEqual(
      expect.arrayContaining(["member.removed", "member.left"]),
    );
  });
});

describe("departments", () => {
  let sales = "";

  it("are made by an admin with a cost center, listed for everyone, and named once", async () => {
    const made = await h.call("POST", `/v1/teams/${team}/departments`, {
      token: as("Ada"),
      body: { name: "Sales", costCenter: "CC-100" },
    });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ name: "Sales", costCenter: "CC-100", parentId: null });
    sales = made.json!["id"] as string;
    expect(
      (
        await h.call("POST", `/v1/teams/${team}/departments`, {
          token: as("Ada"),
          body: { name: "Sales" },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await h.call("POST", `/v1/teams/${team}/departments`, {
          token: as("Cy"),
          body: { name: "X" },
        })
      ).status,
    ).toBe(403);
    const list = await h.call("GET", `/v1/teams/${team}/departments`, { token: as("Dee") });
    expect((list.json!["departments"] as Json[]).map((d) => d["name"])).toEqual(["Sales"]);
    expect(
      (
        await h.call("POST", `/v1/teams/${team}/departments`, {
          token: as("Ada"),
          body: { name: "Y", costCenter: "x".repeat(51) },
        })
      ).status,
    ).toBe(400);
  });

  it("go one level deep", async () => {
    const child = await h.call("POST", `/v1/teams/${team}/departments`, {
      token: as("Ada"),
      body: { name: "EMEA", parentId: sales },
    });
    expect(child.status).toBe(201);
    const deeper = await h.call("POST", `/v1/teams/${team}/departments`, {
      token: as("Ada"),
      body: { name: "Deeper", parentId: child.json!["id"] },
    });
    expect(deeper.status).toBe(400);
    // Sales has a child, so it cannot get a parent; and a department is not its own parent.
    const other = (
      await h.call("POST", `/v1/teams/${team}/departments`, {
        token: as("Ada"),
        body: { name: "Ops" },
      })
    ).json!["id"];
    expect(
      (
        await h.call("PATCH", `/v1/teams/${team}/departments/${sales}`, {
          token: as("Ada"),
          body: { parentId: other },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.call("PATCH", `/v1/teams/${team}/departments/${other}`, {
          token: as("Ada"),
          body: { parentId: other },
        })
      ).status,
    ).toBe(400);
    const moved = await h.call("PATCH", `/v1/teams/${team}/departments/${other}`, {
      token: as("Ada"),
      body: { parentId: sales, costCenter: "CC-200" },
    });
    expect(moved.json).toMatchObject({ parentId: sales, costCenter: "CC-200" });
  });

  it("hold a member in one place at a time, and only departments of the same team", async () => {
    const put = (departmentId: string | null) =>
      h.call("PATCH", `/v1/teams/${team}/members/${people["Cy"]!.id}`, {
        token: as("Ada"),
        body: { departmentId },
      });
    expect((await put(sales)).json).toMatchObject({ departmentId: sales });
    const otherTeam = (
      await h.call("POST", "/v1/teams", { token: h.owner.token, body: { name: "Else" } })
    ).json!["id"];
    const foreign = (
      await h.call("POST", `/v1/teams/${otherTeam}/departments`, {
        token: h.owner.token,
        body: { name: "Foreign" },
      })
    ).json!["id"] as string;
    expect((await put(foreign)).status).toBe(400);
    expect((await put(null)).json).toMatchObject({ departmentId: null });
    await put(sales);
    // Deleting the department leaves the member with none, not removed.
    expect(
      (await h.call("DELETE", `/v1/teams/${team}/departments/${sales}`, { token: as("Ada") }))
        .status,
    ).toBe(204);
    const members = (await h.call("GET", `/v1/teams/${team}/members`, { token: as("Ada") })).json![
      "members"
    ] as Json[];
    expect(members.find((m) => m["userId"] === people["Cy"]!.id)).toMatchObject({
      departmentId: null,
    });
    expect(
      (await h.call("DELETE", `/v1/teams/${team}/departments/${sales}`, { token: as("Ada") }))
        .status,
    ).toBe(404);
  });
});
