import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACTIONS,
  RANK,
  ROLES,
  allows,
  grantableRoles,
  isAction,
  type ActionName,
  type Role,
} from "./permissions.ts";
import { startHarness, type Harness } from "./test-helpers.ts";

/**
 * The matrix written out by hand, so a change to permissions.json that widens a role shows up as
 * a failing line here, not as a quiet change.
 */
const EXPECTED: Record<ActionName, Role[] | "server"> = {
  "team.create": "server",
  "team.view": ["owner", "admin", "manager", "member", "viewer"],
  "team.update": ["owner", "admin"],
  "team.delete": ["owner"],
  "members.list": ["owner", "admin", "manager", "member", "viewer"],
  "members.manage": ["owner", "admin"],
  "departments.list": ["owner", "admin", "manager", "member", "viewer"],
  "departments.manage": ["owner", "admin"],
  "invites.manage": ["owner", "admin"],
  "requests.manage": ["owner", "admin"],
  "users.manage": "server",
  "audit.view": "server",
  "audit.manage": "server",
  "vocabulary.view": ["owner", "admin", "manager", "member", "viewer"],
  "vocabulary.propose": ["owner", "admin", "manager", "member"],
  "vocabulary.review": ["owner", "admin", "manager"],
  "vocabulary.manage": ["owner", "admin"],
  "vocabulary.settings": ["owner", "admin"],
  "policy.view": ["owner", "admin", "manager", "member", "viewer"],
  "policy.manage": ["owner", "admin"],
  "usage.ingest": ["owner", "admin", "manager", "member", "viewer"],
  "usage.view": ["owner", "admin", "manager"],
  "usage.settings": ["owner", "admin"],
  "leaderboard.view": ["owner", "admin", "manager", "member", "viewer"],
  "identity.manage": ["owner", "admin"],
  "network.manage": "server",
  "compliance.manage": ["owner", "admin"],
};

describe("the permission matrix", () => {
  it("lists exactly the actions written out here", () => {
    expect(Object.keys(ACTIONS).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("allows each role exactly what is written, for every action", () => {
    for (const action of Object.keys(EXPECTED) as ActionName[]) {
      const expected = EXPECTED[action];
      for (const role of ROLES) {
        const want = expected === "server" ? false : expected.includes(role);
        expect(allows(action, { role, isServerOwner: false }), `${role} ${action}`).toBe(want);
      }
      // A person who is in no team has no team right.
      expect(allows(action, { role: null, isServerOwner: false }), `outsider ${action}`).toBe(
        false,
      );
      // The server owner can do everything.
      expect(allows(action, { role: null, isServerOwner: true }), `server owner ${action}`).toBe(
        true,
      );
    }
  });

  it("ranks the roles and gives only roles below your own, never owner", () => {
    expect(ROLES.map((role) => RANK[role])).toEqual([5, 4, 3, 2, 1]);
    expect(grantableRoles("owner")).toEqual(["admin", "manager", "member", "viewer"]);
    expect(grantableRoles("admin")).toEqual(["manager", "member", "viewer"]);
    expect(grantableRoles("manager")).toEqual(["member", "viewer"]);
    expect(grantableRoles("member")).toEqual(["viewer"]);
    expect(grantableRoles("viewer")).toEqual([]);
  });

  it("knows its action names", () => {
    expect(isAction("team.view")).toBe(true);
    expect(isAction("toString")).toBe(false);
    expect(isAction("nope.nope")).toBe(false);
  });
});

describe("every endpoint, for every role", () => {
  let h: Harness & { owner: { id: string; token: string } };
  const tokens: Record<string, string | null> = {};
  let teamId = "";

  beforeAll(async () => {
    h = await startHarness();
    const made = await h.call("POST", "/v1/teams", {
      token: h.owner.token,
      body: { name: "Fixture" },
    });
    teamId = made.json!["id"] as string;
    for (const role of ["admin", "manager", "member", "viewer"] as const) {
      const who = await h.person(role);
      h.server.teams.addMember(teamId, who.id, role, null, { actorId: null, via: "test" });
      tokens[role] = who.token;
    }
    tokens["outsider"] = (await h.person("outsider")).token;
    tokens["server owner"] = h.owner.token;
  });
  afterAll(() => h.close());

  const roles = ["outsider", "viewer", "member", "manager", "admin", "server owner"];
  const roleOf = (who: string): Role | null =>
    who === "server owner" ? "owner" : who === "outsider" ? null : (who as Role);

  it("has a rule for every route: public, optional, signed in, or an action in the matrix", () => {
    for (const route of h.server.routes) {
      const ok =
        route.access === "public" ||
        route.access === "optional" ||
        route.access === "scim" ||
        route.access === "signed_in" ||
        isAction(route.access.action);
      expect(ok, `${route.method} ${route.path}`).toBe(true);
    }
  });

  it("uses every action of the matrix on some route", () => {
    const used = new Set(
      h.server.routes.flatMap((route) =>
        typeof route.access === "object" ? [route.access.action] : [],
      ),
    );
    expect([...used].sort()).toEqual(Object.keys(ACTIONS).sort());
  });

  it("answers 403 to a role the matrix does not allow, and reaches the handler for one it does", async () => {
    const guarded = h.server.routes
      .filter((route) => typeof route.access === "object")
      // Deleting the team goes last, or the other routes would have no team.
      .sort(
        (a, b) =>
          Number(a.method === "DELETE" && a.path === "/v1/teams/:teamId") -
          Number(b.method === "DELETE" && b.path === "/v1/teams/:teamId"),
      );

    for (const route of guarded) {
      const action = (route.access as { action: ActionName }).action;
      const path = route.path
        .replace(":teamId", teamId)
        .replace(/:(\w+)/g, "00000000-0000-0000-0000-000000000000");
      for (const who of roles) {
        const result = await h.call(route.method, path, {
          token: tokens[who] ?? null,
          body: route.method === "GET" || route.method === "DELETE" ? undefined : {},
        });
        const allowed = allows(action, {
          role: roleOf(who),
          isServerOwner: who === "server owner",
        });
        const label = `${who} ${route.method} ${route.path}`;
        // A role that holds an action only for its own department gets past the router; the
        // service may still say no, with its own words rather than the router's.
        const departmentOnly =
          ACTIONS[action].departmentScoped?.includes(roleOf(who) as Role) ?? false;
        if (allowed && departmentOnly && result.status === 403)
          expect(result.json?.["error"]?.message, label).not.toBe(
            "You are not allowed to do that.",
          );
        else if (allowed) expect(result.status, label).not.toBe(403);
        else expect(result.status, label).toBe(403);
        expect(result.status, label).not.toBe(401);
      }
      // Nobody signed in is turned away before the matrix.
      const anonymous = await h.call(route.method, path, {
        body: route.method === "GET" || route.method === "DELETE" ? undefined : {},
      });
      expect(anonymous.status, `anonymous ${route.method} ${route.path}`).toBe(401);
    }
  });
});
