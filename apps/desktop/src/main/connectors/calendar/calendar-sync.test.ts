import { describe, expect, it, vi } from "vitest";
import {
  CALENDAR_WINDOW,
  DEFAULT_CONNECTOR_SETTINGS,
  type ConnectorSettings,
  type Keychain,
} from "@murmur/shared";
import { openDatabase } from "../../db/database";
import { createConnectorService } from "../connector-service";
import { createConnectorStore } from "../connector-store";
import { createConnectorRegistry } from "../providers";
import { createCalendarStore } from "./calendar-store";
import { CALENDAR_CONNECTORS, createCalendarSync, SYNC_TICK_MS } from "./calendar-sync";
import { googleCalendarProvider } from "./google-calendar";
import { outlookCalendarProvider } from "./outlook-calendar";

const { gmail, slack, notion, linear, github } = DEFAULT_CONNECTOR_SETTINGS;
const DEFAULT_CONNECTOR_SETTINGS_EXTRAS = { gmail, slack, notion, linear, github };

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 21, 9, 0);

class FakeKeychain implements Keychain {
  items = new Map<string, string>();
  async get(service: string, account: string) {
    return this.items.get(`${service}|${account}`) ?? null;
  }
  async set(service: string, account: string, value: string) {
    this.items.set(`${service}|${account}`, value);
  }
  async delete(service: string, account: string) {
    return this.items.delete(`${service}|${account}`);
  }
}

const googleItem = (id: string, start: string, over: object = {}) => ({
  id,
  status: "confirmed",
  summary: `Meeting ${id}`,
  start: { dateTime: start },
  end: { dateTime: new Date(Date.parse(start) + 30 * MIN).toISOString() },
  ...over,
});

/** The providers' servers: tokens, Google events, Graph events. Every request is recorded. */
class FakeProviders {
  requests: string[] = [];
  googleEvents: object[] = [];
  graphPages: object[] = [];
  grantRevoked = false;
  /** Access tokens that Google still accepts. */
  valid = new Set(["acc-1"]);
  eventCalls = 0;
  failEvents: number | null = null;
  private issued = 1;

  readonly http = async (url: string, init?: RequestInit): Promise<Response> => {
    await Promise.resolve();
    this.requests.push(url);
    const bearer = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "") ?? "";
    if (url === "https://oauth2.googleapis.com/token") {
      if (this.grantRevoked) return Response.json({ error: "invalid_grant" }, { status: 400 });
      const token = `acc-${++this.issued}`;
      this.valid.add(token);
      return Response.json({ access_token: token, expires_in: 3600 });
    }
    if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) {
      this.eventCalls++;
      if (!this.valid.has(bearer)) return new Response("no", { status: 401 });
      if (this.failEvents) return new Response("busy", { status: this.failEvents });
      return Response.json({ items: this.googleEvents });
    }
    if (url.startsWith("https://graph.microsoft.com/")) {
      if (bearer !== "graph-token") return new Response("no", { status: 401 });
      const page = this.graphPages.shift() ?? { value: [] };
      return Response.json(page);
    }
    return new Response("not found", { status: 404 });
  };
}

function setup(over: { settings?: ConnectorSettings } = {}) {
  const db = openDatabase(":memory:");
  const connectorStore = createConnectorStore(db);
  const store = createCalendarStore(db);
  const keychain = new FakeKeychain();
  const providers = new FakeProviders();
  let now = NOW;
  const warnings: string[] = [];
  const logger = { info: vi.fn(), warn: (m: string) => warnings.push(m), error: vi.fn() };
  const connectors = createConnectorService({
    registry: createConnectorRegistry([googleCalendarProvider, outlookCalendarProvider]),
    store: connectorStore,
    keychain,
    config: { clientId: () => "client-1", clientSecret: async () => "secret-1" },
    http: providers.http,
    openExternal: async () => undefined,
    now: () => now,
    newId: () => "unused",
    logger,
  });
  const addAccount = (
    id: string,
    connector: string,
    email: string,
    token: string,
    refresh: string | null,
  ) => {
    connectorStore.upsertAccount({ id, connector, email, scopes: [], at: 1 });
    keychain.items.set(
      `com.murmur.connector.${connector}|${email}`,
      JSON.stringify({
        accessToken: token,
        refreshToken: refresh,
        expiresAt: now + 3_600_000,
        scopes: [],
      }),
    );
  };
  addAccount("g1", "googleCalendar", "me@example.com", "acc-1", "ref-1");
  const onChange = vi.fn();
  const timers: { run: () => void; ms: number; cleared: boolean }[] = [];
  const sync = createCalendarSync({
    connectors,
    connectorStore,
    store,
    settings: () => over.settings ?? DEFAULT_CONNECTOR_SETTINGS,
    now: () => now,
    logger,
    onChange,
    setTimer: (run, ms) => {
      const timer = { run, ms, cleared: false };
      timers.push(timer);
      return { clear: () => (timer.cleared = true) };
    },
  });
  return {
    db,
    connectorStore,
    store,
    providers,
    connectors,
    sync,
    onChange,
    timers,
    warnings,
    addAccount,
    advance: (ms: number) => (now += ms),
    now: () => now,
  };
}

