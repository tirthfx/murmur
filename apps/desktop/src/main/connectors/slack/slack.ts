import { z } from "zod";
import {
  CONNECTOR_DATA_LIMITS,
  SLACK_ID,
  SLACK_SCOPES,
  type ConnectorItem,
  type ConnectorOption,
} from "@murmur/shared";
import type { ConnectorProvider } from "../providers";
import {
  ReadError,
  clip,
  jsonOf,
  requestWithRetry,
  type Fetch,
  type RateLimitOptions,
} from "../data/http";

const API = "https://slack.com/api";
/** The only place a Slack token is sent. */
export const SLACK_ORIGIN = "https://slack.com";

/**
 * Slack (CN-05): a user token with read scopes only, so Murmur sees what the owner sees in the
 * channels it is told to read. Slack wants an exact redirect address, so the sign-in listens on a
 * fixed port (17821): register `http://127.0.0.1:17821/callback` in the Slack app. The user scopes
 * go in `user_scope`, comma separated. Posting is not here.
 */
export const slackProvider: ConnectorProvider = {
  id: SLACK_ID,
  name: "Slack",
  authorizeUrl: "https://slack.com/oauth/v2/authorize",
  tokenUrl: "https://slack.com/api/oauth.v2.access",
  revokeUrl: null,
  scopes: [...SLACK_SCOPES],
  scopeParam: "user_scope",
  scopeSeparator: ",",
  loopbackPort: 17821,
  needsClientSecret: true,
  parseTokenResponse(body) {
    // A first sign-in nests the user's token in `authed_user`; a renewal answers at the top.
    const nested = z
      .object({
        ok: z.literal(true),
        authed_user: z.object({
          access_token: z.string().min(1),
          refresh_token: z.string().min(1).optional(),
          expires_in: z.coerce.number().positive().optional(),
          scope: z.string().optional(),
        }),
      })
      .safeParse(body);
    const flat = z
      .object({
        ok: z.literal(true),
        access_token: z.string().min(1),
        refresh_token: z.string().min(1).optional(),
        expires_in: z.coerce.number().positive().optional(),
        scope: z.string().optional(),
      })
      .safeParse(body);
    const token = nested.success ? nested.data.authed_user : flat.success ? flat.data : null;
    if (!token) return null;
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresIn: token.expires_in ?? null,
      scopes: token.scope ? token.scope.split(/[\s,]+/).filter(Boolean) : [],
    };
  },
  async accountLabel({ token, http }) {
    const response = await http(`${API}/auth.test`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.accessToken}` },
    });
    const body = z
      .object({ ok: z.literal(true), user: z.string().min(1), team: z.string().min(1) })
      .parse(await response.json());
    return `${body.team}/${body.user}`;
  },
  async revoke({ token, http }) {
    await http(`${API}/auth.revoke`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
  },
};

// ------------------------------------------------------------------ reads

const pageSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
});

const channelsSchema = pageSchema.extend({
  channels: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })).optional(),
});
const usersSchema = pageSchema.extend({
  members: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().optional(),
        real_name: z.string().optional(),
        deleted: z.boolean().optional(),
      }),
    )
    .optional(),
});
const historySchema = pageSchema.extend({
  messages: z
    .array(
      z.object({
        ts: z.string().min(1),
        user: z.string().optional(),
        text: z.string().optional(),
        subtype: z.string().optional(),
      }),
    )
    .optional(),
});

const MAX_PAGES = 5;

/** Slack answers 200 with `ok: false` and a reason; this turns the reasons the owner can fix into words. */
function failure(error: string | undefined): ReadError {
  if (error === "invalid_auth" || error === "token_revoked" || error === "account_inactive")
    return new ReadError("Slack no longer accepts this sign-in. Connect again.");
  if (error === "missing_scope" || error === "not_allowed_token_type")
    return new ReadError("Slack did not give Murmur permission to read that. Connect again.");
  if (error === "channel_not_found" || error === "not_in_channel")
    return new ReadError("A selected Slack channel cannot be read. Join it, or choose another.");
  return new ReadError("Slack could not be read just now.");
}

async function call<T extends z.ZodType<{ ok: boolean; error?: string | undefined }>>(
  fetch: Fetch,
  path: string,
  query: Record<string, string>,
  schema: T,
  limits: RateLimitOptions,
): Promise<z.infer<T>> {
  const response = await requestWithRetry(
    fetch,
    `${API}/${path}?${new URLSearchParams(query)}`,
    undefined,
    limits,
    "Slack",
  );
  if (!response.ok) throw new ReadError(`Slack answered ${response.status}.`);
  const parsed = schema.safeParse(await jsonOf(response));
  if (!parsed.success) throw new ReadError("Slack sent an answer Murmur cannot read.");
  if (!parsed.data.ok) throw failure(parsed.data.error);
  return parsed.data;
}

/** The public channels the owner can pick from. */
export async function listChannels(options: {
  fetch: Fetch;
  limits: RateLimitOptions;
}): Promise<ConnectorOption[]> {
  const found: ConnectorOption[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await call(
      options.fetch,
      "conversations.list",
      {
        types: "public_channel",
        exclude_archived: "true",
        limit: "200",
        ...(cursor ? { cursor } : {}),
      },
      channelsSchema,
      options.limits,
    );
    for (const channel of body.channels ?? [])
      found.push({ id: channel.id, label: `#${channel.name}` });
    cursor = body.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return found.sort((a, b) => a.label.localeCompare(b.label));
}

