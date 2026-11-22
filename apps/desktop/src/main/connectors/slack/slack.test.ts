import { describe, expect, it } from "vitest";
import { SLACK_SCOPES } from "@murmur/shared";
import { ReadError } from "../data/http";
import { listChannels, readMessages, slackProvider, slackText } from "./slack";

const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), init);
const limits = (sleeps: number[] = []) => ({
  sleep: async (ms: number) => {
    sleeps.push(ms);
  },
});

function fake(handlers: Record<string, (query: URLSearchParams) => Response>) {
  const urls: string[] = [];
  const fetch = async (url: string): Promise<Response> => {
    urls.push(url);
    const parsed = new URL(url);
    const handler = handlers[parsed.pathname.replace("/api/", "")];
    if (!handler) throw new Error(`unexpected call ${url}`);
    return handler(parsed.searchParams);
  };
  return { fetch, urls };
}

const users = () =>
  json({
    ok: true,
    members: [
      { id: "U1", name: "dana", real_name: "Dana Lee" },
      { id: "U2", name: "sam" },
      { id: "U3", name: "gone", deleted: true },
    ],
  });

describe("Slack provider (CN-05)", () => {
  it("asks for read scopes only, as user scopes, on a fixed port", () => {
    expect(slackProvider.scopes).toEqual([...SLACK_SCOPES]);
    expect(slackProvider.scopes.join(" ")).not.toMatch(/chat:write|:write/);
    expect(slackProvider.scopeParam).toBe("user_scope");
    expect(slackProvider.scopeSeparator).toBe(",");
    expect(slackProvider.loopbackPort).toBe(17821);
  });

  it("reads the user's token from a first sign-in and from a renewal, and refuses a failed answer", () => {
    expect(
      slackProvider.parseTokenResponse!({
        ok: true,
        authed_user: { access_token: "xoxp-1", scope: "users:read,channels:read" },
      }),
    ).toEqual({
      accessToken: "xoxp-1",
      refreshToken: null,
      expiresIn: null,
      scopes: ["users:read", "channels:read"],
    });
    expect(
      slackProvider.parseTokenResponse!({
        ok: true,
        access_token: "xoxp-2",
        refresh_token: "r",
        expires_in: 43200,
      }),
    ).toMatchObject({ accessToken: "xoxp-2", refreshToken: "r", expiresIn: 43200 });
    expect(slackProvider.parseTokenResponse!({ ok: false, error: "bad_code" })).toBeNull();
    expect(slackProvider.parseTokenResponse!({ nope: 1 })).toBeNull();
  });

  it("names the account by workspace and user", async () => {
    const label = await slackProvider.accountLabel({
      token: { accessToken: "t", refreshToken: null, expiresIn: null, scopes: [] },
      http: async () => json({ ok: true, user: "dana", team: "Acme" }),
    });
    expect(label).toBe("Acme/dana");
  });
});

describe("slackText", () => {
  it("turns mentions, channels and links into plain text", () => {
    const names = new Map([["U1", "Dana Lee"]]);
    expect(
      slackText(
        "Hi <@U1> and <@U9>, see <#C1|general> <https://x.test/a|the doc> <https://y.test> &lt;b&gt; <!here>",
        names,
      ),
    ).toBe("Hi @Dana Lee and @someone, see #general the doc https://y.test <b> @channel");
  });
});

describe("listChannels", () => {
  it("lists public channels across pages, sorted, and asks for nothing private", async () => {
    const t = fake({
      "conversations.list": (q) =>
        q.get("cursor")
          ? json({ ok: true, channels: [{ id: "C1", name: "alpha" }] })
          : json({
              ok: true,
              channels: [{ id: "C2", name: "zeta" }],
              response_metadata: { next_cursor: "next" },
            }),
    });
    const options = await listChannels({ fetch: t.fetch, limits: limits() });
    expect(options).toEqual([
      { id: "C1", label: "#alpha" },
      { id: "C2", label: "#zeta" },
    ]);
    expect(t.urls.every((url) => new URL(url).searchParams.get("types") === "public_channel")).toBe(
      true,
    );
  });
});

