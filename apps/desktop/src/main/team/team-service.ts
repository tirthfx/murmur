import { randomUUID } from "node:crypto";
import {
  TEAM_CLIENT_VERSION,
  TEAM_LIMITS,
  TEAM_MESSAGES,
  type EffectivePolicy,
  type InsightsDay,
  type Keychain,
  type SharedFolder,
  type SharedNote,
  type SharedSkill,
  type TeamAccountClient,
  type TeamClient,
  type TeamClientError,
  type TeamClientResult,
  type TeamClientSession,
  type TeamContentClient,
  type TeamContentResult,
  type TeamNotice,
  type TeamPerson,
  type TeamSharedFolder,
  type TeamSharedSkill,
  type TeamProposeInput,
  type TeamProposeResult,
  type TeamRedeemInput,
  type TeamRedeemResult,
  type TeamResult,
  type TeamState,
  type TeamSummary,
  type TeamView,
} from "@murmur/shared";
import { createLocalTeamClient } from "./local-team-client";
import { createSupabaseTeamClient } from "./supabase-team-client";
import type { SharedSet, SharedVocabulary } from "./shared-vocabulary";
import type { DayCounts } from "./usage-counts";
import {
  EMPTY_USAGE_MEMORY,
  createUsageReporter,
  type UsageMeeting,
  type UsageMemory,
} from "./usage-reporter";

/**
 * Team mode (TM-01 client, TM-06, TM-09). The app signs in to a team server, keeps the session
 * token in the Keychain, locks when the Mac has been idle and asks for the password, pulls the
 * team's shared dictionary and snippets, and sends usage counts. It is off until the owner
 * connects to a server. The server decides who may do what; the app only hides controls.
 */
export const TEAM_KEYCHAIN = { service: "dev.murmur.team", account: "session" } as const;

/** A proposal waiting to be sent: only what the person chose to propose. */
export interface OutboxItem {
  id: string;
  teamId: string;
  input: TeamProposeInput;
}

/** The most proposals kept waiting; more than this is a sign something is wrong. */
export const OUTBOX_LIMIT = 50;

/** What is kept on disk (never the token, and never a password). */
export interface TeamFile {
  enabled: boolean;
  /** Which backend the address is: a Murmur team server, or a Supabase project. */
  backend: "local" | "supabase";
  serverUrl: string;
  /** The Supabase project's public key (not a secret); empty for a team server. */
  projectKey: string;
  idleLockMinutes: number;
  /** Locked when the app was last closed, so a restart does not open it. */
  locked: boolean;
  user: { name: string; email: string } | null;
  /** The last shared vocabulary of each team, so it works while the server is out of reach. */
  cache: Record<string, { revision: number; set: SharedSet }>;
  /** The last effective policy of each team, enforced while the server is out of reach. */
  policies: Record<string, EffectivePolicy>;
  /** Proposals saved while the server was out of reach, sent in order when it can be reached. */
  outbox: OutboxItem[];
  /** The Skills and folders each team shares, as last pulled, so they show while the server is out of reach. */
  content: Record<string, { revision: number; skills: SharedSkill[]; folders: SharedFolder[] }>;
  usage: UsageMemory;
}

const EMPTY_FILE: TeamFile = {
  enabled: false,
  backend: "local",
  serverUrl: "",
  projectKey: "",
  idleLockMinutes: TEAM_LIMITS.idleLockMinutes.default,
  locked: false,
  user: null,
  cache: {},
  policies: {},
  outbox: [],
  content: {},
  usage: EMPTY_USAGE_MEMORY,
};

export interface TeamDeps {
  readFile(): string | null;
  writeFile(text: string): void;
  keychain: Keychain;
  fetch: typeof fetch;
  /** Another backend for the same interface (SW-08); the local server's client when absent. */
  client?: (connection: { serverUrl(): string; token(): string | null }) => TeamClient;
  now(): number;
  /** Seconds since the person last used the Mac. */
  idleSeconds(): number;
  /** Throws when strict local mode refuses this address. */
  networkCheck(url: string): void;
  vocabulary: SharedVocabulary;
  /** Receives the policies of the teams the person is in (none when signed out). */
  policy?: { setTeam(policies: readonly EffectivePolicy[]): void };
  insights: { days(first: string | null): InsightsDay[] };
  /** Skills run, Ask threads and meeting minutes processed, as daily totals. */
  counts?: () => DayCounts[];
  meetings: { list(limit?: number): UsageMeeting[] };
  onChange(view: TeamView): void;
  setInterval?: (handler: () => void, ms: number) => unknown;
  clearInterval?: (timer: unknown) => void;
  log?: (line: string) => void;
}

