import { describe, expect, it } from "vitest";
import {
  CALENDAR_WRITE_SCOPES,
  DEFAULT_AUTOMATIONS_SETTINGS,
  DEFAULT_CONNECTOR_SETTINGS,
  type ConnectorSettings,
  type Meeting,
  type Task,
} from "@murmur/shared";
import { openDatabase } from "../../db/database";
import { ConnectorError } from "../connector-service";
import { createConnectorStore } from "../connector-store";
import { createAutomationsStore } from "../gmail/automations-store";
import { createEventCreateService, isCalendarOpenUrl } from "./event-create";
import { createGoogleEvent } from "./google-calendar";
import { createOutlookEvent } from "./outlook-calendar";

const NOW = new Date(2026, 10, 22, 10, 0).getTime();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Review the budget",
  notes: "Bring the Q4 numbers.",
  owner: null,
  ownerIsMe: true,
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

const meeting = {
  id: "m1",
  title: "Budget sync",
  attendees: [
    { name: "Dana Lee", email: "dana@example.com" },
    { name: "Me", email: "me@example.com" },
  ],
} as Meeting;

function setup(
  options: {
    connector?: "googleCalendar" | "outlookCalendar";
    scopes?: string[];
    readOnly?: boolean;
    sendInvites?: boolean;
    noAccount?: boolean;
    status?: "connected" | "needs_attention";
    tasks?: Task[];
    fetch?: (url: string, init?: RequestInit) => Response | Promise<Response>;
  } = {},
) {
  const connector = options.connector ?? "googleCalendar";
  const db = openDatabase(":memory:");
  const connectors = createConnectorStore(db);
  if (!options.noAccount) {
    connectors.upsertAccount({
      id: "c1",
      connector,
      email: "me@example.com",
      scopes: options.scopes ?? ["openid", "email", CALENDAR_WRITE_SCOPES[connector]!],
      at: 1,
    });
    if (options.status === "needs_attention") connectors.setStatus("c1", "needs_attention", "x");
  }
  const settings: ConnectorSettings = {
    ...DEFAULT_CONNECTOR_SETTINGS,
    choices: {
      [connector]: { syncIntervalMinutes: 15, readOnly: options.readOnly ?? false },
    },
  };
  const requests: { url: string; init?: RequestInit | undefined }[] = [];
  const created: string[] = [];
  let id = 0;
  const service = createEventCreateService({
    connectors: {
      list: () => connectors.list(),
      authorizedFetch: async (_account, url, init) => {
        requests.push({ url, init });
        return (
          (await options.fetch?.(url, init)) ??
          json(
            connector === "googleCalendar"
              ? { id: "ev1", htmlLink: "https://www.google.com/calendar/event?eid=abc" }
              : { id: "ev1", webLink: "https://outlook.office.com/calendar/item/abc" },
            200,
          )
        );
      },
    },
    settings: () => ({
      connectors: settings,
      automations: {
        createEvent: {
          ...DEFAULT_AUTOMATIONS_SETTINGS.createEvent,
          sendInvites: options.sendInvites ?? false,
        },
      },
    }),
    store: createAutomationsStore(db),
    tasks: { get: (taskId) => (options.tasks ?? [task()]).find((t) => t.id === taskId) ?? null },
    meetings: { get: (meetingId) => (meetingId === "m1" ? meeting : null) },
    now: () => NOW,
    newId: () => `auto-${++id}`,
    onCreated: (accountId) => created.push(accountId),
  });
  return { service, requests, created, connectors };
}

const input = {
  source: { kind: "task" as const, id: "t1" },
  accountId: "c1",
  title: "Review the budget",
  startMs: new Date(2026, 10, 27, 9, 0).getTime(),
  durationMinutes: 30,
  attendees: ["dana@example.com"],
  description: "Bring the numbers.",
  sendInvites: false,
};

describe("create event state (NT-28)", () => {
  it("is available with a calendar connected, read only off and the permission given", () => {
    expect(setup().service.state()).toEqual({ available: true, reason: null });
  });

  it("says why it is not available", () => {
    expect(setup({ noAccount: true }).service.state().reason).toMatch(/Connect a calendar/);
    expect(setup({ status: "needs_attention" }).service.state().reason).toMatch(/connected again/);
    expect(setup({ readOnly: true }).service.state().reason).toMatch(/read only/);
    expect(setup({ scopes: ["openid", "email"] }).service.state().reason).toMatch(
      /permission to create events/,
    );
  });

  it("accepts Microsoft's scope however it is written", () => {
    const t = setup({
      connector: "outlookCalendar",
      scopes: ["https://graph.microsoft.com/Calendars.ReadWrite", "User.Read"],
    });
    expect(t.service.state().available).toBe(true);
  });
});

