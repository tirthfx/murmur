import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EffectivePolicy, InsightsDay, Keychain, TeamView } from "@murmur/shared";
import {
  createLocalServer,
  type LocalServer,
} from "../../../../../services/local-server/src/server.ts";
import { createSharedVocabulary } from "./shared-vocabulary";
import { TEAM_KEYCHAIN, createTeamService, type TeamService } from "./team-service";
import type { UsageMeeting } from "./usage-reporter";

/**
 * The team service against the real local server on a free port: the contract between the app and
 * the server is tested from both ends at once.
 */
const PASSWORD = "a long enough password";
let server: LocalServer;
let base = "";
let clock = 1_000_000_000_000;

interface Rig {
  service: TeamService;
  file: { text: string | null };
  keys: Map<string, string>;
  vocabulary: ReturnType<typeof createSharedVocabulary>;
  views: TeamView[];
  idle: { seconds: number };
  days: { value: InsightsDay[] };
  meetings: { value: UsageMeeting[] };
  ticks: (() => void)[];
  refuse: { host: string | null };
  policies: { value: EffectivePolicy[] };
}

function rig(existing?: { file: { text: string | null }; keys: Map<string, string> }): Rig {
  const file = existing?.file ?? { text: null };
  const keys = existing?.keys ?? new Map<string, string>();
  const keychain: Keychain = {
    get: async (service, account) => keys.get(`${service}/${account}`) ?? null,
    set: async (service, account, value) => void keys.set(`${service}/${account}`, value),
    delete: async (service, account) => keys.delete(`${service}/${account}`),
  };
  const vocabulary = createSharedVocabulary();
  const views: TeamView[] = [];
  const idle = { seconds: 0 };
  const days = { value: [] as InsightsDay[] };
  const meetings = { value: [] as UsageMeeting[] };
  const ticks: (() => void)[] = [];
  const refuse = { host: null as string | null };
  const policies = { value: [] as EffectivePolicy[] };
  const service = createTeamService({
    readFile: () => file.text,
    writeFile: (text) => (file.text = text),
    keychain,
    fetch: (url, init) => fetch(url, init),
    now: () => clock,
    idleSeconds: () => idle.seconds,
    networkCheck: (url) => {
      if (refuse.host && new URL(url).hostname === refuse.host)
        throw new Error("strict local mode");
    },
    vocabulary,
    policy: { setTeam: (list) => (policies.value = [...list]) },
    insights: { days: () => days.value },
    meetings: { list: () => meetings.value },
    onChange: (view) => views.push(view),
    setInterval: (handler) => {
      ticks.push(handler);
      return ticks.length;
    },
    clearInterval: () => undefined,
  });
  return { service, file, keys, vocabulary, views, idle, days, meetings, ticks, refuse, policies };
}

// Responses are read loosely on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function api(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Json) : null };
}

beforeEach(async () => {
  clock = 1_000_000_000_000;
  server = createLocalServer({
    dbPath: ":memory:",
    port: 0,
    now: () => clock,
    siemAutoFlush: false,
  });
  const { host, port } = await server.listen();
  base = `http://${host}:${port}`;
});
afterEach(() => server.close());

/** A connected, signed-in owner with a team that has shared entries. */
async function seeded() {
  const r = rig();
  expect((await r.service.connect({ serverUrl: base })).ok).toBe(true);
  expect(r.service.view().serverSetUp).toBe(false);
  const set = await r.service.setup({ name: "Ada", email: "ada@example.com", password: PASSWORD });
  expect(set.ok).toBe(true);
  const token = r.keys.get(`${TEAM_KEYCHAIN.service}/${TEAM_KEYCHAIN.account}`)!;
  const team = (await api("POST", "/v1/teams", token, { name: "Acme" })).json!["id"] as string;
  await api("POST", `/v1/teams/${team}/dictionary`, token, {
    term: "Acme",
    replacement: "Acme Inc.",
    scope: "company",
  });
  await api("POST", `/v1/teams/${team}/dictionary`, token, { term: "Murmur", scope: "company" });
  await api("POST", `/v1/teams/${team}/snippets`, token, {
    trigger: "sig",
    expansion: "Best, {{me}} of {{team}}",
    scope: "company",
  });
  return { r, token, team };
}

