import { z } from "zod";
import {
  CONNECTOR_DATA_LIMITS,
  GITHUB_ID,
  GITHUB_SCOPES,
  REPO_PATTERN,
  type ConnectorItem,
} from "@murmur/shared";
import type { ConnectorProvider } from "../providers";
import {
  ReadError,
  clip,
  jsonOf,
  requestWithRetry,
  timeOf,
  type Fetch,
  type RateLimitOptions,
} from "../data/http";

const API = "https://api.github.com";
/** The only place a GitHub token is sent. */
export const GITHUB_ORIGIN = "https://api.github.com";

const HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
} as const;

/**
 * GitHub (CN-08): the owner's own GitHub App (preferred) or OAuth app (ADR-0086). With a GitHub
 * App the permissions are fixed in the app (read-only Issues, Pull requests and Metadata on the
 * repositories it is installed on) and the sign-in only learns who the owner is; with an OAuth app
 * the sign-in asks for `read:user` and sees what that token may see. Either way Murmur asks only
 * about the repositories the owner selected.
 */
export const githubProvider: ConnectorProvider = {
  id: GITHUB_ID,
  name: "GitHub",
  authorizeUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  revokeUrl: null,
  scopes: [...GITHUB_SCOPES],
  loopbackPort: null,
  needsClientSecret: true,
  async accountLabel({ token, http }) {
    const response = await http(`${API}/user`, {
      headers: { ...HEADERS, authorization: `Bearer ${token.accessToken}` },
    });
    if (!response.ok) throw new Error("profile failed");
    return z.object({ login: z.string().min(1) }).parse(await response.json()).login;
  },
};

// ------------------------------------------------------------------ reads

/** What was answered for one address, kept with its ETag so an unchanged answer costs no rate limit. */
export interface EtagEntry {
  etag: string;
  items: ConnectorItem[];
}
export type EtagMap = Record<string, EtagEntry>;

const issueSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  state: z.string(),
  html_url: z.string().optional(),
  updated_at: z.string().optional(),
  labels: z.array(z.union([z.string(), z.object({ name: z.string().optional() })])).optional(),
  pull_request: z.unknown().optional(),
});

function toItem(repo: string, raw: unknown): ConnectorItem | null {
  const issue = issueSchema.safeParse(raw);
  if (!issue.success) return null;
  const title = clip(issue.data.title, CONNECTOR_DATA_LIMITS.titleChars, true);
  const labels = (issue.data.labels ?? [])
    .map((label) => (typeof label === "string" ? label : (label.name ?? "")))
    .filter(Boolean);
  const pull = issue.data.pull_request !== undefined;
  return {
    id: `${repo}#${issue.data.number}`,
    connector: GITHUB_ID,
    kind: pull ? "pull_request" : "issue",
    title: `${repo}#${issue.data.number} ${title}`,
    text: `${issue.data.state}: ${title}`,
    truncated: false,
    updatedAt: timeOf(issue.data.updated_at),
    url:
      issue.data.html_url && /^https:\/\/github\.com\//i.test(issue.data.html_url)
        ? issue.data.html_url
        : null,
    tags: [issue.data.state, ...labels.slice(0, 5)],
  };
}

/** Midnight UTC, so an address stays the same all day and an ETag can be used again. */
const dayStart = (ms: number) => Math.floor(ms / 86_400_000) * 86_400_000;
const RECENT_DAYS = 14;

/**
 * The issues and pull requests the owner is assigned to or mentioned in, in the selected
 * repositories only: a repository that is not in `repos` is never asked about. A `304` keeps what
 * was kept for that address. A repository GitHub cannot show to this sign-in is skipped and
 * named in `problems`.
 */
export async function readGithub(options: {
  fetch: Fetch;
  limits: RateLimitOptions;
  repos: readonly string[];
  login: string;
  now: number;
  etags: EtagMap;
}): Promise<{ items: ConnectorItem[]; etags: EtagMap; problems: string[] }> {
  const since = new Date(dayStart(options.now - RECENT_DAYS * 86_400_000)).toISOString();
  const next: EtagMap = {};
  const problems: string[] = [];
  const byId = new Map<string, ConnectorItem>();

  for (const repo of options.repos.filter((name) => REPO_PATTERN.test(name))) {
    for (const filter of ["assignee", "mentioned"] as const) {
      const url = `${API}/repos/${repo}/issues?${new URLSearchParams({
        state: "all",
        [filter]: options.login,
        since,
        sort: "updated",
        direction: "desc",
        per_page: "30",
      })}`;
      const known = options.etags[url];
      const response = await requestWithRetry(
        options.fetch,
        url,
        { headers: { ...HEADERS, ...(known ? { "if-none-match": known.etag } : {}) } },
        options.limits,
        "GitHub",
      );
      if (response.status === 304 && known) {
        next[url] = known;
        for (const item of known.items) byId.set(item.id, item);
        continue;
      }
      if (response.status === 401)
        throw new ReadError("GitHub no longer accepts this sign-in. Connect again.");
      if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")
        throw new ReadError("GitHub's rate limit is used up. Try again later.");
      if (response.status === 404 || response.status === 403 || response.status === 410) {
        problems.push(`${repo} cannot be read with this sign-in.`);
        break;
      }
      if (!response.ok) throw new ReadError(`GitHub answered ${response.status}.`);
      const body = z.array(z.unknown()).safeParse(await jsonOf(response));
      if (!body.success) throw new ReadError("GitHub sent an answer Murmur cannot read.");
      const items = body.data
        .map((raw) => toItem(repo, raw))
        .filter((item): item is ConnectorItem => item !== null);
      const etag = response.headers.get("etag");
      if (etag) next[url] = { etag, items };
      for (const item of items) byId.set(item.id, item);
    }
  }
  const items = [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, CONNECTOR_DATA_LIMITS.issues);
  return { items, etags: next, problems };
}