describe("proposing an event", () => {
  it("proposes a task's due morning with the default length and the people invited, not the owner", async () => {
    const t = setup();
    const result = await t.service.propose({ kind: "task", id: "t1" });
    expect(result).toMatchObject({
      ok: true,
      proposal: {
        title: "Review the budget",
        startMs: new Date(2026, 10, 27, 9, 0).getTime(),
        durationMinutes: 30,
        accountId: "c1",
        accountEmail: "me@example.com",
        connector: "googleCalendar",
        invitesAllowed: false,
        candidates: [{ name: "Dana Lee", email: "dana@example.com" }],
      },
    });
    if (!result.ok) throw new Error("unreachable");
    expect(result.proposal.description).toBe(
      "Bring the Q4 numbers.\n\nFrom the meeting “Budget sync”",
    );
    expect(t.requests).toEqual([]);
  });

  it("proposes tomorrow morning for a task with no due day, or one that has passed, and for a meeting", async () => {
    const tomorrow = new Date(2026, 10, 23, 9, 0).getTime();
    for (const [over, source] of [
      [{ dueOn: null }, { kind: "task" as const, id: "t1" }],
      [{ dueOn: "2026-11-01" }, { kind: "task" as const, id: "t1" }],
      [{}, { kind: "meeting" as const, id: "m1" }],
    ] as const) {
      const result = await setup({ tasks: [task(over)] }).service.propose(source);
      expect(result.ok && result.proposal.startMs).toBe(tomorrow);
    }
    const recap = await setup().service.propose({ kind: "meeting", id: "m1" });
    expect(recap.ok && recap.proposal.title).toBe("Follow-up: Budget sync");
  });

  it("refuses when it is not available, and for a task or meeting that is gone", async () => {
    expect((await setup({ readOnly: true }).service.propose({ kind: "task", id: "t1" })).ok).toBe(
      false,
    );
    expect(await setup().service.propose({ kind: "task", id: "nope" })).toEqual({
      ok: false,
      message: "That task is gone.",
    });
    expect(await setup().service.propose({ kind: "meeting", id: "nope" })).toEqual({
      ok: false,
      message: "That meeting is gone.",
    });
  });
});

