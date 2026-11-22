import { describe, expect, it } from "vitest";
import { DEFAULT_CONNECTOR_SETTINGS, type ConnectorSettings } from "@murmur/shared";
import { openDatabase } from "../../db/database";
import { ConnectorError } from "../connector-service";
import { createConnectorStore } from "../connector-store";
import { createConnectorData, DATA_TICK_MS } from "./connector-data";

const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), init);
const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const MIN = 60_000;

type Handler = (
  url: URL,
  init: RequestInit | undefined,
  account: string,
) => Response | Promise<Response>;

function setup(
  options: {
    settings?: Partial<ConnectorSettings>;
    handler?: Handler;
    accounts?: { id: string; connector: string; email: string }[];
  } = {},
) {
  const db = openDatabase(":memory:");
  const store = createConnectorStore(db);
  for (const account of options.accounts ?? [{ id: "s1", connector: "slack", email: "acme/dana" }])
    store.upsertAccount({ ...account, scopes: [], at: 1 });
  let now = Date.UTC(2026, 10, 22, 12, 0);
  const requests: { url: URL; account: string; init?: RequestInit | undefined }[] = [];
  const timers: (() => void)[] = [];
  const settings: ConnectorSettings = { ...DEFAULT_CONNECTOR_SETTINGS, ...options.settings };
  const data = createConnectorData({
    connectors: {
      list: () => store.list(),
      authorizedFetch: async (account, url, init) => {
        const parsed = new URL(url);
        requests.push({ url: parsed, account, init });
        if (!options.handler) throw new Error(`unexpected ${url}`);
        return options.handler(parsed, init, account);
      },
    },
    connectorStore: store,
    settings: () => settings,
    now: () => now,
    logger,
    sleep: async () => undefined,
    setTimer: (run) => {
      timers.push(run);
      return { clear: () => undefined };
    },
  });
  return {
    data,
    store,
    requests,
    timers,
    settings,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const slackHandler: Handler = (url) => {
  const path = url.pathname.replace("/api/", "");
  if (path === "conversations.list")
    return json({
      ok: true,
      channels: [
        { id: "C1", name: "alpha" },
        { id: "C2", name: "beta" },
      ],
    });
  if (path === "users.list") return json({ ok: true, members: [{ id: "U1", name: "dana" }] });
  return json({
    ok: true,
    messages: [
      { ts: "1700000000.1", user: "U1", text: `hello from ${url.searchParams.get("channel")}` },
    ],
  });
};

describe("connector data (CN-05 to CN-08)", () => {
  it("reads only the selected Slack channels, keeps what it read and lists it", async () => {
    const t = setup({
      handler: slackHandler,
      settings: { slack: { channels: ["C2"] } },
    });
    expect(await t.data.refresh("s1")).toEqual({ ok: true, count: 1 });
    const history = t.requests.filter((r) => r.url.pathname.endsWith("conversations.history"));
    expect(history.map((r) => r.url.searchParams.get("channel"))).toEqual(["C2"]);
    expect(t.data.items().map((i) => [i.id, i.title, i.text])).toEqual([
      ["C2:1700000000.1", "#beta", "hello from C2"],
    ]);
    expect(t.data.status()).toEqual([
      { accountId: "s1", itemCount: 1, readAt: expect.any(Number) },
    ]);
    expect(t.store.get("s1")!.lastSyncAt).not.toBeNull();
  });

  it("asks Slack about no channel when none is selected", async () => {
    const t = setup({ handler: slackHandler });
    expect(await t.data.refresh("s1")).toEqual({ ok: true, count: 0 });
    expect(t.requests).toEqual([]);
  });

  it("stops showing a channel the owner deselected, before the next read", async () => {
    const t = setup({ handler: slackHandler, settings: { slack: { channels: ["C1", "C2"] } } });
    await t.data.refresh("s1");
    expect(t.data.items()).toHaveLength(2);
    t.settings.slack = { channels: ["C1"] };
    expect(t.data.items().map((i) => i.id.split(":")[0])).toEqual(["C1"]);
  });

  it("sends each request to its own provider's address with its own account's token", async () => {
    const t = setup({
      accounts: [
        { id: "s1", connector: "slack", email: "acme/dana" },
        { id: "n1", connector: "notion", email: "acme" },
        { id: "l1", connector: "linear", email: "me@example.com" },
        { id: "g1", connector: "github", email: "octocat" },
      ],
      settings: { slack: { channels: ["C1"] }, github: { repos: ["acme/app"] } },
      handler: (url, _init, account) => {
        if (account === "s1") return slackHandler(url, undefined, account);
        if (account === "n1")
          return url.pathname.endsWith("/search") ? json({ results: [] }) : json({ results: [] });
        if (account === "l1") return json({ data: { viewer: { assignedIssues: { nodes: [] } } } });
        return json([]);
      },
    });
    for (const id of ["s1", "n1", "l1", "g1"]) expect((await t.data.refresh(id)).ok).toBe(true);
    const origins: Record<string, string> = {
      s1: "https://slack.com",
      n1: "https://api.notion.com",
      l1: "https://api.linear.app",
      g1: "https://api.github.com",
    };
    expect(t.requests.length).toBeGreaterThan(4);
    for (const request of t.requests) expect(request.url.origin).toBe(origins[request.account]);
  });

  it("asks GitHub only about the selected repositories, and a 304 changes nothing", async () => {
    let calls = 0;
    const t = setup({
      accounts: [{ id: "g1", connector: "github", email: "octocat" }],
      settings: { github: { repos: ["acme/app"] } },
      handler: (_url, init) => {
        calls++;
        return new Headers(init?.headers).get("if-none-match") === 'W/"e"'
          ? new Response(null, { status: 304 })
          : json(
              [
                {
                  number: 1,
                  title: "Bug",
                  state: "open",
                  html_url: "https://github.com/acme/app/issues/1",
                  updated_at: "2026-11-20T00:00:00Z",
                },
              ],
              { headers: { etag: 'W/"e"' } },
            );
      },
    });
    await t.data.refresh("g1");
    const first = t.data.items();
    expect(first).toHaveLength(1);
    expect(t.requests.every((r) => r.url.pathname.startsWith("/repos/acme/app/"))).toBe(true);
    const before = calls;
    t.advance(31 * MIN);
    expect(await t.data.refresh("g1")).toEqual({ ok: true, count: 1 });
    expect(calls).toBe(before * 2);
    expect(t.data.items()).toEqual(first);
    // Taking the repository out of the selection hides it at once.
    t.settings.github = { repos: [] };
    expect(t.data.items()).toEqual([]);
  });

  it("shows a closed issue as closed after the next read", async () => {
    let state = "In Progress";
    const t = setup({
      accounts: [{ id: "l1", connector: "linear", email: "me@example.com" }],
      handler: () =>
        json({
          data: {
            viewer: {
              assignedIssues: {
                nodes: [
                  {
                    id: "i1",
                    identifier: "ENG-1",
                    title: "Fix",
                    state: { name: state },
                    team: { key: "ENG" },
                  },
                ],
              },
            },
          },
        }),
    });
    await t.data.refresh("l1");
    expect(t.data.items()[0]!.tags).toContain("In Progress");
    state = "Done";
    t.advance(31 * MIN);
    await t.data.refresh("l1");
    expect(t.data.items()[0]!.tags).toContain("Done");
  });

  it("drops what it kept when it is older than the lifetime", async () => {
    const t = setup({ handler: slackHandler, settings: { slack: { channels: ["C1"] } } });
    await t.data.refresh("s1");
    expect(t.data.items()).toHaveLength(1);
    // Slack's interval is 30 minutes, so what is read is kept for 60.
    t.advance(59 * MIN);
    expect(t.data.items()).toHaveLength(1);
    t.advance(2 * MIN);
    expect(t.data.items()).toEqual([]);
    expect(t.data.status()[0]).toMatchObject({ itemCount: 0, readAt: null });
  });

  it("says why a read failed in plain words, and keeps what it had", async () => {
    let fail = false;
    const t = setup({
      handler: (url, init, account) =>
        fail ? json({ ok: false, error: "invalid_auth" }) : slackHandler(url, init, account),
      settings: { slack: { channels: ["C1"] } },
    });
    await t.data.refresh("s1");
    fail = true;
    expect(await t.data.refresh("s1")).toEqual({
      ok: false,
      message: "Slack no longer accepts this sign-in. Connect again.",
    });
    expect(t.data.items()).toHaveLength(1);
  });

  it("reports a sign-in that needs attention, a network failure and an account that is not there", async () => {
    const stale = setup({
      handler: () => {
        throw new ConnectorError("needs-attention", "Connect again.");
      },
      settings: { slack: { channels: ["C1"] } },
    });
    expect(await stale.data.refresh("s1")).toEqual({ ok: false, message: "Connect again." });
    const down = setup({
      handler: () => {
        throw new TypeError("fetch failed");
      },
      settings: { slack: { channels: ["C1"] } },
    });
    expect(await down.data.refresh("s1")).toEqual({
      ok: false,
      message: "Slack could not be read.",
    });
    expect(await down.data.refresh("zzz")).toEqual({
      ok: false,
      message: "That account is not here.",
    });
    down.store.setStatus("s1", "disabled", null);
    expect(await down.data.refresh("s1")).toEqual({
      ok: false,
      message: "That account is not connected.",
    });
  });

  it("reads one account once at a time", async () => {
    const t = setup({ handler: slackHandler, settings: { slack: { channels: ["C1"] } } });
    const [a, b] = await Promise.all([t.data.refresh("s1"), t.data.refresh("s1")]);
    expect(a).toEqual(b);
    expect(t.requests.filter((r) => r.url.pathname.endsWith("conversations.history"))).toHaveLength(
      1,
    );
  });

  it("reads the accounts that are due by their interval, and not the others", async () => {
    const t = setup({
      accounts: [
        { id: "s1", connector: "slack", email: "acme/dana" },
        { id: "s2", connector: "slack", email: "other/dana" },
        { id: "s3", connector: "slack", email: "third/dana" },
      ],
      handler: slackHandler,
      settings: { slack: { channels: ["C1"] } },
    });
    // s1 never read, s2 read ten minutes ago, s3 disabled.
    t.store.setLastSync("s2", Date.UTC(2026, 10, 22, 11, 50));
    t.store.setStatus("s3", "disabled", null);
    await t.data.syncDue();
    expect(new Set(t.requests.map((r) => r.account))).toEqual(new Set(["s1"]));
    t.advance(25 * MIN);
    t.requests.length = 0;
    await t.data.syncDue();
    expect(new Set(t.requests.map((r) => r.account))).toEqual(new Set(["s2"]));
  });

  it("starts a schedule that looks every minute, and reads once now", async () => {
    const t = setup({ handler: slackHandler, settings: { slack: { channels: ["C1"] } } });
    t.data.start();
    t.data.start();
    expect(t.timers).toHaveLength(1);
    await Promise.resolve();
    expect(DATA_TICK_MS).toBe(60_000);
    t.data.stop();
  });

  it("offers the channels and teams to choose from, and nothing for the others", async () => {
    const slack = setup({ handler: slackHandler });
    expect(await slack.data.options("s1")).toEqual({
      ok: true,
      options: [
        { id: "C1", label: "#alpha" },
        { id: "C2", label: "#beta" },
      ],
    });
    const linear = setup({
      accounts: [{ id: "l1", connector: "linear", email: "me@example.com" }],
      handler: () => json({ data: { teams: { nodes: [{ id: "T1", name: "Eng", key: "ENG" }] } } }),
    });
    expect(await linear.data.options("l1")).toEqual({
      ok: true,
      options: [{ id: "T1", label: "Eng (ENG)" }],
    });
    const notion = setup({ accounts: [{ id: "n1", connector: "notion", email: "acme" }] });
    expect((await notion.data.options("n1")).ok).toBe(false);
    expect((await notion.data.options("zzz")).ok).toBe(false);
  });
});