class Unreachable extends Error {}

/** Addresses that are this Mac; a local Supabase stack may be reached over plain http. */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function createTeamService(deps: TeamDeps) {
  const keep = deps.log ?? (() => undefined);
  let file: TeamFile = load();
  let token: string | null = null;
  const connection = { serverUrl: () => file.serverUrl, token: () => token };
  /** A session the Supabase client renewed: kept in memory and in the Keychain, as a sign-in's is. */
  const remember = (next: string) => {
    token = next;
    void deps.keychain.set(TEAM_KEYCHAIN.service, TEAM_KEYCHAIN.account, next).catch(() => false);
  };
  const localClient: TeamClient = deps.client
    ? deps.client(connection)
    : createLocalTeamClient({ ...connection, fetch: deps.fetch, networkCheck: deps.networkCheck });
  const supabaseClient: TeamClient = createSupabaseTeamClient({
    url: () => file.serverUrl,
    anonKey: () => file.projectKey,
    token: () => token,
    saveToken: remember,
    fetch: deps.fetch,
    networkCheck: deps.networkCheck,
  });
  /** The client for the backend the address is (a test's own client always wins). */
  const pick = (): TeamClient =>
    file.backend === "supabase" && !deps.client ? supabaseClient : localClient;
  /** The shared Skills and folders of the backend in use, when it has them (`teamContent.v1`). */
  const contentClient = (): TeamContentClient | null => {
    const picked = pick();
    return "contentVersion" in picked ? (picked as TeamClient & TeamContentClient) : null;
  };
  const client: TeamClient = {
    version: TEAM_CLIENT_VERSION,
    health: () => pick().health(),
    setupOwner: (input) => pick().setupOwner(input),
    signIn: (input) => pick().signIn(input),
    signOut: () => pick().signOut(),
    redeemInvite: (input) => pick().redeemInvite(input),
    teams: () => pick().teams(),
    vocabulary: (teamId, since) => pick().vocabulary(teamId, since),
    notices: (teamId) => pick().notices(teamId),
    markNoticesSeen: (teamId) => pick().markNoticesSeen(teamId),
    policy: (teamId) => pick().policy(teamId),
    sendUsage: (teamId, batchId, events) => pick().sendUsage(teamId, batchId, events),
    reportRetention: (teamId, counts) => pick().reportRetention(teamId, counts),
    propose: (teamId, input) => pick().propose(teamId, input),
  };
  let state: TeamState = "off";
  let serverSetUp: boolean | null = null;
  let teams: TeamSummary[] = [];
  let lastSyncAt: number | null = null;
  let syncProblem = "";
  let notices: TeamNotice[] = [];
  let revisions = new Map<string, number>();
  let contentRevisions = new Map<string, number>();
  let syncing: Promise<void> | null = null;
  let timers: unknown[] = [];

  function load(): TeamFile {
    try {
      const text = deps.readFile();
      if (!text) return { ...EMPTY_FILE };
      const parsed = JSON.parse(text) as Partial<TeamFile>;
      return {
        ...EMPTY_FILE,
        ...parsed,
        usage: { ...EMPTY_USAGE_MEMORY, ...(parsed.usage ?? {}) },
        cache: parsed.cache ?? {},
        policies: parsed.policies ?? {},
        content: parsed.content ?? {},
        outbox: parsed.outbox ?? [],
      };
    } catch {
      return { ...EMPTY_FILE };
    }
  }

  const save = () => {
    try {
      deps.writeFile(JSON.stringify(file));
    } catch {
      keep("[team] The team settings could not be saved.");
    }
  };

  /** What the teams share, with the team each is from, in the order the teams are listed. */
  function sharedView(): TeamView["shared"] {
    const skills: TeamSharedSkill[] = [];
    const folders: TeamSharedFolder[] = [];
    for (const team of teams) {
      const entry = file.content[team.id];
      if (!entry) continue;
      for (const skill of entry.skills)
        skills.push({ ...skill, teamId: team.id, teamName: team.name });
      for (const folder of entry.folders)
        folders.push({ ...folder, teamId: team.id, teamName: team.name });
    }
    return { skills, folders };
  }

  function view(): TeamView {
    return {
      enabled: file.enabled,
      backend: file.backend,
      serverUrl: file.serverUrl,
      state,
      serverSetUp,
      user: file.user,
      teams,
      idleLockMinutes: file.idleLockMinutes,
      lastSyncAt,
      syncProblem,
      sharedCounts: deps.vocabulary.counts(),
      outbox: file.outbox.length,
      notices,
      shared: sharedView(),
    };
  }

  const emit = () => deps.onChange(view());

  // ---- talking to the server ----

  /**
   * A signed-in call's result. A refused session ends here, so the person is asked to sign in;
   * a server that cannot be reached stops the work; anything else is the caller's to read.
   */
  async function authed<T>(pending: Promise<TeamClientResult<T>>): Promise<TeamClientResult<T>> {
    const result = await pending;
    if (result.ok) return result;
    if (result.error.code === "unauthorized") {
      await endSession(TEAM_MESSAGES.sessionEnded);
      throw new Unreachable();
    }
    if (result.error.code === "offline") throw new Unreachable();
    if (result.error.code === "refused") throw new Error(result.error.message);
    return result;
  }

  async function endSession(problem: string): Promise<void> {
    token = null;
    await deps.keychain.delete(TEAM_KEYCHAIN.service, TEAM_KEYCHAIN.account).catch(() => false);
    deps.vocabulary.clear();
    deps.policy?.setTeam([]);
    teams = [];
    notices = [];
    state = file.enabled ? "signed_out" : "off";
    syncProblem = problem;
    contentRevisions = new Map();
    // A waiting proposal is one person's: it does not go out under the next person who signs in.
    file = { ...file, locked: false, user: null, policies: {}, content: {}, outbox: [] };
    save();
    emit();
  }

  async function startSession(grant: TeamClientSession): Promise<void> {
    token = grant.token;
    await deps.keychain.set(TEAM_KEYCHAIN.service, TEAM_KEYCHAIN.account, token);
    file = { ...file, user: { name: grant.user.name, email: grant.user.email }, locked: false };
    state = "signed_in";
    syncProblem = "";
    save();
  }

  const failure = (message: string, retryAfterSeconds?: number): TeamResult => ({
    ok: false,
    message,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  });

  const unreachable = () => failure(TEAM_MESSAGES.unreachable);

  /** The words for a failed call: the server's own, or ours for a connection that did not happen. */
  function failed(error: TeamClientError): TeamResult {
    if (error.code === "offline") return unreachable();
    if (error.code === "refused") return failure(error.message);
    // Only a sign-in is answered "unauthorized": the email or the password was not right.
    if (error.code === "unauthorized") return failure(TEAM_MESSAGES.wrongPassword);
    if (error.code === "rate_limited")
      return failure(error.message || "Too many tries. Wait a little.", error.retryAfterSeconds);
    return failure(error.message);
  }

  // ---- sync ----

  const usage = createUsageReporter({
    days: () => deps.insights.days(null),
    ...(deps.counts ? { counts: deps.counts } : {}),
    meetings: () => deps.meetings.list(500),
    now: deps.now,
    load: () => file.usage,
    save: (memory) => {
      file = { ...file, usage: memory };
      save();
    },
    async post(batchId, events) {
      const team = teams[0];
      if (!team) return false;
      const result = await client.sendUsage(team.id, batchId, events);
      if (result.ok) return true;
      // A refusal that will never change is final, so the batch is dropped and not repeated.
      return ["forbidden", "not_found", "conflict", "invalid"].includes(result.error.code);
    },
  });

  async function syncOnce(): Promise<void> {
    if (state !== "signed_in" && state !== "locked") return;
    try {
      const mine = await authed(client.teams());
      if (!mine.ok) throw new Unreachable();
      teams = mine.data;

      const sets: SharedSet[] = [];
      let found: TeamNotice[] = [];
      const policies: Record<string, EffectivePolicy> = { ...file.policies };
      for (const team of teams) {
        const merged = await authed(client.vocabulary(team.id, revisions.get(team.id)));
        if (merged.ok) {
          const body = merged.data;
          if (body.unchanged) {
            if (file.cache[team.id]) sets.push(file.cache[team.id]!.set);
          } else {
            const set: SharedSet = {
              teamName: body.context.team || team.name,
              me: body.context.me,
              dictionary: body.dictionary,
              snippets: body.snippets,
            };
            revisions.set(team.id, body.revision);
            file = {
              ...file,
              cache: { ...file.cache, [team.id]: { revision: body.revision, set } },
            };
            sets.push(set);
          }
        }
        // A refusal (the server's plan no longer has shared vocabulary) leaves the entries unused.

        const mineNotices = await authed(client.notices(team.id));
        if (mineNotices.ok) found = [...found, ...mineNotices.data];

        const effective = await authed(client.policy(team.id));
        if (effective.ok) policies[team.id] = effective.data;
        // The server's plan has no policy (or the person may not see it): none applies.
        else if (effective.error.code === "forbidden") delete policies[team.id];

        const shared = contentClient();
        if (shared) {
          const answer = await authed(shared.content(team.id, contentRevisions.get(team.id)));
          if (answer.ok && !answer.data.unchanged) {
            contentRevisions.set(team.id, answer.data.revision);
            file = {
              ...file,
              content: {
                ...file.content,
                [team.id]: {
                  revision: answer.data.revision,
                  skills: answer.data.skills,
                  folders: answer.data.folders,
                },
              },
            };
          } else if (!answer.ok && answer.error.code === "forbidden") {
            // The plan has no shared Skills or folders (or the person may not see them).
            file = {
              ...file,
              content: Object.fromEntries(
                Object.entries(file.content).filter(([id]) => id !== team.id),
              ),
            };
            contentRevisions.delete(team.id);
          }
        }
      }
      deps.vocabulary.set(sets);
      notices = found;
      const inTeams = (id: string) => teams.some((t) => t.id === id);
      const kept = Object.fromEntries(Object.entries(policies).filter(([id]) => inTeams(id)));
      deps.policy?.setTeam(Object.values(kept));
      file = {
        ...file,
        policies: kept,
        cache: Object.fromEntries(Object.entries(file.cache).filter(([id]) => inTeams(id))),
        content: Object.fromEntries(Object.entries(file.content).filter(([id]) => inTeams(id))),
      };
      await flushOutbox();
      save();
      await usage.flush().catch(() => 0);
      lastSyncAt = deps.now();
      syncProblem = "";
    } catch (error) {
      if (!(error instanceof Unreachable)) {
        keep(`[team] sync failed: ${error instanceof Error ? error.message : "unknown"}`);
      }
      // Out of reach: what was pulled last time stays in use.
      // (A refused session has already ended itself and said so.)
      const now: TeamState = state as TeamState;
      if (now !== "signed_out" && now !== "off") syncProblem = TEAM_MESSAGES.unreachable;
    }
    emit();
  }

  /**
   * Sends the proposals saved while the server was out of reach, oldest first. One the server
   * already has counts as sent; one it refuses is dropped and the person is told why, so a bad
   * proposal cannot block the ones behind it. Out of reach again: the rest wait.
   */
  async function flushOutbox(): Promise<void> {
    const left: OutboxItem[] = [];
    let stopped = false;
    for (const item of file.outbox) {
      if (stopped) {
        left.push(item);
        continue;
      }
      const sent = await authed(client.propose(item.teamId, item.input)).catch((error: unknown) => {
        if (error instanceof Unreachable) return null;
        throw error;
      });
      if (sent === null) {
        stopped = true;
        left.push(item);
      } else if (!sent.ok && sent.error.code !== "conflict") {
        const what = item.input.kind === "dictionary" ? item.input.term : item.input.trigger;
        notices = [
          ...notices,
          {
            id: `outbox-${item.id}`,
            summary: what,
            note: `Could not be sent: ${sent.error.message}`,
          },
        ];
      }
    }
    // A session that ended on the way has already cleared them; they are not put back.
    if ((state as TeamState) === "signed_in") file = { ...file, outbox: left };
  }

  const sync = (): Promise<void> => (syncing ??= syncOnce().finally(() => (syncing = null)));

  /** An action on shared content: signed in, a backend that has it, and the words for a failure. */
  async function shared<T>(
    teamId: string,
    run: (content: TeamContentClient) => Promise<TeamClientResult<T>>,
  ): Promise<TeamContentResult<T>> {
    if (state !== "signed_in") return { ok: false, message: "Sign in to a team first." };
    if (!teams.some((team) => team.id === teamId))
      return { ok: false, message: "You are not in that team." };
    const content = contentClient();
    if (!content)
      return { ok: false, message: "This team server does not have shared Skills and folders." };
    try {
      const result = await authed(run(content));
      return result.ok
        ? { ok: true, value: result.data }
        : { ok: false, message: result.error.message };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Unreachable
            ? TEAM_MESSAGES.unreachable
            : error instanceof Error
              ? error.message
              : TEAM_MESSAGES.strictLocal,
      };
    }
  }

  // ---- idle lock ----

  function lockNow(): void {
    if (state !== "signed_in") return;
    state = "locked";
    file = { ...file, locked: true };
    save();
    emit();
  }

  function checkIdle(): void {
    if (state === "signed_in" && deps.idleSeconds() >= file.idleLockMinutes * 60) lockNow();
  }

  function startTimers(): void {
    stopTimers();
    const every = deps.setInterval ?? ((handler, ms) => setInterval(handler, ms));
    timers = [every(checkIdle, 30_000), every(() => void sync(), TEAM_LIMITS.syncMinutes * 60_000)];
  }

  function stopTimers(): void {
    const clear = deps.clearInterval ?? ((timer) => clearInterval(timer as NodeJS.Timeout));
    for (const timer of timers) clear(timer);
    timers = [];
  }

  // ---- the operations ----

  return {
    view,

    /** Called once at start: picks up a session kept in the Keychain and starts syncing. */
    async start(): Promise<void> {
      if (!file.enabled || file.serverUrl === "") return;
      token = await deps.keychain
        .get(TEAM_KEYCHAIN.service, TEAM_KEYCHAIN.account)
        .catch(() => null);
      if (!token) {
        state = "signed_out";
        return;
      }
      // What was pulled last time is in use at once, before the server answers.
      const cached = Object.values(file.cache).map((entry) => entry.set);
      deps.vocabulary.set(cached);
      deps.policy?.setTeam(Object.values(file.policies));
      state = file.locked ? "locked" : "signed_in";
      startTimers();
      void sync();
    },

    stop(): void {
      stopTimers();
    },

    isLocked: () => state === "locked",

    /** Points the app at a team server and asks whether it has an owner yet. */
    async connect(input: {
      serverUrl: string;
      projectKey?: string | undefined;
    }): Promise<TeamResult> {
      const projectKey = (input.projectKey ?? "").trim();
      const backend = projectKey === "" ? ("local" as const) : ("supabase" as const);
      if (
        /^[a-z][a-z0-9+.-]*:\/\//i.test(input.serverUrl) &&
        !/^https?:\/\//i.test(input.serverUrl)
      )
        return failure("Use an http or https address.");
      let url: URL;
      try {
        // A Supabase project is on https; a team server is usually on this Mac or the local network.
        url = new URL(
          /^https?:\/\//i.test(input.serverUrl)
            ? input.serverUrl
            : `${backend === "supabase" ? "https" : "http"}://${input.serverUrl}`,
        );
      } catch {
        return failure("That is not a web address, like http://127.0.0.1:7830.");
      }
      if (url.protocol !== "http:" && url.protocol !== "https:")
        return failure("Use an http or https address.");
      if (backend === "supabase" && url.protocol === "http:" && !LOOPBACK.has(url.hostname))
        return failure("A Supabase project is reached over https.");
      const previous = file;
      file = { ...file, backend, projectKey, serverUrl: `${url.origin}/`, enabled: true };
      const health = await client.health();
      if (!health.ok) {
        file = previous;
        return failed(health.error);
      }
      serverSetUp = health.data.setUp;
      if (
        previous.serverUrl !== file.serverUrl ||
        previous.backend !== file.backend ||
        previous.projectKey !== file.projectKey
      ) {
        // A different server: whatever was kept for the old one goes.
        await endSession("");
        file = {
          ...file,
          user: null,
          cache: {},
          policies: {},
          content: {},
          outbox: [],
          usage: EMPTY_USAGE_MEMORY,
        };
      }
      if (state === "off") state = "signed_out";
      save();
      emit();
      return { ok: true, view: view() };
    },

    /** The first run on a new server: makes the owner account and signs in. */
    async setup(input: { name: string; email: string; password: string }): Promise<TeamResult> {
      if (!file.enabled) return failure("Connect to a server first.");
      const made = await client.setupOwner(input);
      if (!made.ok) return failed(made.error);
      await startSession(made.data);
      serverSetUp = true;
      startTimers();
      await sync();
      return { ok: true, view: view() };
    },

    async signIn(input: { email: string; password: string }): Promise<TeamResult> {
      if (!file.enabled) return failure("Connect to a server first.");
      const signed = await client.signIn(input);
      if (!signed.ok) return failed(signed.error);
      await startSession(signed.data);
      startTimers();
      await sync();
      return { ok: true, view: view() };
    },

    async signOut(): Promise<TeamResult> {
      if (token) await client.signOut();
      await endSession("");
      stopTimers();
      return { ok: true, view: view() };
    },

    lock(): TeamResult {
      lockNow();
      return { ok: true, view: view() };
    },

    /** The password again: a fresh sign-in that also replaces the session. */
    async unlock(password: string): Promise<TeamResult> {
      if (state !== "locked" || !file.user) return { ok: true, view: view() };
      const signed = await client.signIn({ email: file.user.email, password });
      if (!signed.ok) return failed(signed.error);
      await startSession(signed.data);
      emit();
      void sync();
      return { ok: true, view: view() };
    },

    /** Uses an invite code: joins the team, or asks to, and makes the account if there is none. */
    async redeem(input: TeamRedeemInput): Promise<TeamRedeemResult> {
      if (!file.enabled) return { ok: false, message: "Connect to a server first." };
      const used = await client.redeemInvite({
        code: input.code,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.password !== undefined ? { password: input.password } : {}),
        signedIn: state === "signed_in",
      });
      if (!used.ok) {
        const message = failed(used.error);
        return { ok: false, message: message.ok ? "" : message.message };
      }
      if (used.data.session) {
        await startSession(used.data.session);
        startTimers();
      }
      await sync();
      return {
        ok: true,
        status: used.data.status,
        teamName: used.data.teamName,
        view: view(),
      };
    },

    async syncNow(): Promise<TeamResult> {
      await sync();
      return { ok: true, view: view() };
    },

    setIdleLock(minutes: number): TeamResult {
      const { min, max } = TEAM_LIMITS.idleLockMinutes;
      file = { ...file, idleLockMinutes: Math.min(Math.max(Math.round(minutes), min), max) };
      save();
      emit();
      return { ok: true, view: view() };
    },

    /** Turns team mode off: signs out and forgets the server. Personal data is untouched. */
    async disconnect(): Promise<TeamResult> {
      if (token) await client.signOut();
      stopTimers();
      await endSession("");
      file = { ...EMPTY_FILE, idleLockMinutes: file.idleLockMinutes };
      state = "off";
      serverSetUp = null;
      revisions = new Map();
      contentRevisions = new Map();
      save();
      emit();
      return { ok: true, view: view() };
    },

    /** Changes the person's own password on the backend. A wrong current password is said in words, not taken for an ended session. */
    async changePassword(input: {
      current: string;
      next: string;
    }): Promise<TeamContentResult<null>> {
      if (state !== "signed_in") return { ok: false, message: "Sign in to a team first." };
      const picked = pick();
      if (!("accountVersion" in picked))
        return { ok: false, message: "This team server cannot change a password from here." };
      const result = await (picked as TeamClient & TeamAccountClient).changePassword(input);
      if (result.ok) return { ok: true, value: null };
      if (result.error.code === "unauthorized") {
        await endSession(TEAM_MESSAGES.sessionEnded);
        return { ok: false, message: TEAM_MESSAGES.sessionEnded };
      }
      if (result.error.code === "offline") return { ok: false, message: TEAM_MESSAGES.unreachable };
      return { ok: false, message: result.error.message };
    },

    // ---- shared Skills and folders ----

    /** The text of a Skill a team published, for the person to copy into their own Skills. */
    skillText(teamId: string, skillId: string): string | null {
      return file.content[teamId]?.skills.find((skill) => skill.id === skillId)?.body ?? null;
    },

    /** The people in a team, to choose who is in a shared folder. */
    people: (teamId: string): Promise<TeamContentResult<TeamPerson[]>> =>
      shared(teamId, (c) => c.people(teamId)),

    /** Makes a shared folder for named people (a department or the company is made in the admin console). */
    async createFolder(input: {
      teamId: string;
      name: string;
      members: string[];
    }): Promise<TeamContentResult<SharedFolder>> {
      const made = await shared(input.teamId, (c) =>
        c.createFolder(input.teamId, { name: input.name, kind: "shared", members: input.members }),
      );
      if (made.ok) void sync();
      return made;
    },

    /** Adds a copy of notes, as text, to a folder. */
    async shareNote(input: {
      teamId: string;
      folderId: string;
      title: string;
      body: string;
      sourceRef: string;
    }): Promise<TeamContentResult<{ id: string }>> {
      const sent = await shared(input.teamId, (c) =>
        c.shareNote(input.teamId, input.folderId, {
          title: input.title,
          body: input.body,
          sourceRef: input.sourceRef,
        }),
      );
      if (sent.ok) void sync();
      return sent;
    },

    /** One shared note, with its text. */
    readNote: (input: {
      teamId: string;
      folderId: string;
      noteId: string;
    }): Promise<TeamContentResult<SharedNote>> =>
      shared(input.teamId, (c) => c.readNote(input.teamId, input.folderId, input.noteId)),

    /** Proposes an entry to the person's team; the server says if it is live or waits for review. */
    async propose(input: TeamProposeInput): Promise<TeamProposeResult> {
      if (state !== "signed_in") return { ok: false, message: "Sign in to a team first." };
      // A team the person was in at the last sync counts while the server is out of reach.
      const cachedId = Object.keys(file.cache)[0];
      const team =
        teams[0] ?? (cachedId ? { id: cachedId, name: file.cache[cachedId]!.set.teamName } : null);
      if (!team) return { ok: false, message: "You are not in a team yet." };
      try {
        const sent = await authed(client.propose(team.id, input));
        if (sent.ok)
          return { ok: true, status: sent.data.live ? "live" : "pending", teamName: team.name };
        return { ok: false, message: sent.error.message };
      } catch (error) {
        if (error instanceof Unreachable && state === "signed_in") {
          if (file.outbox.length >= OUTBOX_LIMIT)
            return {
              ok: false,
              message: `${TEAM_MESSAGES.unreachable} ${OUTBOX_LIMIT} proposals are already waiting.`,
            };
          file = {
            ...file,
            outbox: [...file.outbox, { id: randomUUID(), teamId: team.id, input }],
          };
          save();
          emit();
          return { ok: true, status: "queued", teamName: team.name };
        }
        return {
          ok: false,
          message:
            error instanceof Unreachable ? TEAM_MESSAGES.unreachable : TEAM_MESSAGES.strictLocal,
        };
      }
    },

    /**
     * Tells the teams whose policy limits retention that a run removed data under it (TM-15):
     * counts only. It is not repeated if the server is out of reach.
     */
    async reportRetention(counts: { audio: number; transcripts: number }): Promise<void> {
      if (state !== "signed_in" && state !== "locked") return;
      for (const team of teams) {
        const limits = file.policies[team.id]?.retention;
        if (!limits) continue;
        const limited = [limits.audio, limits.transcript].some(
          (limit) => limit.max !== null || limit.min !== null,
        );
        if (!limited) continue;
        await authed(client.reportRetention(team.id, counts)).catch(() => undefined);
      }
    },

    async noticesSeen(): Promise<TeamResult> {
      for (const team of teams)
        await authed(client.markNoticesSeen(team.id)).catch(() => undefined);
      notices = [];
      emit();
      return { ok: true, view: view() };
    },
  };
}

export type TeamService = ReturnType<typeof createTeamService>;