describe("creating an event", () => {
  it("creates one event after the confirmation, records it and says the calendar can be read again", async () => {
    const t = setup();
    const result = await t.service.create(input);
    expect(result).toEqual({
      ok: true,
      automationId: "auto-1",
      eventId: "ev1",
      openUrl: "https://www.google.com/calendar/event?eid=abc",
      invited: false,
    });
    expect(t.requests).toHaveLength(1);
    expect(t.requests[0]!.init?.method).toBe("POST");
    expect(t.created).toEqual(["c1"]);
    expect(t.service.list({ kind: "task", id: "t1" })[0]).toMatchObject({
      eventId: "ev1",
      title: "Review the budget",
      startMs: input.startMs,
    });
  });

  it("does not notify anyone with sendInvites off, even if the confirmation box is ticked", async () => {
    const t = setup({ sendInvites: false });
    const result = await t.service.create({ ...input, sendInvites: true });
    expect(result.ok && result.invited).toBe(false);
    expect(t.requests[0]!.url).toContain("sendUpdates=none");
  });

  it("does not notify anyone when the setting is on but the confirmation box is not ticked", async () => {
    const t = setup({ sendInvites: true });
    const result = await t.service.create({ ...input, sendInvites: false });
    expect(result.ok && result.invited).toBe(false);
    expect(t.requests[0]!.url).toContain("sendUpdates=none");
  });

  it("sends invitations only when the setting and the box are both on", async () => {
    const t = setup({ sendInvites: true });
    const result = await t.service.create({ ...input, sendInvites: true });
    expect(result.ok && result.invited).toBe(true);
    expect(t.requests[0]!.url).toContain("sendUpdates=all");
    expect(JSON.parse(String(t.requests[0]!.init?.body)).attendees).toEqual([
      { email: "dana@example.com" },
    ]);
  });

  it("makes no request when read only is on, the permission is missing, or the account needs attention", async () => {
    for (const options of [
      { readOnly: true },
      { scopes: ["openid", "email"] },
      { status: "needs_attention" as const },
    ]) {
      const t = setup(options);
      expect((await t.service.create(input)).ok).toBe(false);
      expect(t.requests).toEqual([]);
    }
  });

  it("refuses a start in the past, a bad address, an unknown account, extra fields and a gone source", async () => {
    const t = setup();
    const refused = [
      { ...input, startMs: NOW - 3_600_000 },
      { ...input, attendees: ["a@example.com, b@example.com"] },
      { ...input, attendees: ["nobody"] },
      { ...input, accountId: "zzz" },
      { ...input, title: " " },
      { ...input, durationMinutes: 1 },
      { ...input, extra: 1 },
      { ...input, source: { kind: "task", id: "nope" } },
    ];
    for (const attempt of refused) expect((await t.service.create(attempt)).ok).toBe(false);
    expect(t.requests).toEqual([]);
  });

  it("creates in Outlook with the time in UTC, and leaves the people off the event unless invited", async () => {
    const quiet = setup({ connector: "outlookCalendar" });
    const result = await quiet.service.create(input);
    expect(result).toMatchObject({
      ok: true,
      openUrl: "https://outlook.office.com/calendar/item/abc",
    });
    const body = JSON.parse(String(quiet.requests[0]!.init?.body));
    expect(quiet.requests[0]!.url).toBe("https://graph.microsoft.com/v1.0/me/events");
    expect(body.attendees).toBeUndefined();
    expect(body.body.content).toContain("To invite: dana@example.com");
    expect(body.start.timeZone).toBe("UTC");

    const loud = setup({ connector: "outlookCalendar", sendInvites: true });
    await loud.service.create({ ...input, sendInvites: true });
    expect(JSON.parse(String(loud.requests[0]!.init?.body)).attendees).toEqual([
      { emailAddress: { address: "dana@example.com" }, type: "required" },
    ]);
  });

  it("reports a refusal, a sign-in that stopped working, and a network failure plainly, recording nothing", async () => {
    const refused = setup({ fetch: () => json({}, 403) });
    const result = await refused.service.create(input);
    expect(!result.ok && result.message).toMatch(/permission to create events/);
    expect(refused.service.list({ kind: "task", id: "t1" })).toEqual([]);
    expect(refused.created).toEqual([]);

    const stale = setup({
      fetch: () => {
        throw new ConnectorError("needs-attention", "Connect again.");
      },
    });
    expect(await stale.service.create(input)).toEqual({ ok: false, message: "Connect again." });

    const down = setup({
      fetch: () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await down.service.create(input)).toEqual({
      ok: false,
      message: "Murmur could not reach the calendar. Nothing was created.",
    });
  });

  it("keeps the record after the account is disconnected, and the action is then unavailable", async () => {
    const t = setup();
    await t.service.create(input);
    t.connectors.remove("c1");
    expect(t.service.list({ kind: "task", id: "t1" })).toHaveLength(1);
    expect(t.service.state().available).toBe(false);
  });
});

describe("provider requests", () => {
  const base = {
    title: "T",
    startMs: 0,
    endMs: 1800000,
    description: "D",
    attendees: [],
    invite: false,
  };

  it("Google: a calendar address and plain times", async () => {
    const calls: string[] = [];
    await createGoogleEvent({
      ...base,
      fetch: async (url) => {
        calls.push(url);
        return json({ id: "e" });
      },
    });
    expect(calls[0]).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none",
    );
  });

  it("an unreadable answer or a refusal is a plain error", async () => {
    await expect(createGoogleEvent({ ...base, fetch: async () => json({ x: 1 }) })).rejects.toThrow(
      /cannot read/,
    );
    await expect(createGoogleEvent({ ...base, fetch: async () => json({}, 500) })).rejects.toThrow(
      "Google Calendar answered 500.",
    );
    await expect(createOutlookEvent({ ...base, fetch: async () => json({}, 500) })).rejects.toThrow(
      "Outlook answered 500.",
    );
    await expect(createOutlookEvent({ ...base, fetch: async () => json({}, 403) })).rejects.toThrow(
      /permission/,
    );
  });

  it("uses a calendar address that is https, and a fallback when the answer has none", async () => {
    expect(
      (
        await createGoogleEvent({
          ...base,
          fetch: async () => json({ id: "e", htmlLink: "javascript:x" }),
        })
      ).openUrl,
    ).toBe("https://calendar.google.com/calendar/");
    expect(
      (await createOutlookEvent({ ...base, fetch: async () => json({ id: "e", webLink: null }) }))
        .openUrl,
    ).toBe("https://outlook.office.com/calendar/");
  });
});

describe("isCalendarOpenUrl", () => {
  it("allows only the calendar services' own https addresses", () => {
    expect(isCalendarOpenUrl("https://www.google.com/calendar/event?eid=1")).toBe(true);
    expect(isCalendarOpenUrl("https://outlook.office.com/calendar/item/1")).toBe(true);
    for (const bad of [
      "http://www.google.com/calendar",
      "https://evil.example/calendar",
      "https://www.google.com.evil.example/",
      "file:///etc/passwd",
      "not a url",
    ])
      expect(isCalendarOpenUrl(bad)).toBe(false);
  });
});