/** The names of people, to turn `<@U123>` into a name. */
async function listUsers(options: {
  fetch: Fetch;
  limits: RateLimitOptions;
}): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await call(
      options.fetch,
      "users.list",
      { limit: "200", ...(cursor ? { cursor } : {}) },
      usersSchema,
      options.limits,
    );
    for (const member of body.members ?? [])
      if (!member.deleted) names.set(member.id, member.real_name || member.name || member.id);
    cursor = body.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return names;
}

/**
 * Slack's message markup as plain text: `<@U1>` becomes a name, `<#C1|general>` and
 * `<https://x|label>` become their label, and `&amp; &lt; &gt;` are decoded. Nothing is rendered.
 */
export function slackText(text: string, names: ReadonlyMap<string, string>): string {
  return text
    .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id: string) => `@${names.get(id) ?? "someone"}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<!(?:here|channel|everyone)[^>]*>/g, "@channel")
    .replace(/<([^>|]+)\|([^>]+)>/g, "$2")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * The latest messages of the channels the owner selected, and nothing else: a channel that is
 * not in `channels` is never asked about. `sinceMs` bounds how far back to look.
 */
export async function readMessages(options: {
  fetch: Fetch;
  limits: RateLimitOptions;
  channels: readonly ConnectorOption[];
  sinceMs: number;
}): Promise<ConnectorItem[]> {
  if (options.channels.length === 0) return [];
  const names = await listUsers(options);
  const items: ConnectorItem[] = [];
  for (const channel of options.channels.slice(0, CONNECTOR_DATA_LIMITS.channels)) {
    const body = await call(
      options.fetch,
      "conversations.history",
      {
        channel: channel.id,
        limit: String(CONNECTOR_DATA_LIMITS.messagesPerChannel),
        oldest: String(Math.floor(options.sinceMs / 1000)),
      },
      historySchema,
      options.limits,
    );
    for (const message of body.messages ?? []) {
      // Joins, leaves and other notices are not messages.
      if (message.subtype || !message.text?.trim()) continue;
      const text = clip(slackText(message.text, names), CONNECTOR_DATA_LIMITS.messageChars);
      const author = message.user ? (names.get(message.user) ?? "someone") : "an app";
      items.push({
        id: `${channel.id}:${message.ts}`,
        connector: SLACK_ID,
        kind: "message",
        title: channel.label,
        text,
        truncated: message.text.length > CONNECTOR_DATA_LIMITS.messageChars,
        updatedAt: Math.round(Number(message.ts) * 1000) || 0,
        url: null,
        tags: [author],
      });
    }
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}
