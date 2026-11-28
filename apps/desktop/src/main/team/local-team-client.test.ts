import { describe, expect, it } from "vitest";
import { createLocalServer } from "../../../../../services/local-server/src/server.ts";
import { createLocalTeamClient } from "./local-team-client";
import {
  CONTRACT_PASSWORD,
  describeTeamClientContract,
  expectError,
  type ContractBackend,
} from "./team-client-contract";
import { describeTeamAccountContract } from "./team-account-contract";
import { describeTeamContentContract } from "./team-content-contract";

// Responses are read loosely on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

/** The local server on a free port, set up the way the contract needs (the only backend-specific part). */
async function startLocal(): Promise<ContractBackend> {
  const server = createLocalServer({ dbPath: ":memory:", port: 0, siemAutoFlush: false });
  const { host, port } = await server.listen();
  const base = `http://${host}:${port}`;
  const ownerEmail = "ada@example.com";
  let ownerToken = "";

  async function api(method: string, path: string, body?: unknown): Promise<Json> {
    if (ownerToken === "") {
      const signed = await fetch(`${base}/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: ownerEmail, password: CONTRACT_PASSWORD }),
      });
      ownerToken = ((await signed.json()) as Json)["token"];
    }
    const res = await fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${ownerToken}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return text ? (JSON.parse(text) as Json) : {};
  }

  const clientFor = (
    token: string | null,
    url = base,
    check: (url: string) => void = () => undefined,
  ) =>
    createLocalTeamClient({ serverUrl: () => url, token: () => token, fetch, networkCheck: check });

  let people = 0;
  return {
    client: (token) => clientFor(token),
    unreachable: () => clientFor(null, "http://127.0.0.1:1/"),
    refused: () =>
      clientFor(null, base, () => {
        throw new Error(
          "Strict local mode is on, so Murmur will not connect to a team server on the network.",
        );
      }),
    admin: {
      ownerEmail,
      createTeam: async (name) => (await api("POST", "/v1/teams", { name }))["id"],
      async addMember(teamId, name, role) {
        const email = `member${++people}@example.com`;
        const owner = server.accounts.listUsers().find((user) => user.email === ownerEmail)!;
        const made = server.accounts.createAccount(
          { name, email, password: CONTRACT_PASSWORD },
          owner.id,
        );
        if (!made.ok) throw new Error(made.message);
        server.teams.addMember(teamId, made.user.id, role as never, null, {
          actorId: owner.id,
          via: "test",
        });
        return email;
      },
      async createInvite(teamId, approvalRequired) {
        const made = await api("POST", `/v1/teams/${teamId}/invites`, {
          approvalRequired,
          maxUses: 5,
        });
        return made["code"];
      },
      async setPolicy(teamId, set) {
        await api("PUT", `/v1/teams/${teamId}/policy`, { set });
      },
      async setPlan(tier) {
        await api("PUT", "/v1/plan", { tier });
      },
      async addDictionary(teamId, term) {
        await api("POST", `/v1/teams/${teamId}/dictionary`, { term, scope: "company" });
      },
      async rejectPending(teamId, comment) {
        const pending = await api("GET", `/v1/teams/${teamId}/vocabulary/pending`);
        const item = (pending["items"] as Json[])[0]!;
        await api("POST", `/v1/teams/${teamId}/vocabulary/items/${item["id"]}/reject`, { comment });
      },
      async usageTotal(teamId, metric) {
        const report = await api("GET", `/v1/teams/${teamId}/usage?from=2026-10-01&to=2026-11-30`);
        return report["totals"][metric] as number;
      },
      async retentionReports() {
        const log = await api("GET", "/v1/audit?limit=100&action=policy.retention_applied");
        return (log["events"] as Json[]).length;
      },
    },
    close: () => server.close(),
  };
}

describeTeamClientContract("the local server", { start: startLocal });
describeTeamContentContract("the local server", { start: startLocal });
describeTeamAccountContract("the local server", { start: startLocal });

describe("how the local client turns a failure into an error", () => {
  const withFetch = (answer: () => Promise<Response>) =>
    createLocalTeamClient({
      serverUrl: () => "http://127.0.0.1:7830/",
      token: () => "t",
      fetch: answer as unknown as typeof fetch,
      networkCheck: () => undefined,
    });
  const json = (status: number, body: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );

  it("says server for a failure on the server, with its words or ours", async () => {
    expect(
      expectError(
        await withFetch(() => json(500, { error: { message: "Boom" } })).teams(),
        "server",
      ).message,
    ).toBe("Boom");
    expect(
      expectError(await withFetch(() => json(503, {})).teams(), "server").message.length,
    ).toBeGreaterThan(0);
  });

  it("maps each status to one error, and keeps the wait", async () => {
    for (const [status, code] of [
      [401, "unauthorized"],
      [403, "forbidden"],
      [404, "not_found"],
      [409, "conflict"],
      [400, "invalid"],
      [413, "invalid"],
    ] as const)
      expectError(
        await withFetch(() => json(status, { error: { code: "x", message: "m" } })).teams(),
        code,
      );
    const waited = expectError(
      await withFetch(() =>
        json(429, { error: { code: "delayed", message: "Wait", retryAfterSeconds: 30 } }),
      ).teams(),
      "rate_limited",
    );
    expect(waited.retryAfterSeconds).toBe(30);
  });

  it("does not choke on an answer that is not JSON", async () => {
    expectError(
      await withFetch(() => Promise.resolve(new Response("<html>", { status: 502 }))).teams(),
      "server",
    );
  });

  it("never lets a thrown fetch escape", async () => {
    expectError(
      await withFetch(() => Promise.reject(new TypeError("fetch failed"))).health(),
      "offline",
    );
  });

  it("an address that does not answer like a team server is invalid", async () => {
    expectError(await withFetch(() => json(200, { hello: "world" })).health(), "invalid");
    expectError(await withFetch(() => json(404, {})).health(), "invalid");
  });
});

describe("the leaderboard from the local server (TM-26)", () => {
  it("is read in the form the app knows, and the choice to be listed is saved", async () => {
    const server = createLocalServer({ dbPath: ":memory:", port: 0, siemAutoFlush: false });
    const { host, port } = await server.listen();
    let token: string | null = null;
    const client = createLocalTeamClient({
      serverUrl: () => `http://${host}:${port}`,
      token: () => token,
      fetch,
      networkCheck: () => undefined,
    });
    try {
      const owner = await client.setupOwner({
        name: "Ada",
        email: "ada@example.com",
        password: CONTRACT_PASSWORD,
      });
      expect(owner.ok).toBe(true);
      const session = await client.signIn({
        email: "ada@example.com",
        password: CONTRACT_PASSWORD,
      });
      if (!session.ok) throw new Error(session.error.message);
      token = session.data.token;
      const made = await fetch(`http://${host}:${port}/v1/teams`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ name: "Design" }),
      });
      expect(made.status).toBeLessThan(300);
      const teams = await client.teams();
      if (!teams.ok) throw new Error(teams.error.message);
      const id = teams.data[0]!.id;
      const board = await client.leaderboard(id, { period: "week" });
      expect(board).toMatchObject({ ok: true, data: { enabled: true, me: { visible: true } } });
      expect((await client.showOnLeaderboard(id, false)).ok).toBe(true);
      const after = await client.leaderboard(id, { period: "all" });
      expect(after).toMatchObject({ ok: true, data: { ranks: [], me: { visible: false } } });
    } finally {
      await server.close();
    }
  });
});