describe("readMessages", () => {
  const message = (ts: string, text: string, extra: Record<string, unknown> = {}) => ({
    ts,
    user: "U1",
    text,
    ...extra,
  });

  it("reads only the selected channels, with names resolved and notices left out", async () => {
    const t = fake({
      "users.list": users,
      "conversations.history": () =>
        json({
          ok: true,
          messages: [
            message("1700000100.000100", "Ship it <@U2>"),
            message("1700000050.000100", "joined", { subtype: "channel_join" }),
            message("1700000010.000100", "   "),
          ],
        }),
    });
    const items = await readMessages({
      fetch: t.fetch,
      limits: limits(),
      channels: [{ id: "C1", label: "#alpha" }],
      sinceMs: 1_700_000_000_000,
    });
    expect(items).toEqual([
      {
        id: "C1:1700000100.000100",
        connector: "slack",
        kind: "message",
        title: "#alpha",
        text: "Ship it @sam",
        truncated: false,
        updatedAt: 1_700_000_100_000,
        url: null,
        tags: ["Dana Lee"],
      },
    ]);
    const history = t.urls.filter((url) => url.includes("conversations.history"));
    expect(history).toHaveLength(1);
    expect(new URL(history[0]!).searchParams.get("channel")).toBe("C1");
    expect(new URL(history[0]!).searchParams.get("oldest")).toBe("1700000000");
  });

  it("asks about nothing when no channel is selected", async () => {
    const t = fake({});
    expect(
      await readMessages({ fetch: t.fetch, limits: limits(), channels: [], sinceMs: 0 }),
    ).toEqual([]);
    expect(t.urls).toEqual([]);
  });

  it("cuts a long message and says so", async () => {
    const t = fake({
      "users.list": users,
      "conversations.history": () =>
        json({ ok: true, messages: [message("1.1", "x".repeat(2000))] }),
    });
    const [item] = await readMessages({
      fetch: t.fetch,
      limits: limits(),
      channels: [{ id: "C1", label: "#a" }],
      sinceMs: 0,
    });
    expect(item!.text).toHaveLength(1000);
    expect(item!.truncated).toBe(true);
  });

  it("waits out a rate limit as long as Slack asks and reads again without losing the channel", async () => {
    let tries = 0;
    const sleeps: number[] = [];
    const t = fake({
      "users.list": users,
      "conversations.history": () =>
        ++tries < 3
          ? new Response("{}", { status: 429, headers: { "retry-after": "2" } })
          : json({ ok: true, messages: [message("5.5", "hello")] }),
    });
    const items = await readMessages({
      fetch: t.fetch,
      limits: limits(sleeps),
      channels: [{ id: "C1", label: "#a" }],
      sinceMs: 0,
    });
    expect(items).toHaveLength(1);
    expect(sleeps).toEqual([2000, 2000]);
  });

  it("gives up with plain words when Slack stays busy or asks for too long", async () => {
    const busy = fake({
      "users.list": users,
      "conversations.history": () =>
        new Response("{}", { status: 429, headers: { "retry-after": "1" } }),
    });
    await expect(
      readMessages({
        fetch: busy.fetch,
        limits: limits(),
        channels: [{ id: "C1", label: "#a" }],
        sinceMs: 0,
      }),
    ).rejects.toThrow("Slack is busy just now");
    const long = fake({
      "users.list": () => new Response("{}", { status: 429, headers: { "retry-after": "600" } }),
    });
    await expect(
      readMessages({
        fetch: long.fetch,
        limits: limits(),
        channels: [{ id: "C1", label: "#a" }],
        sinceMs: 0,
      }),
    ).rejects.toBeInstanceOf(ReadError);
  });

  it("explains the refusals the owner can fix", async () => {
    for (const [error, text] of [
      ["invalid_auth", /no longer accepts/],
      ["missing_scope", /permission to read/],
      ["not_in_channel", /cannot be read/],
      ["something_else", /could not be read/],
    ] as const) {
      const t = fake({ "users.list": () => json({ ok: false, error }) });
      await expect(
        readMessages({
          fetch: t.fetch,
          limits: limits(),
          channels: [{ id: "C1", label: "#a" }],
          sinceMs: 0,
        }),
      ).rejects.toThrow(text);
    }
  });
});
