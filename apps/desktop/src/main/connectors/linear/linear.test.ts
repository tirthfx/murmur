import { describe, expect, it } from "vitest";
import { LINEAR_SCOPES } from "@murmur/shared";
import { linearProvider, listTeams, readIssues } from "./linear";

const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), init);
const limits = { sleep: async () => undefined };

const issue = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  identifier: `ENG-${id}`,
  title: `Issue ${id}`,
  url: `https://linear.app/acme/issue/ENG-${id}`,
  updatedAt: "2026-11-20T10:00:00.000Z",
  state: { name: "In Progress", type: "started" },
  team: { key: "ENG" },
  ...over,
});

function fake(data: unknown) {
  const bodies: { query: string; variables: Record<string, unknown> | undefined }[] = [];
  return {
    bodies,
    fetch: async (_url: string, init?: RequestInit): Promise<Response> => {
      bodies.push(JSON.parse(String(init?.body)));
      return json({ data });
    },
  };
}

describe("Linear provider (CN-07)", () => {
  it("asks for the read scope only, on a fixed port", () => {
    expect(linearProvider.scopes).toEqual([...LINEAR_SCOPES]);
    expect(linearProvider.scopes).toEqual(["read"]);
    expect(linearProvider.loopbackPort).toBe(17823);
  });

  it("names the account by its email", async () => {
    const label = await linearProvider.accountLabel({
      token: { accessToken: "t", refreshToken: null, expiresIn: null, scopes: [] },
      http: async () => json({ data: { viewer: { email: "me@example.com" } } }),
    });
    expect(label).toBe("me@example.com");
  });
});

describe("listTeams", () => {
  it("lists the teams to pick from", async () => {
    const t = fake({ teams: { nodes: [{ id: "T1", name: "Engineering", key: "ENG" }] } });
    expect(await listTeams({ fetch: t.fetch, limits })).toEqual([
      { id: "T1", label: "Engineering (ENG)" },
    ]);
  });
});

describe("readIssues", () => {
  it("reads only the owner's own issues while assigned only is on, even with teams chosen", async () => {
    const t = fake({ viewer: { assignedIssues: { nodes: [issue("1")] } } });
    const items = await readIssues({ fetch: t.fetch, limits, teams: ["T1"], assignedOnly: true });
    expect(items).toHaveLength(1);
    expect(t.bodies).toHaveLength(1);
    expect(t.bodies[0]!.query).toContain("assignedIssues");
    expect(t.bodies[0]!.query).not.toMatch(/\bissues\(first/);
  });

  it("adds the issues of the selected teams, once each, when assigned only is off", async () => {
    const t = fake({
      viewer: {
        assignedIssues: {
          nodes: [issue("1"), issue("2", { updatedAt: "2026-11-21T10:00:00.000Z" })],
        },
      },
      issues: { nodes: [issue("2"), issue("3", { updatedAt: "2026-11-19T10:00:00.000Z" })] },
    });
    const items = await readIssues({ fetch: t.fetch, limits, teams: ["T1"], assignedOnly: false });
    expect(items.map((i) => i.id)).toEqual(["2", "1", "3"]);
    expect(t.bodies[0]!.query).toContain("team: { id: { in: $teams } }");
    expect(t.bodies[0]!.variables).toEqual({ teams: ["T1"], recent: "-P14D" });
  });

  it("says which project and cycle an issue belongs to", async () => {
    const t = fake({
      viewer: {
        assignedIssues: {
          nodes: [
            issue("1", { project: { name: "Onboarding" }, cycle: { number: 3, name: null } }),
            issue("2", { updatedAt: "2026-11-19T10:00:00.000Z" }),
          ],
        },
      },
    });
    const items = await readIssues({ fetch: t.fetch, limits, teams: [], assignedOnly: true });
    expect(items.map((item) => item.text)).toEqual([
      "In Progress: Issue 1 (Project: Onboarding. Cycle: 3)",
      "In Progress: Issue 2",
    ]);
    expect(t.bodies[0]!.query).toContain("project { name } cycle { number name }");
  });

  it("asks for no team issues when none is selected, even with assigned only off", async () => {
    const t = fake({ viewer: { assignedIssues: { nodes: [] } } });
    await readIssues({ fetch: t.fetch, limits, teams: [], assignedOnly: false });
    expect(t.bodies[0]!.query).not.toMatch(/\bissues\(first/);
  });

  it("shows an issue's new state at the next read, so closing one upstream shows within one poll", async () => {
    const open = fake({ viewer: { assignedIssues: { nodes: [issue("1")] } } });
    const closed = fake({
      viewer: {
        assignedIssues: { nodes: [issue("1", { state: { name: "Done", type: "completed" } })] },
      },
    });
    const args = { limits, teams: [], assignedOnly: true };
    expect((await readIssues({ fetch: open.fetch, ...args }))[0]!.tags).toEqual([
      "In Progress",
      "ENG",
    ]);
    const [after] = await readIssues({ fetch: closed.fetch, ...args });
    expect(after).toMatchObject({
      id: "1",
      kind: "issue",
      title: "ENG-1 Issue 1",
      text: "Done: Issue 1",
      tags: ["Done", "ENG"],
      url: "https://linear.app/acme/issue/ENG-1",
    });
  });

  it("explains a refused sign-in and an unreadable answer", async () => {
    await expect(
      readIssues({
        fetch: async () => json({}, { status: 401 }),
        limits,
        teams: [],
        assignedOnly: true,
      }),
    ).rejects.toThrow("Linear no longer accepts this sign-in");
    await expect(
      readIssues({
        fetch: async () => json({ errors: [{ message: "x" }] }),
        limits,
        teams: [],
        assignedOnly: true,
      }),
    ).rejects.toThrow("cannot read");
  });
});
