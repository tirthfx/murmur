import {
  TEAM_CLIENT_VERSION,
  TEAM_MESSAGES,
  effectivePolicySchema,
  teamClientErrorFor,
  type TeamClient,
  type TeamClientErrorCode,
  type TeamClientResult,
  type TeamClientSession,
  type TeamNotice,
  type TeamSummary,
  type TeamVocabularyAnswer,
} from "@murmur/shared";

/**
 * The team client for the local server (`services/local-server`), over HTTP (SW-08). It holds the
 * address and the session token it is given and turns every answer into the shared types and
 * error set; nothing above it sees a status code or a URL. A second backend implements the same
 * interface and passes the same contract tests.
 */
export interface LocalTeamClientDeps {
  /** The server's address; read on every call, so connecting to another server applies at once. */
  serverUrl(): string;
  /** The session token, or null when signed out. */
  token(): string | null;
  fetch: typeof fetch;
  /** Throws when strict local mode refuses this address. */
  networkCheck(url: string): void;
}

interface Answer {
  status: number;
  json: Record<string, unknown> | null;
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

export function createLocalTeamClient(deps: LocalTeamClientDeps): TeamClient {
  async function request(
    method: string,
    path: string,
    options: { body?: unknown; auth?: boolean } = {},
  ): Promise<Answer> {
    const base = deps.serverUrl();
    const url = new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
    try {
      deps.networkCheck(url);
    } catch (error) {
      // The guard's own words say why (strict local mode, and for what).
      throw new Failed(
        "refused",
        error instanceof Error ? error.message : TEAM_MESSAGES.strictLocal,
      );
    }
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["content-type"] = "application/json";
    const token = deps.token();
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
      throw new Failed("offline", TEAM_MESSAGES.unreachable);
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

  /** The server's own words for a refusal, with the code its status means. */
  function refusal(answer: Answer, fallback: string) {
    const error = answer.json?.["error"] as
      { code?: string; message?: string; retryAfterSeconds?: number } | undefined;
    const code = teamClientErrorFor(answer.status, error?.code);
    return fail(
      code,
      typeof error?.message === "string" ? error.message : fallback,
      error?.retryAfterSeconds,
    );
  }

  /** Runs a call, turning a connection failure into an error result. */
  async function run<T>(work: () => Promise<TeamClientResult<T>>): Promise<TeamClientResult<T>> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Failed) return fail(error.code, error.message);
      return fail("server", "Something went wrong.");
    }
  }

  const session = (json: Record<string, unknown>): TeamClientSession => {
    const user = json["user"] as { name: string; email: string };
    return { token: json["token"] as string, user: { name: user.name, email: user.email } };
  };

  return {
    version: TEAM_CLIENT_VERSION,

    health: () =>
      run(async () => {
        const answer = await request("GET", "v1/health", { auth: false });
        if (answer.status !== 200 || answer.json?.["ok"] !== true)
          return fail("invalid", "That address did not answer like a Murmur team server.");
        return ok({ setUp: answer.json["setUp"] === true });
      }),

    setupOwner: (input) =>
      run(async () => {
        const answer = await request("POST", "v1/setup", {
          auth: false,
          body: { ...input, clientId: "app" },
        });
        if (answer.status !== 201 || !answer.json)
          return refusal(answer, "The owner account was not made.");
        return ok(session(answer.json));
      }),

    signIn: (input) =>
      run(async () => {
        const answer = await request("POST", "v1/sessions", {
          auth: false,
          body: { ...input, clientId: "app" },
        });
        if (answer.status !== 200 || !answer.json)
          return refusal(answer, "The server did not sign you in.");
        return ok(session(answer.json));
      }),

    signOut: () =>
      run(async () => {
        const answer = await request("DELETE", "v1/sessions/current");
        return answer.status < 300 ? ok(null) : refusal(answer, "Signing out did not work.");
      }),

    redeemInvite: (input) =>
      run(async () => {
        const body: Record<string, unknown> = { code: input.code, clientId: "app" };
        if (!input.signedIn)
          Object.assign(body, {
            name: input.name ?? "",
            email: input.email ?? "",
            password: input.password ?? "",
          });
        const answer = await request("POST", "v1/invites/redeem", { auth: input.signedIn, body });
        if (![200, 201, 202].includes(answer.status))
          return refusal(answer, "The invite did not work.");
        const granted = answer.json?.["session"] as Record<string, unknown> | undefined;
        return ok({
          status:
            answer.json?.["status"] === "pending" ? ("pending" as const) : ("joined" as const),
          teamName: (answer.json?.["team"] as { name?: string } | undefined)?.name ?? "",
          session: granted ? session(granted) : null,
        });
      }),

    teams: () =>
      run(async () => {
        const answer = await request("GET", "v1/teams");
        if (answer.status !== 200) return refusal(answer, "The teams could not be read.");
        return ok((answer.json?.["teams"] as TeamSummary[]) ?? []);
      }),

    vocabulary: (teamId, since) =>
      run(async () => {
        const answer = await request(
          "GET",
          `v1/teams/${teamId}/vocabulary/merged${since !== undefined ? `?since=${since}` : ""}`,
        );
        if (answer.status !== 200 || !answer.json)
          return refusal(answer, "The shared entries could not be read.");
        const body = answer.json;
        if (body["unchanged"] === true) return ok<TeamVocabularyAnswer>({ unchanged: true });
        return ok<TeamVocabularyAnswer>({
          unchanged: false,
          revision: body["revision"] as number,
          context: (body["context"] as { me: string; team: string } | undefined) ?? {
            me: "",
            team: "",
          },
          dictionary: (body["dictionary"] as never[]) ?? [],
          snippets: (body["snippets"] as never[]) ?? [],
        });
      }),

    notices: (teamId) =>
      run(async () => {
        const answer = await request("GET", `v1/teams/${teamId}/vocabulary/mine`);
        if (answer.status !== 200) return refusal(answer, "The notices could not be read.");
        const list =
          (answer.json?.["notices"] as { id: string; summary: string; note: string }[]) ?? [];
        return ok<TeamNotice[]>(list.map((n) => ({ id: n.id, summary: n.summary, note: n.note })));
      }),

    markNoticesSeen: (teamId) =>
      run(async () => {
        const answer = await request("POST", `v1/teams/${teamId}/vocabulary/notices/seen`, {
          body: {},
        });
        return answer.status === 200 ? ok(null) : refusal(answer, "That could not be saved.");
      }),

    policy: (teamId) =>
      run(async () => {
        const answer = await request("GET", `v1/teams/${teamId}/policy/effective`);
        if (answer.status !== 200) return refusal(answer, "The policy could not be read.");
        const parsed = effectivePolicySchema.safeParse(answer.json?.["policy"]);
        return parsed.success
          ? ok(parsed.data)
          : fail("invalid", "The policy was not in a form the app knows.");
      }),

    sendUsage: (teamId, batchId, events) =>
      run(async () => {
        const answer = await request("POST", `v1/teams/${teamId}/usage`, {
          body: { batchId, events },
        });
        return answer.status === 200 ? ok(null) : refusal(answer, "The counts were not taken.");
      }),

    reportRetention: (teamId, counts) =>
      run(async () => {
        const answer = await request("POST", `v1/teams/${teamId}/policy/report`, {
          body: {
            event: "retention_applied",
            audio: counts.audio,
            transcripts: counts.transcripts,
          },
        });
        return answer.status < 300 ? ok(null) : refusal(answer, "The report was not taken.");
      }),

    propose: (teamId, input) =>
      run(async () => {
        const body =
          input.kind === "dictionary"
            ? { term: input.term, replacement: input.replacement ?? undefined }
            : { trigger: input.trigger, expansion: input.expansion };
        const answer = await request(
          "POST",
          `v1/teams/${teamId}/${input.kind === "dictionary" ? "dictionary" : "snippets"}`,
          { body },
        );
        if (answer.status === 201) return ok<{ live: boolean }>({ live: true });
        if (answer.status === 202) return ok<{ live: boolean }>({ live: false });
        return refusal(answer, "The team did not take that.");
      }),
  };
}
