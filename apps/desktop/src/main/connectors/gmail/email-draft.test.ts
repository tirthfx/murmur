import { describe, expect, it } from "vitest";
import {
  DEFAULT_GMAIL_SETTINGS,
  GMAIL_SCOPE_COMPOSE,
  GMAIL_SCOPE_READ,
  type GmailSettings,
  type Meeting,
  type MeetingSummary,
  type Task,
} from "@murmur/shared";
import { openDatabase } from "../../db/database";
import { ConnectorError } from "../connector-service";
import { createConnectorStore } from "../connector-store";
import { createAutomationsStore } from "./automations-store";
import { createEmailDraftService, summaryText } from "./email-draft";

const task = (over: Partial<Task> = {}): Task => ({
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
  ...over,
});

const meeting = (over: Partial<Meeting> = {}): Meeting =>
  ({
    id: "m1",
    title: "Budget sync",
    attendees: [
      { name: "Dana Lee", email: "dana@example.com" },
      { name: "Sam Roy", email: "sam@example.com" },
      { name: "Me", email: "me@example.com" },
    ],
    ...over,
  }) as Meeting;

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
    settings?: Partial<GmailSettings>;
    scopes?: string[];
    status?: "connected" | "needs_attention" | "disabled";
    noAccount?: boolean;
    generate?: (request: { system: string; prompt: string }) => Promise<string>;
    fetch?: (url: string, init?: RequestInit) => Promise<Response>;
    tasks?: Task[];
    summaries?: MeetingSummary[];
  } = {},
) {
  const db = openDatabase(":memory:");
  const connectorStore = createConnectorStore(db);
  if (!options.noAccount) {
    connectorStore.upsertAccount({
      id: "a1",
      connector: "gmail",
      email: "me@example.com",
      scopes: options.scopes ?? ["openid", "email", GMAIL_SCOPE_COMPOSE],
      at: 1,
    });
    if (options.status && options.status !== "connected")
      connectorStore.setStatus("a1", options.status, "x");
  }
  const store = createAutomationsStore(db);
  const requests: { url: string; init?: RequestInit | undefined }[] = [];
  const prompts: { system: string; prompt: string }[] = [];
  let id = 0;
  const service = createEmailDraftService({
    connectors: {
      list: () => connectorStore.list(),
      authorizedFetch: async (_account, url, init) => {
        requests.push({ url, init });
        return (
          options.fetch?.(url, init) ??
          new Response(JSON.stringify({ id: "r1", message: { id: "m9" } }), { status: 200 })
        );
      },
    },
    settings: () => ({ ...DEFAULT_GMAIL_SETTINGS, draftEnabled: true, ...options.settings }),
    store,
    tasks: { get: (taskId) => (options.tasks ?? [task()]).find((t) => t.id === taskId) ?? null },
    meetings: { get: (meetingId) => (meetingId === "m1" ? meeting() : null) },
    summaries: {
      list: () => options.summaries ?? [summary("## Decisions\n- Ship it [12:34](seg:abc)")],
    },
    generate: async (request) => {
      prompts.push(request);
      return (
        options.generate?.(request) ??
        '{"subject":"Budget numbers","body":"Hi Dana,\\n\\nHere are the numbers."}'
      );
    },
    now: () => 1000,
    newId: () => `auto-${++id}`,
  });
  return { service, store, requests, prompts, db, connectorStore };
}

describe("email draft state (NT-27)", () => {
  it("is available with the account connected, the scope given and drafting on", () => {
    expect(setup().service.state()).toEqual({ available: true, reason: null });
  });

  it("says why it is not available", () => {
    expect(setup({ settings: { draftEnabled: false } }).service.state().reason).toMatch(
      /Drafting is off/,
    );
    expect(setup({ noAccount: true }).service.state().reason).toMatch(/Connect Gmail/);
    expect(setup({ status: "needs_attention" }).service.state().reason).toMatch(/connected again/);
    expect(setup({ scopes: ["openid", "email", GMAIL_SCOPE_READ] }).service.state().reason).toMatch(
      /permission to create drafts/,
    );
  });
});

