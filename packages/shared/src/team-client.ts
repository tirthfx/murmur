import type { EffectivePolicy } from "./policy";
import type { TeamNotice, TeamProposeInput, TeamSummary } from "./team";

/**
 * The team client interface, version 1 (SW-01, SW-08). Everything the app asks of a team backend
 * goes through these methods, so the backend can be the local server today and another one later
 * without a feature noticing. The interface knows nothing about HTTP, URLs or an SDK: an
 * implementation holds the address and the session, and answers in these types.
 *
 * It is frozen: a breaking change is a new version (`teamClient.v2`) with a shim, not an edit.
 * This file imports only types, so the local server and a test can load it directly.
 */
export const TEAM_CLIENT_VERSION = "teamClient.v1";

/**
 * Every way a call can fail, in words a feature can act on. The first six are the spec's set;
 * `not_found`, `invalid` and `refused` are added because a backend answers them differently from
 * the rest and a feature treats them differently (ADR-0094).
 */
export const TEAM_CLIENT_ERRORS = [
  /** No session, or the backend ended it: sign in again. */
  "unauthorized",
  /** The session is fine and the person may not do this. */
  "forbidden",
  /** There is nothing at that name (a team, an entry). */
  "not_found",
  /** The change clashes with what is there (a duplicate, a changed entry). */
  "conflict",
  /** What was sent is not acceptable; the message says why. */
  "invalid",
  /** Too many tries; `retryAfterSeconds` says when. */
  "rate_limited",
  /** The backend could not be reached. */
  "offline",
  /** Murmur's own rules refuse to talk to that address (strict local mode). */
  "refused",
  /** The backend failed. */
  "server",
] as const;
export type TeamClientErrorCode = (typeof TEAM_CLIENT_ERRORS)[number];

export interface TeamClientError {
  code: TeamClientErrorCode;
  message: string;
  retryAfterSeconds?: number;
}

export type TeamClientResult<T> = { ok: true; data: T } | { ok: false; error: TeamClientError };

/** A signed-in session. The token is the implementation's to keep; the app stores it in the Keychain. */
export interface TeamClientSession {
  token: string;
  user: { name: string; email: string };
}

/** One shared dictionary entry as a backend returns it. */
export interface SharedEntry {
  id: string;
  term: string;
  replacement: string | null;
  pronunciation: string;
}

/** One shared snippet as a backend returns it. */
export interface SharedSnippet {
  id: string;
  trigger: string;
  expansion: string;
  format: "plain" | "markdown";
  locked: boolean;
}

/** A team's shared vocabulary, or the news that it has not changed since `since`. */
export type TeamVocabularyAnswer =
  | { unchanged: true }
  | {
      unchanged: false;
      revision: number;
      context: { me: string; team: string };
      dictionary: SharedEntry[];
      snippets: SharedSnippet[];
    };

/** One count of the usage dashboard: numbers and a kind of app, never text. */
export interface TeamUsageEvent {
  day: string;
  metric: string;
  count: number;
  bucket?: string;
}

export interface TeamClientInvite {
  code: string;
  /** For someone with no account yet. */
  name?: string;
  email?: string;
  password?: string;
  /** True when the person is already signed in (the invite is used as them). */
  signedIn: boolean;
}

export interface TeamClientInviteResult {
  status: "joined" | "pending";
  teamName: string;
  /** Present when the invite made or signed in an account. */
  session: TeamClientSession | null;
}

export interface TeamClient {
  readonly version: typeof TEAM_CLIENT_VERSION;

  /** Whether there is a backend at the address, and whether it has an owner yet. */
  health(): Promise<TeamClientResult<{ setUp: boolean }>>;
  /** The first run: makes the owner account and signs it in. */
  setupOwner(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<TeamClientResult<TeamClientSession>>;
  signIn(input: { email: string; password: string }): Promise<TeamClientResult<TeamClientSession>>;
  signOut(): Promise<TeamClientResult<null>>;
  redeemInvite(input: TeamClientInvite): Promise<TeamClientResult<TeamClientInviteResult>>;

  teams(): Promise<TeamClientResult<TeamSummary[]>>;
  /** Pass the revision last seen to get `unchanged` when nothing moved. */
  vocabulary(teamId: string, since?: number): Promise<TeamClientResult<TeamVocabularyAnswer>>;
  /** Proposals the person made that were turned down and not yet seen. */
  notices(teamId: string): Promise<TeamClientResult<TeamNotice[]>>;
  markNoticesSeen(teamId: string): Promise<TeamClientResult<null>>;
  /** What the policy says for this person in this team. */
  policy(teamId: string): Promise<TeamClientResult<EffectivePolicy>>;
  /** Sends a batch of counts; a batch id (8 to 64 letters, digits, - or _) sent twice is counted once. */
  sendUsage(
    teamId: string,
    batchId: string,
    events: readonly TeamUsageEvent[],
  ): Promise<TeamClientResult<null>>;
  /** Says that retention removed data under the policy's limit: counts only. */
  reportRetention(
    teamId: string,
    counts: { audio: number; transcripts: number },
  ): Promise<TeamClientResult<null>>;
  propose(teamId: string, input: TeamProposeInput): Promise<TeamClientResult<{ live: boolean }>>;
}

/**
 * What a local-server answer means, as one of the errors above. `status` is the HTTP status; the
 * body's own code is used where the status alone is not enough.
 */
export function teamClientErrorFor(status: number, code = ""): TeamClientErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429 || code === "delayed") return "rate_limited";
  if (status >= 500) return "server";
  if (status >= 400) return "invalid";
  return "server";
}
