import {
  TEAM_LIMITS,
  effectivePolicySchema,
  TEAM_MESSAGES,
  type EffectivePolicy,
  type InsightsDay,
  type Keychain,
  type TeamNotice,
  type TeamProposeInput,
  type TeamProposeResult,
  type TeamRedeemInput,
  type TeamRedeemResult,
  type TeamResult,
  type TeamState,
  type TeamSummary,
  type TeamView,
} from "@murmur/shared";
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

/** What is kept on disk (never the token, and never a password). */
export interface TeamFile {
  enabled: boolean;
  serverUrl: string;
  idleLockMinutes: number;
  /** Locked when the app was last closed, so a restart does not open it. */
  locked: boolean;
  user: { name: string; email: string } | null;
  /** The last shared vocabulary of each team, so it works while the server is out of reach. */
  cache: Record<string, { revision: number; set: SharedSet }>;
  /** The last effective policy of each team, enforced while the server is out of reach. */
  policies: Record<string, EffectivePolicy>;
  usage: UsageMemory;
}

const EMPTY_FILE: TeamFile = {
  enabled: false,
  serverUrl: "",
  idleLockMinutes: TEAM_LIMITS.idleLockMinutes.default,
  locked: false,
  user: null,
  cache: {},
  policies: {},
  usage: EMPTY_USAGE_MEMORY,
};