describe("connecting and signing in", () => {
  it("connects to a server, finds that it has no owner, and makes the owner", async () => {
    const r = rig();
    expect(r.service.view()).toMatchObject({ enabled: false, state: "off" });
    const connected = await r.service.connect({ serverUrl: `127.0.0.1:${new URL(base).port}` });
    expect(connected).toMatchObject({
      ok: true,
      view: { enabled: true, state: "signed_out", serverSetUp: false },
    });
    const made = await r.service.setup({
      name: "Ada",
      email: "Ada@Example.com",
      password: PASSWORD,
    });
    expect(made.ok && made.view).toMatchObject({
      state: "signed_in",
      user: { name: "Ada", email: "ada@example.com" },
    });
    expect(r.keys.get(`${TEAM_KEYCHAIN.service}/${TEAM_KEYCHAIN.account}`)).toMatch(/^mst_/);
  });

  it("keeps no token and no password in the file on disk", async () => {
    const { r, token } = await seeded();
    expect(r.file.text).not.toContain(token);
    expect(r.file.text).not.toContain(PASSWORD);
    expect(r.file.text).not.toMatch(/mst_/);
    expect(JSON.parse(r.file.text!)).toMatchObject({
      enabled: true,
      user: { email: "ada@example.com" },
    });
  });

  it("says so when the address is not a team server, or cannot be reached", async () => {
    const r = rig();
    expect(await r.service.connect({ serverUrl: "not a url at all %%" })).toMatchObject({
      ok: false,
    });
    expect(await r.service.connect({ serverUrl: "ftp://127.0.0.1" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("http"),
    });
    const closed = await r.service.connect({ serverUrl: "http://127.0.0.1:1" });
    expect(closed).toEqual({ ok: false, message: "Could not reach the team server." });
    // A failed connect leaves team mode off.
    expect(r.service.view().enabled).toBe(false);
    const other = await r.service.connect({ serverUrl: `${base}/v1/nothing-here` });
    expect(other.ok).toBe(true); // the origin is what counts
  });

  it("refuses a server on the network in strict local mode, but not one on this Mac", async () => {
    const r = rig();
    r.refuse.host = "192.168.1.9";
    const result = await r.service.connect({ serverUrl: "http://192.168.1.9:7830" });
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining("strict local mode"),
    });
    expect((await r.service.connect({ serverUrl: base })).ok).toBe(true);
  });

  it("signs in with the right password, and says why not with the wrong one", async () => {
    const { r } = await seeded();
    await r.service.signOut();
    expect(r.service.view()).toMatchObject({ state: "signed_out", user: null, teams: [] });
    expect(r.keys.size).toBe(0);
    expect(
      await r.service.signIn({ email: "ada@example.com", password: "wrong wrong wrong" }),
    ).toEqual({
      ok: false,
      message: "The email or the password is not right.",
    });
    const ok = await r.service.signIn({ email: "ada@example.com", password: PASSWORD });
    expect(ok.ok && ok.view.state).toBe("signed_in");
  });

  it("passes on the wait after five wrong passwords", async () => {
    const { r } = await seeded();
    await r.service.signOut();
    for (let i = 0; i < 5; i++)
      await r.service.signIn({ email: "ada@example.com", password: "wrong wrong wrong" });
    const delayed = await r.service.signIn({ email: "ada@example.com", password: PASSWORD });
    expect(delayed).toMatchObject({ ok: false, retryAfterSeconds: 30 });
  });
});

