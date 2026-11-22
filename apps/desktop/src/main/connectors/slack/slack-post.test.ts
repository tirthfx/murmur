import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONNECTOR_SETTINGS,
  SLACK_SCOPE_WRITE,
  type ConnectorAccount,
  type ConnectorSettings,
  type Meeting,
  type MeetingSummary,
  type Task,
} from "@murmur/shared";
import { ConnectorError } from "../connector-service";
import { PREVIEW_MS, createSlackPost } from "./slack-post";

const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), init);
const NOW = 1_000_000;

const account = (over: Partial<ConnectorAccount> = {}): ConnectorAccount => ({
  id: "s1",
  connector: "slack",
  email: "acme/dana",
  scopes: ["users:read", SLACK_SCOPE_WRITE],
  status: "connected",
  statusReason: null,
  lastSyncAt: null,
  createdAt: 1,
  ...over,
});

const task: Task = {
  id: "t1",
  title: "Send the budget",
  notes: "Use the Q4 numbers.",
  owner: "Dana Lee",
  ownerIsMe: false,
  dueOn: "2026-11-27",
  status: "open",
  source: "meeting",
  meetingId: "m1",
  meetingTitle: "Budget sync",
  sourceSegmentId: null,
  sourceState: "none",
  position: 0,
  createdAt: 1,
  updatedAt: 1,
  completedAt: null,
};

const summary = (markdown: string, version = 1): MeetingSummary => ({
  id: `s${version}`,
  meetingId: "m1",
  version,
  skillId: "k",
  skillName: "General",
  modelId: "x",
  quick: false,
  markdown,
  createdAt: 1,
  feedback: null,
});

function setup(
  options: {
    accounts?: ConnectorAccount[];
    readOnly?: boolean;
    tagging?: boolean;
    post?: () => Response | Promise<Response>;
  } = {},
) {
  const requests: { url: URL; body: Record<string, unknown> | null }[] = [];
  let now = NOW;
  let ids = 0;
  const settings: ConnectorSettings = {
    ...DEFAULT_CONNECTOR_SETTINGS,
    choices: { slack: { syncIntervalMinutes: 30, readOnly: options.readOnly ?? false } },
  };
  const service = createSlackPost({
    connectors: {
      list: () => options.accounts ?? [account()],
      authorizedFetch: async (_id, url, init) => {
        const parsed = new URL(url);
        requests.push({ url: parsed, body: init?.body ? JSON.parse(String(init.body)) : null });
        if (parsed.pathname.endsWith("conversations.list"))
          return json({
            ok: true,
            channels: [
              { id: "C1", name: "general" },
              { id: "C2", name: "finance" },
            ],
          });
        if (parsed.pathname.endsWith("users.list"))
          return json({
            ok: true,
            members: [
              { id: "U1", name: "dana", profile: { real_name: "Dana Lee", display_name: "dana" } },
              { id: "U2", name: "sam.o", profile: { real_name: "Sam Ortiz" } },
              { id: "U3", name: "sam3", profile: { real_name: "Sam Roy" } },
            ],
          });
        return options.post?.() ?? json({ ok: true });
      },
    },
    settings: () => ({ connectors: settings, tagging: options.tagging ?? false }),
    tasks: { get: (id) => (id === "t1" ? task : null) },
    meetings: {
      get: (id) => (id === "m1" ? ({ id: "m1", title: "Budget sync" } as Meeting) : null),
    },
    summaries: { list: () => [summary("## Decisions\n- Cut travel [1:02](seg:x)")] },
    now: () => now,
    newId: () => `tok-${++ids}`,
    sleep: async () => undefined,
  });
  const posts = () => requests.filter((r) => r.url.pathname.endsWith("chat.postMessage"));
  return { service, requests, posts, advance: (ms: number) => (now += ms) };
}

const input = (text: string, channelId = "C2") => ({
  source: { kind: "task", id: "t1" },
  channelId,
  text,
});

