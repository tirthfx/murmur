import { describe, expect, it } from "vitest";
import { SLACK_SCOPES, type SlackUser } from "@murmur/shared";
import { ReadError } from "../data/http";
import {
  listChannels,
  listSlackUsers,
  matchMention,
  postSlackMessage,
  readMessages,
  resolveMentions,
  slackProvider,
  slackText,
} from "./slack";

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
      ["not_in_channel", /cannot be used/],
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

const user = (id: string, over: Partial<SlackUser> = {}): SlackUser => ({
  id,
  name: id.toLowerCase(),
  realName: null,
  displayName: null,
  email: null,
  ...over,
});

const people: SlackUser[] = [
  user("U1", {
    name: "dana",
    realName: "Dana Lee",
    displayName: "dana",
    email: "dana@example.com",
  }),
  user("U2", {
    name: "sam",
    realName: "Sam Ortiz",
    displayName: "sam.o",
    email: "sam@example.com",
  }),
  user("U3", {
    name: "sam2",
    realName: "Sam Roy",
    displayName: "sam.r",
    email: "sam.roy@example.com",
  }),
  user("U4", { name: "priya", realName: "Priya Rao", displayName: "Priya" }),
];

describe("listSlackUsers", () => {
  it("lists people with their names and email, and leaves out bots and deactivated accounts", async () => {
    const t = fake({
      "users.list": () =>
        json({
          ok: true,
          members: [
            {
              id: "U1",
              name: "dana",
              profile: { real_name: "Dana Lee", display_name: "dana", email: "Dana@Example.com" },
            },
            { id: "B1", name: "bot", is_bot: true },
            { id: "U9", name: "gone", deleted: true },
            { id: "U2", name: "sam", real_name: "Sam Ortiz" },
          ],
        }),
    });
    expect(await listSlackUsers({ fetch: t.fetch, limits: limits() })).toEqual([
      {
        id: "U1",
        name: "dana",
        realName: "Dana Lee",
        displayName: "dana",
        email: "dana@example.com",
      },
      { id: "U2", name: "sam", realName: "Sam Ortiz", displayName: null, email: null },
    ]);
  });
});

describe("matchMention (CN-14)", () => {
  it("matches a person by email, by handle, display name or full name, ignoring spaces and punctuation", () => {
    expect(matchMention("dana@example.com", people)).toEqual({ kind: "one", user: people[0] });
    expect(matchMention("DANA", people)).toEqual({ kind: "one", user: people[0] });
    expect(matchMention("dana.lee", people)).toEqual({ kind: "one", user: people[0] });
    expect(matchMention("priya", people)).toEqual({ kind: "one", user: people[3] });
    expect(matchMention("sam.o", people)).toEqual({ kind: "one", user: people[1] });
  });

  it("uses a first name only when one person has it, and never guesses between two", () => {
    expect(matchMention("sam", people)).toEqual({ kind: "one", user: people[1] });
    const twoSams = people
      .filter((p) => p.id !== "U2")
      .concat(user("U5", { name: "sam5", realName: "Sam Kim", displayName: "samk" }));
    expect(matchMention("sam", twoSams)).toEqual({ kind: "several" });
    expect(matchMention("ghost", people)).toEqual({ kind: "none" });
    expect(matchMention("nobody@example.com", people)).toEqual({ kind: "none" });
  });
});