describe("the shared dictionary and snippets", () => {
  it("are pulled when signed in, and counted", async () => {
    const { r } = await seeded();
    await r.service.syncNow();
    expect(r.service.view()).toMatchObject({
      teams: [{ name: "Acme", myRole: "owner" }],
      sharedCounts: { dictionary: 2, snippets: 1 },
      syncProblem: "",
    });
    expect(r.service.view().lastSyncAt).toBe(clock);
    const rules = r.vocabulary.rules({
      promptTerms: [],
      starredCount: 0,
      spellings: [],
      replacements: [],
    });
    expect(rules.replacements.map((x) => x.replacement)).toEqual(["Acme Inc."]);
    expect(rules.spellings.map((x) => x.term)).toEqual(["Murmur"]);
    expect(r.vocabulary.snippets([])[0]).toMatchObject({
      trigger: "sig",
      plain: "Best, Ada of Acme",
    });
  });

  it("reach dictation at the next sync after an admin adds an entry, and no sooner than that", async () => {
    const { r, token, team } = await seeded();
    await r.service.syncNow();
    await api("POST", `/v1/teams/${team}/dictionary`, token, {
      term: "Zeta",
      replacement: "ζ",
      scope: "company",
    });
    expect(r.vocabulary.counts().dictionary).toBe(2);
    await r.service.syncNow();
    expect(r.vocabulary.counts().dictionary).toBe(3);
    // The timer does the same by itself.
    await api("POST", `/v1/teams/${team}/dictionary`, token, { term: "Eta", scope: "company" });
    r.ticks[1]!();
    await vi.waitFor(() => expect(r.vocabulary.counts().dictionary).toBe(4));
  });

  it("keep working from the last copy when the server cannot be reached, and say so", async () => {
    const { r } = await seeded();
    await r.service.syncNow();
    await server.close();
    await r.service.syncNow();
    expect(r.vocabulary.counts()).toEqual({ dictionary: 2, snippets: 1 });
    expect(r.service.view()).toMatchObject({
      state: "signed_in",
      syncProblem: "Could not reach the team server.",
    });
    // After a restart with the server still away, the copy kept on disk is used at once.
    const again = rig({ file: r.file, keys: r.keys });
    await again.service.start();
    expect(again.vocabulary.counts()).toEqual({ dictionary: 2, snippets: 1 });
    expect(again.service.view().state).toBe("signed_in");
    server = createLocalServer({ dbPath: ":memory:", port: 0 });
  });

  it("are dropped when the session ends, and the person is asked to sign in again", async () => {
    const { r, token } = await seeded();
    await r.service.syncNow();
    await api("DELETE", "/v1/sessions/current", token);
    await r.service.syncNow();
    expect(r.service.view()).toMatchObject({
      state: "signed_out",
      syncProblem: "Your team session ended. Sign in again.",
      teams: [],
    });
    expect(r.vocabulary.counts()).toEqual({ dictionary: 0, snippets: 0 });
    expect(r.keys.size).toBe(0);
  });

  it("tell a person when a proposal was turned down, until they dismiss it", async () => {
    const { r, token, team } = await seeded();
    const bea = await api("POST", "/v1/users", token, {
      name: "Bea",
      email: "bea@example.com",
      password: PASSWORD,
    });
    server.teams.addMember(team, bea.json!["id"], "member", null, { actorId: null, via: "test" });
    const beaToken = (
      await api("POST", "/v1/sessions", null, { email: "bea@example.com", password: PASSWORD })
    ).json!["token"];
    const proposed = await api("POST", `/v1/teams/${team}/dictionary`, beaToken, {
      term: "Zendesk",
      scope: "company",
    });
    await api(
      "POST",
      `/v1/teams/${team}/vocabulary/items/${proposed.json!["item"].id}/reject`,
      token,
      { comment: "Too generic" },
    );

    const rb = rig();
    await rb.service.connect({ serverUrl: base });
    await rb.service.signIn({ email: "bea@example.com", password: PASSWORD });
    expect(rb.service.view().notices).toMatchObject([{ summary: "Zendesk", note: "Too generic" }]);
    await rb.service.noticesSeen();
    expect(rb.service.view().notices).toEqual([]);
    await rb.service.syncNow();
    expect(rb.service.view().notices).toEqual([]);
    void r;
  });
});

