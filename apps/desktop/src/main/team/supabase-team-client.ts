import {
  TEAM_CLIENT_VERSION,
  TEAM_MESSAGES,
  checkPolicyValue,
  isPolicyKey,
  mergePolicy,
  teamClientErrorFor,
  type PolicyValues,
  type TeamClient,
  type TeamClientErrorCode,
  type TeamClientResult,
  type TeamClientSession,
  type TeamNotice,
  type TeamSummary,
  type TeamVocabularyAnswer,
} from "@murmur/shared";

/**
 * The team client for a Supabase project (SW-01, SW-08), over `fetch`: Supabase Auth for the
 * sign-in and PostgREST for the functions in `services/supabase/migrations`. There is no SDK. It
 * holds the project address and the person's session it is given, and turns every answer into the
 * shared types and error set, like the local client does.
 *
 * The session token the app keeps is one opaque string. Here it carries the access token and the
 * refresh token, so an expired access token is renewed inside the client; a renewed token is
 * handed to `saveToken` so the app can keep it (a refresh token works once).
 */
export interface SupabaseTeamClientDeps {
  /** The project's address (https://<ref>.supabase.co); read on every call. */
  url(): string;
  /** The project's public key (anon or publishable). It is not a secret and gives no access alone. */
  anonKey(): string;
  /** The session token, or null when signed out. */
  token(): string | null;
  /** Called with a renewed session token, so the app can store it. */
  saveToken?(token: string): void;
  fetch: typeof fetch;
  /** Throws when strict local mode refuses this address. */
  networkCheck(url: string): void;
}

/** Murmur's own minimum, which the project's setting should match. */
export const SUPABASE_MIN_PASSWORD = 12;

interface Pair {
  access: string;
  refresh: string | null;
}

interface Answer {
  status: number;
  json: Record<string, unknown> | unknown[] | null;
  retryAfter: number | null;
}