describe("calendar sync (CN-02, CN-03)", () => {
  it("keeps the events of the next 7 days, from a day ago, and notes when it last synced", async () => {
    const t = setup();
    t.providers.googleEvents = [
      googleItem("e1", "2026-11-21T10:00:00Z"),
      googleItem("e2", "2026-11-25T14:00:00Z"),
    ];
    expect(await t.sync.syncAccount("g1")).toEqual({ ok: true, count: 2 });
    const url = new URL(t.providers.requests.find((u) => u.includes("/events"))!);
    expect(url.searchParams.get("timeMin")).toBe(
      new Date(NOW - CALENDAR_WINDOW.pastMs).toISOString(),
    );
    expect(url.searchParams.get("timeMax")).toBe(
      new Date(NOW + CALENDAR_WINDOW.aheadMs).toISOString(),
    );
    expect(t.store.list({ from: NOW - 1e9, to: NOW + 1e10 }).map((e) => e.id)).toEqual([
      "e1",
      "e2",
    ]);
    expect(t.connectorStore.get("g1")?.lastSyncAt).toBe(NOW);
    expect(t.onChange).toHaveBeenCalledTimes(1);
  });

  it("a later sync refreshes them: a moved event moves, a deleted one goes", async () => {
    const t = setup();
    t.providers.googleEvents = [
      googleItem("e1", "2026-11-21T10:00:00Z"),
      googleItem("e2", "2026-11-22T10:00:00Z"),
    ];
    await t.sync.syncAccount("g1");
    t.advance(15 * MIN);
    t.providers.googleEvents = [googleItem("e1", "2026-11-21T16:00:00Z", { summary: "Moved" })];
    await t.sync.syncAccount("g1");
    const events = t.store.list({ from: NOW - 1e9, to: NOW + 1e10 });
    expect(events.map((e) => [e.id, e.title, e.startMs])).toEqual([
      ["e1", "Moved", Date.UTC(2026, 10, 21, 16)],
    ]);
  });

  it("reads Outlook through Graph with the token it holds, and follows its pages", async () => {
    const t = setup();
    t.addAccount("o1", "outlookCalendar", "me@work.example", "graph-token", "r");
    const graph = (id: string) => ({
      id,
      subject: `Call ${id}`,
      start: { dateTime: "2026-11-21T18:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-11-21T18:30:00.0000000", timeZone: "UTC" },
      onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/x" },
    });
    t.providers.graphPages = [
      {
        value: [graph("o-a")],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=2",
      },
      { value: [graph("o-b")] },
    ];
    expect(await t.sync.syncAccount("o1")).toEqual({ ok: true, count: 2 });
    expect(t.store.list({ from: NOW - 1e9, to: NOW + 1e10 }).map((e) => [e.id, e.joinUrl])).toEqual(
      [
        ["o-a", "https://teams.microsoft.com/l/meetup-join/x"],
        ["o-b", "https://teams.microsoft.com/l/meetup-join/x"],
      ],
    );
  });

  it("makes the account need attention when the grant was revoked, within one sync interval", async () => {
    const t = setup();
    t.providers.googleEvents = [googleItem("e1", "2026-11-21T10:00:00Z")];
    await t.sync.syncAccount("g1");
    // The owner revokes the app at Google: the refresh token and the access token both stop.
    t.providers.grantRevoked = true;
    t.providers.valid.clear();
    t.advance(15 * MIN);
    await t.sync.syncDue();
    expect(t.connectorStore.get("g1")).toMatchObject({
      status: "needs_attention",
      statusReason: "Google Calendar no longer accepts this sign-in. Connect again.",
    });
    // Its events are no longer offered to reminders, and it is not asked again.
    expect(t.store.list({ from: NOW - 1e9, to: NOW + 1e10 })).toEqual([]);
    const calls = t.providers.eventCalls;
    t.advance(15 * MIN);
    await t.sync.syncDue();
    expect(t.providers.eventCalls).toBe(calls);
    expect(await t.sync.syncAccount("g1")).toMatchObject({
      ok: false,
      message: expect.stringContaining("no longer accepts"),
    });
  });

  it("sends nothing anywhere but the provider: the token and the sync reach only its hosts", async () => {
    const t = setup();
    t.addAccount("o1", "outlookCalendar", "me@work.example", "graph-token", "r");
    t.providers.googleEvents = [
      googleItem("e1", "2026-11-21T10:00:00Z", { summary: "Secret merger talks" }),
    ];
    await t.sync.syncAccount("g1");
    await t.sync.syncAccount("o1");
    // A renewal of the token goes to the provider's token address too.
    t.providers.valid.clear();
    await t.sync.syncAccount("g1");
    const hosts = new Set(t.providers.requests.map((u) => new URL(u).host));
    expect([...hosts].sort()).toEqual([
      "graph.microsoft.com",
      "oauth2.googleapis.com",
      "www.googleapis.com",
    ]);
    expect(t.warnings.join("\n")).not.toContain("merger");
  });

  it("keeps the events it has when the provider does not answer, and says why", async () => {
    const t = setup();
    t.providers.googleEvents = [googleItem("e1", "2026-11-21T10:00:00Z")];
    await t.sync.syncAccount("g1");
    t.providers.failEvents = 503;
    t.advance(15 * MIN);
    expect(await t.sync.syncAccount("g1")).toEqual({
      ok: false,
      message: "Google Calendar answered 503.",
    });
    expect(t.store.count("g1")).toBe(1);
    // Not a reason to ask the owner to connect again.
    expect(t.connectorStore.get("g1")?.status).toBe("connected");
    expect(t.connectorStore.get("g1")?.lastSyncAt).toBe(NOW);
  });

  it("refuses an account that is gone, off, or not a calendar, and syncs one account once at a time", async () => {
    const t = setup();
    expect(await t.sync.syncAccount("nope")).toEqual({
      ok: false,
      message: "That account is gone.",
    });
    t.addAccount("x1", "gmail", "me@example.com", "t", "r");
    expect(await t.sync.syncAccount("x1")).toEqual({
      ok: false,
      message: "That account is not a calendar.",
    });
    t.connectors.setEnabled("g1", false);
    expect(await t.sync.syncAccount("g1")).toEqual({
      ok: false,
      message: "That account is turned off.",
    });
    t.connectors.setEnabled("g1", true);
    t.providers.googleEvents = [googleItem("e1", "2026-11-21T10:00:00Z")];
    const [a, b] = await Promise.all([t.sync.syncAccount("g1"), t.sync.syncAccount("g1")]);
    expect(a).toEqual(b);
    expect(t.providers.eventCalls).toBe(1);
  });

  it("syncs an account when it is due: never synced, or its interval has passed", async () => {
    const t = setup();
    t.providers.googleEvents = [googleItem("e1", "2026-11-21T10:00:00Z")];
    await t.sync.syncDue();
    expect(t.providers.eventCalls).toBe(1);
    t.advance(14 * MIN);
    await t.sync.syncDue();
    expect(t.providers.eventCalls).toBe(1);
    t.advance(1 * MIN);
    await t.sync.syncDue();
    expect(t.providers.eventCalls).toBe(2);
  });

  it("uses the interval the owner chose for a connector, and leaves other connectors alone", async () => {
    const t = setup({
      settings: {
        cacheTtlMinutes: 15,
        choices: { googleCalendar: { syncIntervalMinutes: 60, readOnly: true } },
        ...DEFAULT_CONNECTOR_SETTINGS_EXTRAS,
      },
    });
    t.addAccount("x1", "gmail", "me@example.com", "t", "r");
    t.providers.googleEvents = [googleItem("e1", "2026-11-21T10:00:00Z")];
    await t.sync.syncDue();
    t.advance(59 * MIN);
    await t.sync.syncDue();
    expect(t.providers.eventCalls).toBe(1);
    t.advance(1 * MIN);
    await t.sync.syncDue();
    expect(t.providers.eventCalls).toBe(2);
    // Gmail is not a calendar: it was never asked.
    expect(t.providers.requests.some((u) => u.includes("gmail"))).toBe(false);
    expect(CALENDAR_CONNECTORS).toEqual(["googleCalendar", "outlookCalendar"]);
  });

  it("looks for due accounts once when it starts and then every minute, and stops", async () => {
    const t = setup();
    t.providers.googleEvents = [googleItem("e1", "2026-11-21T10:00:00Z")];
    t.sync.start();
    t.sync.start();
    expect(t.timers).toHaveLength(1);
    expect(t.timers[0]!.ms).toBe(SYNC_TICK_MS);
    await vi.waitFor(() => expect(t.providers.eventCalls).toBe(1));
    t.advance(15 * MIN);
    t.timers[0]!.run();
    await vi.waitFor(() => expect(t.providers.eventCalls).toBe(2));
    t.sync.stop();
    expect(t.timers[0]!.cleared).toBe(true);
  });

  it("disconnecting removes the account's events with it", async () => {
    const t = setup();
    t.providers.googleEvents = [googleItem("e1", "2026-11-21T10:00:00Z")];
    await t.sync.syncAccount("g1");
    expect(t.store.count("g1")).toBe(1);
    await t.connectors.disconnect("g1");
    expect(t.store.count("g1")).toBe(0);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM calendar_events").get()).toEqual({ n: 0 });
  });
});