describe("resolveMentions (CN-14)", () => {
  it("turns each mention of exactly one person into a tag, and lists it", () => {
    const result = resolveMentions("Hi @dana and @priya, thanks.", people);
    expect(result.posted).toBe("Hi <@U1> and <@U4>, thanks.");
    expect(result.shown).toBe("Hi @Dana Lee and @Priya Rao, thanks.");
    expect(result.tags).toEqual([
      { mention: "@dana", userId: "U1", name: "Dana Lee" },
      { mention: "@priya", userId: "U4", name: "Priya Rao" },
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it("sends a mention that fits two people, or no one, as plain text and flags it", () => {
    const twoSams = [
      ...people.filter((p) => p.id !== "U2"),
      user("U5", { name: "s5", realName: "Sam Kim" }),
    ];
    const result = resolveMentions("@sam please, and @ghost too", twoSams);
    expect(result.posted).toBe("@sam please, and @ghost too");
    expect(result.tags).toEqual([]);
    expect(result.unresolved).toEqual([
      { mention: "@sam", reason: "several" },
      { mention: "@ghost", reason: "none" },
    ]);
  });

  it("tags a person once however often they are named, and leaves the punctuation after a name", () => {
    const result = resolveMentions("@dana. Then @dana again, @dana@example.com!", people);
    expect(result.posted).toBe("<@U1>. Then <@U1> again, <@U1>!");
    expect(result.tags).toHaveLength(1);
  });

  it("does not take part of a word or an address for a mention", () => {
    const result = resolveMentions("mail me at x@dana.com or dana@example.com", people);
    expect(result.posted).toBe("mail me at x@dana.com or dana@example.com");
    expect(result.tags).toEqual([]);
  });

  it("escapes Slack's characters, so typed text cannot become a link or a broadcast", () => {
    const result = resolveMentions("<!channel> <@U9|x> & <https://x.test|hi> @dana", people);
    expect(result.posted).toBe(
      "&lt;!channel&gt; &lt;@U9|x&gt; &amp; &lt;https://x.test|hi&gt; <@U1>",
    );
    expect(result.posted).not.toContain("<!channel>");
  });

  it("is plain escaped text, with no lookup, when tagging is off", () => {
    const result = resolveMentions("Hi @dana <b>", null);
    expect(result).toEqual({
      posted: "Hi @dana &lt;b&gt;",
      shown: "Hi @dana <b>",
      tags: [],
      unresolved: [],
    });
  });

  it("looks up at most the mentions it is allowed, and sends the rest as plain text", () => {
    const text = Array.from({ length: 5 }, (_, i) => `@user${i}`).join(" ");
    const result = resolveMentions(text, people, 2);
    expect(result.unresolved).toHaveLength(5);
  });
});

describe("postSlackMessage (CN-05)", () => {
  it("posts one message to one channel, with tags that notify only when they were in the text", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    await postSlackMessage({
      fetch: async (url, init) => {
        calls.push({ url, ...(init ? { init } : {}) });
        return json({ ok: true });
      },
      limits: limits(),
      channelId: "C1",
      text: "Hi <@U1>",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://slack.com/api/chat.postMessage");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      channel: "C1",
      text: "Hi <@U1>",
      link_names: false,
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  it("waits out a rate limit and sends the same message again, without losing it", async () => {
    const bodies: string[] = [];
    const sleeps: number[] = [];
    let tries = 0;
    await postSlackMessage({
      fetch: async (_url, init) => {
        bodies.push(String(init?.body));
        return ++tries < 3
          ? new Response("{}", { status: 429, headers: { "retry-after": "3" } })
          : json({ ok: true });
      },
      limits: limits(sleeps),
      channelId: "C1",
      text: "Hello",
    });
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies).size).toBe(1);
    expect(sleeps).toEqual([3000, 3000]);
  });

  it("explains what went wrong in plain words", async () => {
    const ask = (error: string) =>
      postSlackMessage({
        fetch: async () => json({ ok: false, error }),
        limits: limits(),
        channelId: "C1",
        text: "x",
      });
    await expect(ask("not_in_channel")).rejects.toThrow(/Join it in Slack/);
    await expect(ask("is_archived")).rejects.toThrow(/archived/);
    await expect(ask("missing_scope")).rejects.toThrow(/permission/);
    await expect(ask("msg_too_long")).rejects.toThrow(/too long/);
    await expect(ask("restricted_action")).rejects.toThrow(/does not let you post/);
  });
});