describe("proposing a draft", () => {
  it("writes subject and body with the model and picks the task owner from the people invited", async () => {
    const t = setup();
    const result = await t.service.propose({ kind: "task", id: "t1" });
    expect(result).toMatchObject({
      ok: true,
      proposal: {
        to: "dana@example.com",
        subject: "Budget numbers",
        accountEmail: "me@example.com",
        accountId: "a1",
      },
    });
    if (!result.ok) throw new Error("unreachable");
    // The owner's own address is not offered as a recipient.
    expect(result.proposal.candidates.map((c) => c.email)).toEqual([
      "dana@example.com",
      "sam@example.com",
    ]);
    expect(t.prompts[0]!.prompt).toContain("Task: Send the budget");
    expect(t.prompts[0]!.prompt).toContain("Write to: Dana");
    expect(t.prompts[0]!.system).toMatch(/never add a link/);
    expect(t.requests).toEqual([]);
  });

  it("leaves the recipient empty when the owner's name fits nobody or two people", async () => {
    const t = setup({ tasks: [task({ owner: "Pat" })] });
    const result = await t.service.propose({ kind: "task", id: "t1" });
    expect(result.ok && result.proposal.to).toBe("");
  });

  it("writes a recap from the latest summary, without its citation marks", async () => {
    const t = setup({
      summaries: [
        summary("## Old\n- Old text", 1),
        summary("## New\n- Ship it [12:34](seg:abc)", 2),
      ],
    });
    const result = await t.service.propose({ kind: "meeting", id: "m1" });
    expect(result.ok).toBe(true);
    const prompt = t.prompts[0]!.prompt;
    expect(prompt).toContain("New\n- Ship it");
    expect(prompt).not.toContain("seg:");
    expect(prompt).not.toContain("Old text");
  });

  it("starts from a plain draft when the model fails or answers badly", async () => {
    for (const generate of [
      async () => {
        throw new Error("no model");
      },
      async () => "not json at all",
      async () => '{"subject":"","body":"x"}',
    ]) {
      const result = await setup({ generate }).service.propose({ kind: "task", id: "t1" });
      expect(result).toMatchObject({
        ok: true,
        proposal: { subject: "Follow-up: Send the budget" },
      });
      if (!result.ok) throw new Error("unreachable");
      expect(result.proposal.body).toContain("Hi Dana,");
      expect(result.proposal.body).toContain("Send the budget");
    }
  });

  it("strips control characters and line breaks from what the model wrote", async () => {
    const t = setup({
      generate: async () => '{"subject":"Hi\\r\\nBcc: x@example.com","body":"Body\\u0000 text"}',
    });
    const result = await t.service.propose({ kind: "task", id: "t1" });
    expect(result.ok && result.proposal.subject).toBe("Hi Bcc: x@example.com");
    expect(result.ok && result.proposal.body).toBe("Body text");
  });

  it("refuses when drafting is not available, and for a task or a meeting that is gone", async () => {
    expect(
      (
        await setup({ settings: { draftEnabled: false } }).service.propose({
          kind: "task",
          id: "t1",
        })
      ).ok,
    ).toBe(false);
    expect(await setup().service.propose({ kind: "task", id: "nope" })).toEqual({
      ok: false,
      message: "That task is gone.",
    });
    expect(await setup().service.propose({ kind: "meeting", id: "nope" })).toEqual({
      ok: false,
      message: "That meeting is gone.",
    });
    expect(await setup({ summaries: [] }).service.propose({ kind: "meeting", id: "m1" })).toEqual({
      ok: false,
      message: "This meeting has no summary to write from yet.",
    });
  });
});

describe("creating a draft", () => {
  const input = {
    source: { kind: "task" as const, id: "t1" },
    accountId: "a1",
    to: "dana@example.com",
    subject: "Budget numbers",
    body: "Hi Dana,\n\nHere are the numbers.",
  };

  it("creates exactly one draft with the reviewed text, records it, and sends nothing", async () => {
    const t = setup();
    const result = await t.service.create(input);
    expect(result).toEqual({
      ok: true,
      automationId: "auto-1",
      draftId: "r1",
      openUrl: "https://mail.google.com/mail/u/me%40example.com/#drafts?compose=m9",
    });
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0]!.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    expect(t.requests.some((r) => /send/i.test(r.url))).toBe(false);
    const raw = (JSON.parse(String(t.requests[0]!.init?.body)) as { message: { raw: string } })
      .message.raw;
    const mime = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
    expect(mime).toContain("To: dana@example.com");
    expect(mime).toContain("Subject: Budget numbers");
    expect(t.service.list({ kind: "task", id: "t1" })).toHaveLength(1);
    expect(t.service.list({ kind: "task", id: "t1" })[0]).toMatchObject({
      draftId: "r1",
      to: "dana@example.com",
    });
  });

  it("makes a draft with no recipient when none is given", async () => {
    const t = setup();
    expect((await t.service.create({ ...input, to: "" })).ok).toBe(true);
  });

  it("refuses an address that is not one address, text outside the limits, and an unknown account", async () => {
    const t = setup();
    expect((await t.service.create({ ...input, to: "a@example.com, b@example.com" })).ok).toBe(
      false,
    );
    expect((await t.service.create({ ...input, subject: "" })).ok).toBe(false);
    expect((await t.service.create({ ...input, accountId: "zzz" })).ok).toBe(false);
    expect((await t.service.create({ ...input, extra: 1 })).ok).toBe(false);
    expect(t.requests).toEqual([]);
  });

  it("makes no request when drafting is off, the permission is missing, or the account is disconnected", async () => {
    for (const options of [
      { settings: { draftEnabled: false } },
      { scopes: ["openid", "email", GMAIL_SCOPE_READ] },
      { status: "disabled" as const },
    ]) {
      const t = setup(options);
      expect((await t.service.create(input)).ok).toBe(false);
      expect(t.requests).toEqual([]);
    }
  });

  it("says so when the task is gone, and records nothing when Gmail refuses", async () => {
    const t = setup({ fetch: async () => new Response("{}", { status: 403 }) });
    expect(await t.service.create({ ...input, source: { kind: "task", id: "nope" } })).toEqual({
      ok: false,
      message: "That task is gone.",
    });
    const refused = await t.service.create(input);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.message).toMatch(/permission to create drafts/);
    expect(t.service.list({ kind: "task", id: "t1" })).toEqual([]);
  });

  it("reports a sign-in that stopped working and a network failure plainly", async () => {
    const needs = setup({
      fetch: async () => {
        throw new ConnectorError("needs-attention", "Connect again.");
      },
    });
    expect(await needs.service.create(input)).toEqual({ ok: false, message: "Connect again." });
    const down = setup({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await down.service.create(input)).toEqual({
      ok: false,
      message: "Murmur could not reach Gmail. Nothing was created.",
    });
  });

  it("keeps the record after Gmail is disconnected, and the action is then unavailable", async () => {
    const t = setup();
    await t.service.create(input);
    t.connectorStore.remove("a1");
    expect(t.service.list({ kind: "task", id: "t1" })).toHaveLength(1);
    expect(t.service.state().available).toBe(false);
  });
});

describe("summaryText", () => {
  it("drops headings marks, citations and the no-source note", () => {
    expect(summaryText("## Decisions\n* Ship [1:02](seg:x)\n- Wait (No source)")).toBe(
      "Decisions\n- Ship\n- Wait",
    );
  });
});
