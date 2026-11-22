import { z } from "zod";
import {
  CONNECTOR_DATA_LIMITS,
  LINEAR_ID,
  LINEAR_SCOPES,
  type ConnectorItem,
  type ConnectorOption,
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

const GRAPHQL = "https://api.linear.app/graphql";
/** The only place a Linear token is sent. */
export const LINEAR_ORIGIN = "https://api.linear.app";

/**
 * Linear (CN-07): the owner's own OAuth application, with the one `read` scope. Linear wants an
 * exact redirect address, so the sign-in listens on port 17823: register
 * `http://127.0.0.1:17823/callback`.
 */
export const linearProvider: ConnectorProvider = {
  id: LINEAR_ID,
  name: "Linear",
  authorizeUrl: "https://linear.app/oauth/authorize",
  tokenUrl: "https://api.linear.app/oauth/token",
  revokeUrl: "https://api.linear.app/oauth/revoke",
  scopes: [...LINEAR_SCOPES],
  scopeSeparator: ",",
  loopbackPort: 17823,
  needsClientSecret: true,
  async accountLabel({ token, http }) {
    const response = await http(GRAPHQL, {
      method: "POST",
      headers: { authorization: `Bearer ${token.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ query: "{ viewer { email } }" }),
    });
    if (!response.ok) throw new Error("profile failed");
    const body = z
      .object({ data: z.object({ viewer: z.object({ email: z.string().min(3) }) }) })
      .parse(await response.json());
    return body.data.viewer.email;
  },
};

// ------------------------------------------------------------------ reads

async function query(
  fetch: Fetch,
  limits: RateLimitOptions,
  text: string,
  variables?: Record<string, unknown>,
): Promise<unknown> {
  const response = await requestWithRetry(
    fetch,
    GRAPHQL,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: text, ...(variables ? { variables } : {}) }),
    },
    limits,
    "Linear",
  );
  if (response.status === 401)
    throw new ReadError("Linear no longer accepts this sign-in. Connect again.");
  if (!response.ok) throw new ReadError(`Linear answered ${response.status}.`);
  const body = z
    .object({ data: z.unknown().optional(), errors: z.array(z.unknown()).optional() })
    .safeParse(await jsonOf(response));
  if (!body.success || (body.data.errors?.length ?? 0) > 0 || body.data.data === undefined)
    throw new ReadError("Linear sent an answer Murmur cannot read.");
  return body.data.data;
}

/** The teams the owner can pick from. */
export async function listTeams(options: {
  fetch: Fetch;
  limits: RateLimitOptions;
}): Promise<ConnectorOption[]> {
  const parsed = z
    .object({
      teams: z.object({
        nodes: z.array(z.object({ id: z.string().min(1), name: z.string(), key: z.string() })),
      }),
    })
    .safeParse(
      await query(
        options.fetch,
        options.limits,
        `{ teams(first: ${CONNECTOR_DATA_LIMITS.teams * 2}) { nodes { id name key } } }`,
      ),
    );
  if (!parsed.success) throw new ReadError("Linear sent an answer Murmur cannot read.");
  return parsed.data.teams.nodes.map((team) => ({
    id: team.id,
    label: `${team.name} (${team.key})`,
  }));
}

const issueSchema = z.object({
  id: z.string().min(1),
  identifier: z.string(),
  title: z.string(),
  url: z.string().optional(),
  updatedAt: z.string().optional(),
  state: z.object({ name: z.string(), type: z.string().optional() }).nullish(),
  team: z.object({ key: z.string() }).nullish(),
});

const FIELDS = "id identifier title url updatedAt state { name type } team { key }";
/** How far back an issue's last change may be and still be read, so a closed one shows as closed. */
const RECENT = "-P14D";

/**
 * The owner's own issues (all states, changed in the last two weeks, so closing one upstream shows
 * at the next read), and, when `assignedOnly` is off, the issues of the selected teams. Nothing
 * else is asked for.
 */
export async function readIssues(options: {
  fetch: Fetch;
  limits: RateLimitOptions;
  teams: readonly string[];
  assignedOnly: boolean;
}): Promise<ConnectorItem[]> {
  const withTeams = !options.assignedOnly && options.teams.length > 0;
  const data = z
    .object({
      viewer: z.object({ assignedIssues: z.object({ nodes: z.array(z.unknown()) }) }),
      issues: z.object({ nodes: z.array(z.unknown()) }).optional(),
    })
    .safeParse(
      await query(
        options.fetch,
        options.limits,
        `query($teams: [ID!], $recent: DateTimeOrDuration) {
          viewer { assignedIssues(first: ${CONNECTOR_DATA_LIMITS.issues}, orderBy: updatedAt, filter: { updatedAt: { gt: $recent } }) { nodes { ${FIELDS} } } }
          ${
            withTeams
              ? `issues(first: ${CONNECTOR_DATA_LIMITS.issues}, orderBy: updatedAt, filter: { team: { id: { in: $teams } }, updatedAt: { gt: $recent } }) { nodes { ${FIELDS} } }`
              : ""
          }
        }`,
        { teams: [...options.teams], recent: RECENT },
      ),
    );
  if (!data.success) throw new ReadError("Linear sent an answer Murmur cannot read.");

  const seen = new Set<string>();
  const items: ConnectorItem[] = [];
  for (const raw of [
    ...data.data.viewer.assignedIssues.nodes,
    ...(data.data.issues?.nodes ?? []),
  ]) {
    const issue = issueSchema.safeParse(raw);
    if (!issue.success || seen.has(issue.data.id)) continue;
    seen.add(issue.data.id);
    const state = issue.data.state?.name ?? "";
    const title = clip(issue.data.title, CONNECTOR_DATA_LIMITS.titleChars, true);
    items.push({
      id: issue.data.id,
      connector: LINEAR_ID,
      kind: "issue",
      title: `${issue.data.identifier} ${title}`,
      text: state ? `${state}: ${title}` : title,
      truncated: false,
      updatedAt: timeOf(issue.data.updatedAt),
      url: issue.data.url && /^https:\/\//i.test(issue.data.url) ? issue.data.url : null,
      tags: [state, issue.data.team?.key ?? ""].filter(Boolean),
    });
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, CONNECTOR_DATA_LIMITS.issues);
}