class Failed extends Error {
  code: TeamClientErrorCode;
  constructor(code: TeamClientErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const fail = (
  code: TeamClientErrorCode,
  message: string,
  retryAfterSeconds?: number,
): {
  ok: false;
  error: { code: TeamClientErrorCode; message: string; retryAfterSeconds?: number };
} => ({
  ok: false,
  error: { code, message, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) },
});

const ok = <T>(data: T): TeamClientResult<T> => ({ ok: true, data });

const PREFIX = "sb1.";

export function encodeSupabaseToken(pair: Pair): string {
  return (
    PREFIX + Buffer.from(JSON.stringify({ a: pair.access, r: pair.refresh })).toString("base64url")
  );
}

/** A token the client made, or any other string taken as a bare access token. */
export function decodeSupabaseToken(token: string): Pair {
  if (token.startsWith(PREFIX)) {
    try {
      const value = JSON.parse(
        Buffer.from(token.slice(PREFIX.length), "base64url").toString("utf8"),
      ) as {
        a?: unknown;
        r?: unknown;
      };
      if (typeof value.a === "string")
        return { access: value.a, refresh: typeof value.r === "string" ? value.r : null };
    } catch {
      // Not ours after all: send it as it is and let the server say no.
    }
  }
  return { access: token, refresh: null };
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function createSupabaseTeamClient(deps: SupabaseTeamClientDeps): TeamClient {
  /** The session after a renewal, for as long as the app still holds the token it came from. */
  let renewed: { from: string; pair: Pair } | null = null;
  let renewing: Promise<Pair | null> | null = null;

  const current = (): Pair | null => {
    const stored = deps.token();
    if (!stored) return null;
    if (renewed && renewed.from === stored) return renewed.pair;
    return decodeSupabaseToken(stored);
  };

  async function send(
    method: string,
    path: string,
    options: { body?: unknown; bearer?: string | null } = {},
  ): Promise<Answer> {
    const base = deps.url().replace(/\/+$/, "");
    const url = `${base}${path}`;
    try {
      deps.networkCheck(url);
    } catch (error) {
      throw new Failed(
        "refused",
        error instanceof Error ? error.message : TEAM_MESSAGES.strictLocal,
      );
    }
    const headers: Record<string, string> = { apikey: deps.anonKey() };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    // The public key is not a token: only a person's session goes in `authorization`.
    if (options.bearer) headers["authorization"] = `Bearer ${options.bearer}`;
    let res: Response;
    try {
      res = await deps.fetch(url, {
        method,
        headers,
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Failed("offline", TEAM_MESSAGES.unreachable);
    }
    const text = await res.text();
    const json = ((): Answer["json"] => {
      try {
        return text ? (JSON.parse(text) as Answer["json"]) : null;
      } catch {
        return null;
      }
    })();
    const wait = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
    return {
      status: res.status,
      json,
      retryAfter: Number.isFinite(wait) && wait > 0 ? wait : null,
    };
  }

  /** Swaps the refresh token for a new session; one renewal at a time. */
  function renew(from: string, pair: Pair): Promise<Pair | null> {
    if (renewing) return renewing;
    renewing = (async () => {
      try {
        if (!pair.refresh) return null;
        const answer = await send("POST", "/auth/v1/token?grant_type=refresh_token", {
          body: { refresh_token: pair.refresh },
        });
        const body = asRecord(answer.json);
        if (answer.status !== 200 || typeof body["access_token"] !== "string") return null;
        const next: Pair = {
          access: body["access_token"],
          refresh: typeof body["refresh_token"] === "string" ? body["refresh_token"] : null,
        };
        renewed = { from, pair: next };
        deps.saveToken?.(encodeSupabaseToken(next));
        return next;
      } finally {
        renewing = null;
      }
    })();
    return renewing;
  }

  /** Calls a function. A signed-in call that finds the session expired renews it and tries once more. */
  async function rpc(
    name: string,
    args: Record<string, unknown>,
    options: { auth: boolean } = { auth: true },
  ): Promise<Answer> {
    const path = `/rest/v1/rpc/${name}`;
    if (!options.auth) return send("POST", path, { body: args });
    const pair = current();
    // With no session the call still goes out, without a token: the answer is 401, and a backend
    // that cannot be reached, or that Murmur's rules refuse, is reported as that first.
    if (!pair) return send("POST", path, { body: args });
    const first = await send("POST", path, { body: args, bearer: pair.access });
    if (first.status !== 401 || !pair.refresh) return first;
    const stored = deps.token();
    const next = stored ? await renew(stored, pair) : null;
    if (!next) return first;
    return send("POST", path, { body: args, bearer: next.access });
  }

  /** The service's own words for a refusal, with the code its status means. */
  function refusal(answer: Answer, fallback: string) {
    const body = asRecord(answer.json);
    const words = [body["message"], body["msg"], body["error_description"]].find(
      (value): value is string => typeof value === "string" && value !== "",
    );
    const code = teamClientErrorFor(answer.status);
    return fail(
      code,
      words ?? fallback,
      code === "rate_limited" ? (answer.retryAfter ?? 60) : undefined,
    );
  }

  async function run<T>(work: () => Promise<TeamClientResult<T>>): Promise<TeamClientResult<T>> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Failed) return fail(error.code, error.message);
      return fail("server", "Something went wrong.");
    }
  }

  const sessionOf = (json: Record<string, unknown>): TeamClientSession => {
    const user = asRecord(json["user"]);
    const email = typeof user["email"] === "string" ? user["email"] : "";
    const meta = asRecord(user["user_metadata"]);
    const name =
      typeof meta["name"] === "string" && meta["name"] !== ""
        ? meta["name"]
        : (email.split("@")[0] ?? "");
    return {
      token: encodeSupabaseToken({
        access: json["access_token"] as string,
        refresh: typeof json["refresh_token"] === "string" ? json["refresh_token"] : null,
      }),
      user: { name, email },
    };
  };

  /** Makes an account. Without a session in the answer, the project is asking for an email check. */
  async function signUp(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<TeamClientResult<TeamClientSession>> {
    if (input.password.length < SUPABASE_MIN_PASSWORD)
      return fail("invalid", `A password has at least ${SUPABASE_MIN_PASSWORD} characters.`);
    const answer = await send("POST", "/auth/v1/signup", {
      body: { email: input.email, password: input.password, data: { name: input.name } },
    });
    const body = asRecord(answer.json);
    if (answer.status === 200 && typeof body["access_token"] === "string")
      return ok(sessionOf(body));
    if (answer.status === 200)
      return fail(
        "invalid",
        "This project asks people to confirm their email first. Turn that off under Authentication, or set up an email provider.",
      );
    const errorCode = body["error_code"];
    if (errorCode === "user_already_exists" || errorCode === "email_exists")
      return fail("conflict", "There is already an account with that email.");
    if (errorCode === "signup_disabled")
      return fail("forbidden", "New sign-ups are turned off for this project.");
    if (errorCode === "weak_password" || answer.status === 422)
      return fail("invalid", refusal(answer, "That password is not accepted.").error.message);
    return refusal(answer, "The account was not made.");
  }

  const teamId = (id: string) => ({ p_team: id });

  return {
    version: TEAM_CLIENT_VERSION,

    health: () =>
      run(async () => {
        const answer = await rpc("murmur_health", {}, { auth: false });
        const body = asRecord(answer.json);
        if (answer.status !== 200 || typeof body["setUp"] !== "boolean")
          return fail("invalid", "That address did not answer like a Murmur team backend.");
        return ok({ setUp: body["setUp"] });
      }),

    setupOwner: (input) =>
      run(async () => {
        if (input.password.length < SUPABASE_MIN_PASSWORD)
          return fail("invalid", `A password has at least ${SUPABASE_MIN_PASSWORD} characters.`);
        const health = await rpc("murmur_health", {}, { auth: false });
        if (health.status !== 200)
          return fail("invalid", "That address did not answer like a Murmur team backend.");
        if (asRecord(health.json)["setUp"] === true)
          return fail("conflict", "This server already has an owner.");
        const made = await signUp(input);
        if (!made.ok) return made;
        const claimed = await send("POST", "/rest/v1/rpc/claim_owner", {
          body: {},
          bearer: decodeSupabaseToken(made.data.token).access,
        });
        if (claimed.status !== 200) return refusal(claimed, "The owner account was not made.");
        return made;
      }),

    signIn: (input) =>
      run(async () => {
        const answer = await send("POST", "/auth/v1/token?grant_type=password", {
          body: { email: input.email, password: input.password },
        });
        const body = asRecord(answer.json);
        if (answer.status === 200 && typeof body["access_token"] === "string")
          return ok(sessionOf(body));
        if (
          answer.status === 400 &&
          (body["error_code"] === "invalid_credentials" ||
            body["error_code"] === "email_not_confirmed" ||
            body["error"] === "invalid_grant")
        )
          return fail("unauthorized", TEAM_MESSAGES.wrongPassword);
        return refusal(answer, "The server did not sign you in.");
      }),

    signOut: () =>
      run(async () => {
        const pair = current();
        if (!pair) return ok(null);
        const answer = await send("POST", "/auth/v1/logout?scope=local", {
          body: {},
          bearer: pair.access,
        });
        renewed = null;
        // An expired token has nothing left to end.
        return answer.status < 300 || answer.status === 401
          ? ok(null)
          : refusal(answer, "Signing out did not work.");
      }),

    redeemInvite: (input) =>
      run(async () => {
        let session: TeamClientSession | null = null;
        let bearer: string | null = null;
        if (!input.signedIn) {
          // The code is checked first, so a wrong one makes no account.
          const check = await rpc("check_invite", { p_code: input.code }, { auth: false });
          if (check.status !== 200) return refusal(check, "That invite is not valid.");
          const made = await signUp({
            name: input.name ?? "",
            email: input.email ?? "",
            password: input.password ?? "",
          });
          if (!made.ok) return made;
          session = made.data;
          bearer = decodeSupabaseToken(made.data.token).access;
        }
        const answer = bearer
          ? await send("POST", "/rest/v1/rpc/redeem_invite", {
              body: { p_code: input.code },
              bearer,
            })
          : await rpc("redeem_invite", { p_code: input.code });
        if (answer.status !== 200) return refusal(answer, "The invite did not work.");
        const body = asRecord(answer.json);
        return ok({
          status: body["status"] === "pending" ? ("pending" as const) : ("joined" as const),
          teamName: typeof body["teamName"] === "string" ? body["teamName"] : "",
          session,
        });
      }),

    teams: () =>
      run(async () => {
        const answer = await rpc("my_teams", {});
        if (answer.status !== 200 || !Array.isArray(answer.json))
          return refusal(answer, "The teams could not be read.");
        return ok(answer.json as TeamSummary[]);
      }),

    vocabulary: (id, since) =>
      run(async () => {
        const answer = await rpc("team_vocabulary", { ...teamId(id), p_since: since ?? null });
        if (answer.status !== 200) return refusal(answer, "The shared entries could not be read.");
        const body = asRecord(answer.json);
        if (body["unchanged"] === true) return ok<TeamVocabularyAnswer>({ unchanged: true });
        const context = asRecord(body["context"]);
        return ok<TeamVocabularyAnswer>({
          unchanged: false,
          revision: typeof body["revision"] === "number" ? body["revision"] : 0,
          context: {
            me: typeof context["me"] === "string" ? context["me"] : "",
            team: typeof context["team"] === "string" ? context["team"] : "",
          },
          dictionary: (Array.isArray(body["dictionary"]) ? body["dictionary"] : []) as never[],
          snippets: (Array.isArray(body["snippets"]) ? body["snippets"] : []) as never[],
        });
      }),

    notices: (id) =>
      run(async () => {
        const answer = await rpc("my_notices", teamId(id));
        if (answer.status !== 200 || !Array.isArray(answer.json))
          return refusal(answer, "The notices could not be read.");
        return ok<TeamNotice[]>(
          (answer.json as { id: string; summary: string; note: string }[]).map((n) => ({
            id: n.id,
            summary: n.summary,
            note: n.note,
          })),
        );
      }),

    markNoticesSeen: (id) =>
      run(async () => {
        const answer = await rpc("mark_notices_seen", teamId(id));
        return answer.status === 200 ? ok(null) : refusal(answer, "That could not be saved.");
      }),

    policy: (id) =>
      run(async () => {
        const answer = await rpc("policy_layers", teamId(id));
        if (answer.status !== 200) return refusal(answer, "The policy could not be read.");
        const body = asRecord(answer.json);
        // The database keeps the values as the admin tool wrote them; the app uses only what its
        // own rules accept, and merges the layers with the same code that enforces them.
        const layer = (value: unknown): PolicyValues => {
          const out: Record<string, unknown> = {};
          for (const [key, raw] of Object.entries(asRecord(value))) {
            if (!isPolicyKey(key)) continue;
            const checked = checkPolicyValue(key, raw);
            if (checked.ok) out[key] = checked.value;
          }
          return out as PolicyValues;
        };
        return ok(
          mergePolicy([layer(body["team"]), layer(body["department"]), layer(body["member"])]),
        );
      }),

    sendUsage: (id, batchId, events) =>
      run(async () => {
        const answer = await rpc("send_usage", {
          ...teamId(id),
          p_batch: batchId,
          p_events: events,
        });
        return answer.status === 200 ? ok(null) : refusal(answer, "The counts were not taken.");
      }),

    reportRetention: (id, counts) =>
      run(async () => {
        const answer = await rpc("report_retention", {
          ...teamId(id),
          p_audio: counts.audio,
          p_transcripts: counts.transcripts,
        });
        return answer.status === 200 ? ok(null) : refusal(answer, "The report was not taken.");
      }),

    propose: (id, input) =>
      run(async () => {
        const args =
          input.kind === "dictionary"
            ? {
                ...teamId(id),
                p_kind: "dictionary",
                p_term: input.term,
                p_replacement: input.replacement ?? null,
              }
            : {
                ...teamId(id),
                p_kind: "snippet",
                p_trigger: input.trigger,
                p_expansion: input.expansion,
              };
        const answer = await rpc("propose_item", args);
        if (answer.status !== 200) return refusal(answer, "The team did not take that.");
        return ok<{ live: boolean }>({ live: asRecord(answer.json)["live"] === true });
      }),
  };
}