describe("Send to Slack (CN-05)", () => {
  describe("state", () => {
    it("is available with Slack connected, read only off and the permission given", () => {
      expect(setup().service.state()).toEqual({ available: true, reason: null });
    });

    it("says why it is not", () => {
      expect(setup({ accounts: [] }).service.state().reason).toMatch(/Connect Slack/);
      expect(
        setup({ accounts: [account({ status: "needs_attention" })] }).service.state().reason,
      ).toMatch(/connected again/);
      expect(setup({ readOnly: true }).service.state().reason).toMatch(/read only/);
      expect(
        setup({ accounts: [account({ scopes: ["users:read"] })] }).service.state().reason,
      ).toMatch(/permission to post/);
    });
  });

  describe("starting a message", () => {
    it("writes a start from a task or a summary, lists the channels, and sends nothing", async () => {
      const t = setup();
      const fromTask = await t.service.start({ kind: "task", id: "t1" });
      expect(fromTask).toEqual({
        ok: true,
        start: {
          text: "Task: Send the budget (Dana Lee), due 2026-11-27\nUse the Q4 numbers.\nFrom the meeting “Budget sync”",
          channels: [
            { id: "C2", label: "#finance" },
            { id: "C1", label: "#general" },
          ],
          accountEmail: "acme/dana",
        },
      });
      const fromMeeting = await t.service.start({ kind: "meeting", id: "m1" });
      expect(fromMeeting.ok && fromMeeting.start.text).toBe(
        "Budget sync\n\nDecisions\n- Cut travel",
      );
      expect(t.posts()).toEqual([]);
    });

    it("refuses when it is not available, and for a task or meeting that is gone", async () => {
      expect((await setup({ readOnly: true }).service.start({ kind: "task", id: "t1" })).ok).toBe(
        false,
      );
      expect(await setup().service.start({ kind: "task", id: "nope" })).toEqual({
        ok: false,
        message: "That task is gone.",
      });
      expect(await setup().service.start({ kind: "meeting", id: "nope" })).toEqual({
        ok: false,
        message: "That meeting is gone.",
      });
    });
  });

  describe("the preview", () => {
    it("shows the channel and the exact text, and sends nothing", async () => {
      const t = setup();
      const result = await t.service.prepare(input("Budget is ready & shared <now>"));
      expect(result).toMatchObject({
        ok: true,
        preview: {
          token: "tok-1",
          channelLabel: "#finance",
          accountEmail: "acme/dana",
          shown: "Budget is ready & shared <now>",
          tags: [],
          unresolved: [],
          taggingOn: false,
        },
      });
      expect(t.posts()).toEqual([]);
    });

    it("reads no people and tags no one while the tagging option is off", async () => {
      const t = setup({ tagging: false });
      const result = await t.service.prepare(input("Hi @dana"));
      expect(result.ok && result.preview.tags).toEqual([]);
      expect(t.requests.some((r) => r.url.pathname.endsWith("users.list"))).toBe(false);
    });

    it("lists every tag, and the mentions that stay plain text, when the option is on", async () => {
      const t = setup({ tagging: true });
      const result = await t.service.prepare(input("Hi @dana and @sam, ask @ghost"));
      expect(result).toMatchObject({
        ok: true,
        preview: {
          taggingOn: true,
          shown: "Hi @Dana Lee and @sam, ask @ghost",
          tags: [{ mention: "@dana", userId: "U1", name: "Dana Lee" }],
          unresolved: [
            { mention: "@sam", reason: "several" },
            { mention: "@ghost", reason: "none" },
          ],
        },
      });
    });

    it("refuses an unknown channel, an empty message and text over the limit", async () => {
      const t = setup();
      expect((await t.service.prepare(input("Hi", "C9"))).ok).toBe(false);
      expect((await t.service.prepare(input(""))).ok).toBe(false);
      expect((await t.service.prepare(input("x".repeat(3001)))).ok).toBe(false);
      expect((await t.service.prepare({ ...input("Hi"), extra: 1 })).ok).toBe(false);
    });
  });

  describe("sending", () => {
    it("posts exactly the previewed message, once, to the previewed channel", async () => {
      const t = setup({ tagging: true });
      const prepared = await t.service.prepare(input("Hi @dana & <team>"));
      if (!prepared.ok) throw new Error("not prepared");
      const sent = await t.service.send({ token: prepared.preview.token });
      expect(sent).toEqual({ ok: true, channelLabel: "#finance" });
      expect(t.posts()).toHaveLength(1);
      expect(t.posts()[0]!.body).toMatchObject({
        channel: "C2",
        text: "Hi <@U1> &amp; &lt;team&gt;",
      });
      // The same preview cannot be sent twice.
      expect(await t.service.send({ token: prepared.preview.token })).toMatchObject({ ok: false });
      expect(t.posts()).toHaveLength(1);
    });

    it("cannot post anything that was not previewed: only a token is accepted", async () => {
      const t = setup();
      for (const raw of [
        { token: "nope" },
        { text: "Hi", channelId: "C1" },
        { token: "tok-1", text: "changed" },
        null,
        "x",
      ])
        expect((await t.service.send(raw)).ok).toBe(false);
      expect(t.posts()).toEqual([]);
    });

    it("does not post when the preview has expired, or Slack is no longer allowed", async () => {
      const t = setup();
      const prepared = await t.service.prepare(input("Hi"));
      if (!prepared.ok) throw new Error("not prepared");
      t.advance(PREVIEW_MS + 1);
      expect(await t.service.send({ token: prepared.preview.token })).toEqual({
        ok: false,
        message: "That preview has expired. Preview the message again.",
      });
      expect(t.posts()).toEqual([]);
    });

    it("keeps the preview when Slack fails, so it can be tried again, and says why", async () => {
      let fail = true;
      const t = setup({
        post: () => (fail ? json({ ok: false, error: "not_in_channel" }) : json({ ok: true })),
      });
      const prepared = await t.service.prepare(input("Hi"));
      if (!prepared.ok) throw new Error("not prepared");
      const first = await t.service.send({ token: prepared.preview.token });
      expect(!first.ok && first.message).toMatch(/Join it in Slack/);
      fail = false;
      expect(await t.service.send({ token: prepared.preview.token })).toMatchObject({ ok: true });
    });

    it("reports a sign-in that stopped working and a network failure plainly", async () => {
      const stale = setup({
        post: () => {
          throw new ConnectorError("needs-attention", "Connect again.");
        },
      });
      const a = await stale.service.prepare(input("Hi"));
      if (!a.ok) throw new Error("x");
      expect(await stale.service.send({ token: a.preview.token })).toEqual({
        ok: false,
        message: "Connect again.",
      });
      const down = setup({
        post: () => {
          throw new TypeError("fetch failed");
        },
      });
      const b = await down.service.prepare(input("Hi"));
      if (!b.ok) throw new Error("x");
      expect(await down.service.send({ token: b.preview.token })).toEqual({
        ok: false,
        message: "Slack could not be reached. Nothing was sent.",
      });
    });

    it("sends only to Slack's own address", async () => {
      const t = setup({ tagging: true });
      const prepared = await t.service.prepare(input("Hi @dana"));
      if (!prepared.ok) throw new Error("x");
      await t.service.send({ token: prepared.preview.token });
      expect(t.requests.every((r) => r.url.origin === "https://slack.com")).toBe(true);
    });
  });
});