describe("the idle lock", () => {
  it("locks after the idle time, asks for the password, and stays locked across a restart", async () => {
    const { r } = await seeded();
    r.service.setIdleLock(5);
    expect(r.service.view().idleLockMinutes).toBe(5);
    r.idle.seconds = 299;
    r.ticks[0]!();
    expect(r.service.isLocked()).toBe(false);
    r.idle.seconds = 301;
    r.ticks[0]!();
    expect(r.service.isLocked()).toBe(true);
    expect(r.service.view().state).toBe("locked");
    expect(r.views.at(-1)!.state).toBe("locked");

    const restarted = rig({ file: r.file, keys: r.keys });
    await restarted.service.start();
    expect(restarted.service.isLocked()).toBe(true);

    expect(await restarted.service.unlock("wrong wrong wrong")).toMatchObject({ ok: false });
    expect(restarted.service.isLocked()).toBe(true);
    const opened = await restarted.service.unlock(PASSWORD);
    expect(opened.ok && opened.view.state).toBe("signed_in");
    expect(restarted.service.isLocked()).toBe(false);
  });

  it("can be started by hand, and keeps within the limits", async () => {
    const { r } = await seeded();
    expect(r.service.lock().ok).toBe(true);
    expect(r.service.isLocked()).toBe(true);
    expect(r.service.setIdleLock(0).ok && r.service.view().idleLockMinutes).toBe(1);
    expect(r.service.setIdleLock(9999).ok && r.service.view().idleLockMinutes).toBe(240);
  });

  it("does nothing when nobody is signed in", async () => {
    const r = rig();
    await r.service.connect({ serverUrl: base });
    r.idle.seconds = 99_999;
    expect(r.service.lock().ok).toBe(true);
    expect(r.service.isLocked()).toBe(false);
    expect(r.service.view().state).toBe("signed_out");
  });
});

describe("invites", () => {
  async function invite(approval: boolean, seed?: { token: string; team: string }) {
    const { token, team } = seed ?? (await seeded());
    const made = await api("POST", `/v1/teams/${team}/invites`, token, {
      approvalRequired: approval,
      role: "viewer",
      maxUses: 3,
    });
    return { code: made.json!["code"] as string, token, team };
  }

  it("makes an account and joins at once, or asks to join when approval is needed", async () => {
    const joined = await invite(false);
    const seed = { token: joined.token, team: joined.team };
    const r = rig();
    await r.service.connect({ serverUrl: base });
    const result = await r.service.redeem({
      code: joined.code,
      name: "Cy",
      email: "cy@example.com",
      password: PASSWORD,
    });
    expect(result).toMatchObject({
      ok: true,
      status: "joined",
      teamName: "Acme",
      view: { state: "signed_in", user: { name: "Cy" } },
    });
    expect(r.service.view().teams).toMatchObject([{ name: "Acme", myRole: "viewer" }]);
    expect(r.vocabulary.counts().dictionary).toBe(2);

    const waiting = await invite(true, seed);
    const r2 = rig();
    await r2.service.connect({ serverUrl: base });
    const pending = await r2.service.redeem({
      code: waiting.code,
      name: "Di",
      email: "di@example.com",
      password: PASSWORD,
    });
    expect(pending).toMatchObject({ ok: true, status: "pending" });
    expect(r2.service.view().teams).toEqual([]);
  });

  it("says why an invite did not work, and needs a server first", async () => {
    await seeded();
    const r = rig();
    expect(await r.service.redeem({ code: "x" })).toEqual({
      ok: false,
      message: "Connect to a server first.",
    });
    await r.service.connect({ serverUrl: base });
    const bad = await r.service.redeem({
      code: "inv_nothing",
      name: "A",
      email: "a@example.com",
      password: PASSWORD,
    });
    expect(bad).toEqual({ ok: false, message: "That invite code is not valid." });
  });
});