export interface TeamDeps {
  readFile(): string | null;
  writeFile(text: string): void;
  keychain: Keychain;
  fetch: typeof fetch;
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

interface Answer {
  status: number;
  json: Record<string, unknown> | null;
}

const errorOf = (answer: Answer, fallback: string): string => {
  const error = answer.json?.["error"] as { message?: string } | undefined;
  return typeof error?.message === "string" ? error.message : fallback;
};

export function createTeamService(deps: TeamDeps) {
  const keep = deps.log ?? (() => undefined);
  let file: TeamFile = load();
  let token: string | null = null;
  let state: TeamState = "off";
  let serverSetUp: boolean | null = null;
  let teams: TeamSummary[] = [];
  let lastSyncAt: number | null = null;
  let syncProblem = "";
  let notices: TeamNotice[] = [];
  let revisions = new Map<string, number>();
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

  function view(): TeamView {
    return {
      enabled: file.enabled,
      serverUrl: file.serverUrl,
      state,
      serverSetUp,
      user: file.user,
      teams,
      idleLockMinutes: file.idleLockMinutes,
      lastSyncAt,
      syncProblem,
      sharedCounts: deps.vocabulary.counts(),
      notices,
    };
  }

  const emit = () => deps.onChange(view());

  // ---- talking to the server ----

  async function call(
    method: string,
    path: string,
    options: { body?: unknown; auth?: boolean } = {},
  ): Promise<Answer> {
    const url = new URL(
      path,
      file.serverUrl.endsWith("/") ? file.serverUrl : `${file.serverUrl}/`,
    ).toString();
    deps.networkCheck(url);
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.auth !== false && token) headers["authorization"] = `Bearer ${token}`;
    let res: Response;
    try {
      res = await deps.fetch(url, {
        method,
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Unreachable();
    }
    const text = await res.text();
    const json = ((): Record<string, unknown> | null => {
      try {
        return text ? (JSON.parse(text) as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    })();
    return { status: res.status, json };
  }

  /** A signed-in call. A refused token ends the session here, so the person is asked to sign in. */
  async function authed(method: string, path: string, body?: unknown): Promise<Answer> {
    const answer = await call(method, path, body === undefined ? {} : { body });
    if (answer.status === 401) {
      await endSession(TEAM_MESSAGES.sessionEnded);
      throw new Unreachable();
    }
    return answer;
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
    file = { ...file, locked: false, user: null, policies: {} };
    save();
    emit();
  }

  async function startSession(grant: Record<string, unknown>): Promise<void> {
    token = grant["token"] as string;
    const user = grant["user"] as { name: string; email: string };
    await deps.keychain.set(TEAM_KEYCHAIN.service, TEAM_KEYCHAIN.account, token);
    file = { ...file, user: { name: user.name, email: user.email }, locked: false };
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

  /** The server's reasons for turning a sign-in away, in words for the person. */
  function signInFailure(answer: Answer): TeamResult {
    const error = answer.json?.["error"] as
      { code?: string; message?: string; retryAfterSeconds?: number } | undefined;
    if (answer.status === 429)
      return failure(error?.message ?? "Too many tries. Wait a little.", error?.retryAfterSeconds);
    if (answer.status === 401) return failure(TEAM_MESSAGES.wrongPassword);
    return failure(error?.message ?? "The server did not sign you in.");
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
      try {
        const answer = await call("POST", `v1/teams/${team.id}/usage`, {
          body: { batchId, events },
        });
        // A 4xx other than "not signed in" will never succeed, so the batch is dropped, not repeated.
        return (
          answer.status === 200 ||
          (answer.status >= 400 && answer.status < 500 && answer.status !== 401)
        );
      } catch {
        return false;
      }
    },
  });

  async function syncOnce(): Promise<void> {
    if (state !== "signed_in" && state !== "locked") return;
    try {
      const mine = await authed("GET", "v1/teams");
      if (mine.status !== 200) throw new Unreachable();
      teams = (mine.json?.["teams"] as TeamSummary[]) ?? [];

      const sets: SharedSet[] = [];
      let found: TeamNotice[] = [];
      const policies: Record<string, EffectivePolicy> = { ...file.policies };
      for (const team of teams) {
        const since = revisions.get(team.id);
        const merged = await authed(
          "GET",
          `v1/teams/${team.id}/vocabulary/merged${since !== undefined ? `?since=${since}` : ""}`,
        );
        if (merged.status === 200 && merged.json) {
          const body = merged.json;
          if (body["unchanged"] === true && file.cache[team.id]) {
            sets.push(file.cache[team.id]!.set);
          } else if (body["unchanged"] !== true) {
            const context = (body["context"] ?? { me: "", team: team.name }) as {
              me: string;
              team: string;
            };
            const set: SharedSet = {
              teamName: context.team || team.name,
              me: context.me,
              dictionary: (body["dictionary"] as SharedSet["dictionary"]) ?? [],
              snippets: (body["snippets"] as SharedSet["snippets"]) ?? [],
            };
            revisions.set(team.id, body["revision"] as number);
            file = {
              ...file,
              cache: { ...file.cache, [team.id]: { revision: body["revision"] as number, set } },
            };
            sets.push(set);
          }
        } else if (merged.status === 403 && file.cache[team.id]) {
          // The server's plan no longer has shared vocabulary: it is not used.
        }

        const mineNotices = await authed("GET", `v1/teams/${team.id}/vocabulary/mine`);
        if (mineNotices.status === 200) {
          const list =
            (mineNotices.json?.["notices"] as { id: string; summary: string; note: string }[]) ??
            [];
          found = [...found, ...list.map((n) => ({ id: n.id, summary: n.summary, note: n.note }))];
        }

        const effective = await authed("GET", `v1/teams/${team.id}/policy/effective`);
        if (effective.status === 200) {
          const parsed = effectivePolicySchema.safeParse(effective.json?.["policy"]);
          if (parsed.success) policies[team.id] = parsed.data;
        } else if (effective.status === 403) {
          // The server's plan has no policy (or the person may not see it): none applies.
          delete policies[team.id];
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
      };
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

  const sync = (): Promise<void> => (syncing ??= syncOnce().finally(() => (syncing = null)));

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
    async connect(input: { serverUrl: string }): Promise<TeamResult> {
      if (
        /^[a-z][a-z0-9+.-]*:\/\//i.test(input.serverUrl) &&
        !/^https?:\/\//i.test(input.serverUrl)
      )
        return failure("Use an http or https address.");
      let url: URL;
      try {
        url = new URL(
          /^https?:\/\//i.test(input.serverUrl) ? input.serverUrl : `http://${input.serverUrl}`,
        );
      } catch {
        return failure("That is not a web address, like http://127.0.0.1:7830.");
      }
      if (url.protocol !== "http:" && url.protocol !== "https:")
        return failure("Use an http or https address.");
      const previous = file;
      file = { ...file, serverUrl: `${url.origin}/`, enabled: true };
      try {
        const health = await call("GET", "v1/health", { auth: false });
        if (health.status !== 200 || health.json?.["ok"] !== true) {
          file = previous;
          return failure("That address did not answer like a Murmur team server.");
        }
        serverSetUp = health.json["setUp"] === true;
      } catch (error) {
        file = previous;
        if (error instanceof Unreachable) return unreachable();
        return failure(error instanceof Error ? error.message : TEAM_MESSAGES.strictLocal);
      }
      if (previous.serverUrl !== file.serverUrl) {
        // A different server: whatever was kept for the old one goes.
        await endSession("");
        file = { ...file, user: null, cache: {}, policies: {}, usage: EMPTY_USAGE_MEMORY };
      }
      if (state === "off") state = "signed_out";
      save();
      emit();
      return { ok: true, view: view() };
    },

    /** The first run on a new server: makes the owner account and signs in. */
    async setup(input: { name: string; email: string; password: string }): Promise<TeamResult> {
      if (!file.enabled) return failure("Connect to a server first.");
      try {
        const answer = await call("POST", "v1/setup", {
          auth: false,
          body: { ...input, clientId: "app" },
        });
        if (answer.status !== 201 || !answer.json)
          return failure(errorOf(answer, "The owner account was not made."));
        await startSession(answer.json);
        serverSetUp = true;
      } catch (error) {
        return error instanceof Unreachable ? unreachable() : failure(TEAM_MESSAGES.strictLocal);
      }
      startTimers();
      await sync();
      return { ok: true, view: view() };
    },

    async signIn(input: { email: string; password: string }): Promise<TeamResult> {
      if (!file.enabled) return failure("Connect to a server first.");
      try {
        const answer = await call("POST", "v1/sessions", {
          auth: false,
          body: { ...input, clientId: "app" },
        });
        if (answer.status !== 200 || !answer.json) return signInFailure(answer);
        await startSession(answer.json);
      } catch (error) {
        return error instanceof Unreachable ? unreachable() : failure(TEAM_MESSAGES.strictLocal);
      }
      startTimers();
      await sync();
      return { ok: true, view: view() };
    },

    async signOut(): Promise<TeamResult> {
      if (token) await call("DELETE", "v1/sessions/current").catch(() => undefined);
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
      try {
        const answer = await call("POST", "v1/sessions", {
          auth: false,
          body: { email: file.user.email, password, clientId: "app" },
        });
        if (answer.status !== 200 || !answer.json) return signInFailure(answer);
        await startSession(answer.json);
      } catch (error) {
        return error instanceof Unreachable ? unreachable() : failure(TEAM_MESSAGES.strictLocal);
      }
      emit();
      void sync();
      return { ok: true, view: view() };
    },

    /** Uses an invite code: joins the team, or asks to, and makes the account if there is none. */
    async redeem(input: TeamRedeemInput): Promise<TeamRedeemResult> {
      if (!file.enabled) return { ok: false, message: "Connect to a server first." };
      try {
        const body: Record<string, unknown> = { code: input.code, clientId: "app" };
        const signedIn = state === "signed_in";
        if (!signedIn)
          Object.assign(body, {
            name: input.name ?? "",
            email: input.email ?? "",
            password: input.password ?? "",
          });
        const answer = await call("POST", "v1/invites/redeem", { auth: signedIn, body });
        if (answer.status !== 200 && answer.status !== 201 && answer.status !== 202)
          return { ok: false, message: errorOf(answer, "The invite did not work.") };
        const session = answer.json?.["session"] as Record<string, unknown> | undefined;
        if (session) {
          await startSession(session);
          startTimers();
        }
        await sync();
        const teamName = (answer.json?.["team"] as { name?: string } | undefined)?.name ?? "";
        return {
          ok: true,
          status: answer.json?.["status"] === "pending" ? "pending" : "joined",
          teamName,
          view: view(),
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Unreachable ? TEAM_MESSAGES.unreachable : TEAM_MESSAGES.strictLocal,
        };
      }
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
      if (token) await call("DELETE", "v1/sessions/current").catch(() => undefined);
      stopTimers();
      await endSession("");
      file = { ...EMPTY_FILE, idleLockMinutes: file.idleLockMinutes };
      state = "off";
      serverSetUp = null;
      revisions = new Map();
      save();
      emit();
      return { ok: true, view: view() };
    },

    /** Proposes an entry to the person's team; the server says if it is live or waits for review. */
    async propose(input: TeamProposeInput): Promise<TeamProposeResult> {
      if (state !== "signed_in") return { ok: false, message: "Sign in to a team first." };
      const team = teams[0];
      if (!team) return { ok: false, message: "You are not in a team yet." };
      const body =
        input.kind === "dictionary"
          ? { term: input.term, replacement: input.replacement ?? undefined }
          : { trigger: input.trigger, expansion: input.expansion };
      try {
        const answer = await authed(
          "POST",
          `v1/teams/${team.id}/${input.kind === "dictionary" ? "dictionary" : "snippets"}`,
          body,
        );
        if (answer.status === 201) return { ok: true, status: "live", teamName: team.name };
        if (answer.status === 202) return { ok: true, status: "pending", teamName: team.name };
        return { ok: false, message: errorOf(answer, "The team did not take that.") };
      } catch (error) {
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
        await authed("POST", `v1/teams/${team.id}/policy/report`, {
          event: "retention_applied",
          audio: counts.audio,
          transcripts: counts.transcripts,
        }).catch(() => undefined);
      }
    },

    async noticesSeen(): Promise<TeamResult> {
      for (const team of teams)
        await authed("POST", `v1/teams/${team.id}/vocabulary/notices/seen`, {}).catch(
          () => undefined,
        );
      notices = [];
      emit();
      return { ok: true, view: view() };
    },
  };
}

export type TeamService = ReturnType<typeof createTeamService>;