describe("usage counts", () => {
  const day = (date: string, words: number, dictations: number): InsightsDay => ({
    date,
    words,
    dictations,
    speechMs: 0,
    wpmWords: 0,
    wpmMs: 0,
    apps: { "com.apple.mail": { name: "Mail", words, dictations } },
  });

  it("are sent with each sync as numbers only, and only what is new", async () => {
    const { r, token, team } = await seeded();
    const today = new Date(clock).toISOString().slice(0, 10);
    const local = (() => {
      const d = new Date(clock);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    void today;
    r.days.value = [day(local, 120, 6)];
    r.meetings.value = [
      { id: "m1", startedAt: clock - 3_600_000, endedAt: clock - 600_000, durationMs: 50 * 60_000 },
    ];
    await r.service.syncNow();
    const report = (await api("GET", `/v1/teams/${team}/usage?from=${local}&to=${local}`, token))
      .json!;
    expect(report["totals"]).toMatchObject({
      words: 120,
      dictations: 6,
      meetings_recorded: 1,
      meeting_minutes_recorded: 50,
    });
    expect(report["topApps"]).toMatchObject([{ app: "mail", words: 120, dictations: 6 }]);
    expect(JSON.stringify(report)).not.toContain("Mail");

    // Nothing new: nothing added. More words: only the difference.
    await r.service.syncNow();
    r.days.value = [day(local, 150, 7)];
    await r.service.syncNow();
    const after = (await api("GET", `/v1/teams/${team}/usage?from=${local}&to=${local}`, token))
      .json!;
    expect(after["totals"]).toMatchObject({ words: 150, dictations: 7, meetings_recorded: 1 });
  });
});

describe("turning team mode off", () => {
  it("signs out, forgets the server and the shared entries, and leaves the rest alone", async () => {
    const { r, token } = await seeded();
    await r.service.syncNow();
    const result = await r.service.disconnect();
    expect(result.ok && result.view).toMatchObject({
      enabled: false,
      state: "off",
      serverUrl: "",
      user: null,
      teams: [],
    });
    expect(r.vocabulary.counts()).toEqual({ dictionary: 0, snippets: 0 });
    expect(r.keys.size).toBe(0);
    // The server ended the session.
    expect((await api("GET", "/v1/me", token)).status).toBe(401);
    expect(JSON.parse(r.file.text!)).toMatchObject({ enabled: false, serverUrl: "", user: null });
  });
});

describe("the team's policy", () => {
  it("is downloaded with each sync and handed to the app", async () => {
    const { r, token, team } = await seeded();
    await api("PUT", `/v1/teams/${team}/policy`, token, {
      set: {
        "features.scratchpad": false,
        blockedApps: [{ bundleId: "com.example.secret", name: "Secret" }],
        blockedDomains: ["blocked.example"],
        "retention.audio.max": 7,
        adminContact: "it@acme.test",
      },
    });
    await r.service.syncNow();
    expect(r.policies.value).toHaveLength(1);
    expect(r.policies.value[0]).toMatchObject({
      blockedApps: [{ bundleId: "com.example.secret" }],
      blockedDomains: ["blocked.example"],
      retention: { audio: { max: 7 } },
      adminContact: "it@acme.test",
    });
    expect(r.policies.value[0]!.features.scratchpad).toBe(false);
  });

  it("is kept for when the server cannot be reached, also after a restart", async () => {
    const { r, token, team } = await seeded();
    await api("PUT", `/v1/teams/${team}/policy`, token, { set: { "features.mcp": false } });
    await r.service.syncNow();
    await server.close();
    await r.service.syncNow();
    expect(r.policies.value[0]!.features.mcp).toBe(false);
    const again = rig({ file: r.file, keys: r.keys });
    await again.service.start();
    expect(again.policies.value[0]!.features.mcp).toBe(false);
    server = createLocalServer({ dbPath: ":memory:", port: 0 });
  });

  it("changes when an admin changes it, and is dropped when the session ends", async () => {
    const { r, token, team } = await seeded();
    await api("PUT", `/v1/teams/${team}/policy`, token, { set: { "features.mcp": false } });
    await r.service.syncNow();
    expect(r.policies.value[0]!.features.mcp).toBe(false);
    await api("PUT", `/v1/teams/${team}/policy`, token, { unset: ["features.mcp"] });
    await r.service.syncNow();
    expect(r.policies.value[0]!.features.mcp).toBe(true);
    await api("DELETE", "/v1/sessions/current", token);
    await r.service.syncNow();
    expect(r.policies.value).toEqual([]);
  });
});
