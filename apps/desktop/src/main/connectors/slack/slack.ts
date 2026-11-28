import { z } from "zod";
import {
  CONNECTOR_DATA_LIMITS,
  SLACK_ID,
  SLACK_SCOPES,
  type ConnectorItem,
  type ConnectorOption,
  type SlackTag,
  type SlackUnresolved,
  type SlackUser,
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
  channels: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        is_private: z.boolean().optional(),
      }),
    )
    .optional(),
});
const usersSchema = pageSchema.extend({
  members: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().optional(),
        real_name: z.string().optional(),
        deleted: z.boolean().optional(),
        is_bot: z.boolean().optional(),
        profile: z
          .object({
            display_name: z.string().optional(),
            real_name: z.string().optional(),
            email: z.string().optional(),
          })
          .optional(),
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
    return new ReadError("That Slack channel cannot be used. Join it in Slack, or choose another.");
  if (error === "is_archived") return new ReadError("That Slack channel is archived.");
  if (error === "msg_too_long") return new ReadError("That message is too long for Slack.");
  if (error === "restricted_action" || error === "no_permission")
    return new ReadError("Slack does not let you post in that channel.");
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

/** The channels the owner can pick from: public ones, and private ones they are in when asked. */
export async function listChannels(options: {
  fetch: Fetch;
  limits: RateLimitOptions;
  includePrivate?: boolean;
}): Promise<ConnectorOption[]> {
  const found: ConnectorOption[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await call(
      options.fetch,
      "conversations.list",
      {
        types: options.includePrivate ? "public_channel,private_channel" : "public_channel",
        exclude_archived: "true",
        limit: "200",
        ...(cursor ? { cursor } : {}),
      },
      channelsSchema,
      options.limits,
    );
    for (const channel of body.channels ?? [])
      found.push({
        id: channel.id,
        label: `#${channel.name}${channel.is_private ? " (private)" : ""}`,
      });
    cursor = body.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return found.sort((a, b) => a.label.localeCompare(b.label));
}

/** The people of the workspace: who a mention can mean. Bots and deactivated accounts are left out. */
export async function listSlackUsers(options: {
  fetch: Fetch;
  limits: RateLimitOptions;
}): Promise<SlackUser[]> {
  const found: SlackUser[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await call(
      options.fetch,
      "users.list",
      { limit: "200", ...(cursor ? { cursor } : {}) },
      usersSchema,
      options.limits,
    );
    for (const member of body.members ?? []) {
      if (member.deleted || member.is_bot) continue;
      found.push({
        id: member.id,
        name: member.name ?? "",
        realName: member.profile?.real_name || member.real_name || null,
        displayName: member.profile?.display_name || null,
        email: member.profile?.email ? member.profile.email.toLowerCase() : null,
      });
    }
    cursor = body.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return found;
}

/** The names of people, to turn `<@U123>` into a name. */
async function listUsers(options: {
  fetch: Fetch;
  limits: RateLimitOptions;
}): Promise<Map<string, string>> {
  return new Map(
    (await listSlackUsers(options)).map((user) => [
      user.id,
      user.realName || user.displayName || user.name || user.id,
    ]),
  );
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

// ------------------------------------------------------------------ posting and tags (CN-05, CN-14)

/** Slack's own characters, so nothing the owner typed can become a link or a tag. */
const escapeSlack = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** `@dana`, `@dana.lee`, `@dana@example.com`: what a mention looks like in the text. */
const MENTION = /(^|[\s(])@([A-Za-z0-9][A-Za-z0-9._+-]*(?:@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)?)/g;

const trimTail = (token: string) => token.replace(/[._+-]+$/, "");

export type MentionMatch =
  { kind: "one"; user: SlackUser } | { kind: "none" } | { kind: "several" };

/**
 * Who a mention means. An address matches by email. A name matches a person's handle, display
 * name or full name once the spaces and punctuation are ignored ("dana.lee" is "Dana Lee"); when
 * nothing matches whole, a first name that only one person has matches. A name that fits more than
 * one person is not resolved: it is sent as plain text and flagged.
 */
export function matchMention(token: string, users: readonly SlackUser[]): MentionMatch {
  const pick = (found: SlackUser[]): MentionMatch =>
    found.length === 1
      ? { kind: "one", user: found[0]! }
      : found.length > 1
        ? { kind: "several" }
        : { kind: "none" };
  if (token.includes("@")) {
    const wanted = token.toLowerCase();
    return pick(users.filter((user) => user.email === wanted));
  }
  const wanted = norm(token);
  if (wanted === "") return { kind: "none" };
  const whole = users.filter((user) =>
    [user.name, user.displayName, user.realName].some((name) => name && norm(name) === wanted),
  );
  if (whole.length > 0) return pick(whole);
  return pick(
    users.filter((user) =>
      [user.displayName, user.realName].some(
        (name) => name && norm(name.trim().split(/\s+/)[0] ?? "") === wanted,
      ),
    ),
  );
}

export interface MentionResult {
  /** What is posted: the text with Slack's characters escaped and each resolved mention as `<@U123>`. */
  posted: string;
  /** What the owner sees in the preview: the text with each tag written as @Name. */
  shown: string;
  tags: SlackTag[];
  unresolved: SlackUnresolved[];
}

/**
 * Looks for @mentions in a message and, for the ones that match exactly one person, makes tags.
 * Nothing is tagged that is not in `tags`, and `shown` is the message as it will read, so the
 * preview can list every tag before anything is sent. With `users` null (tagging is off) the text
 * is only escaped: a mention stays plain text and nothing is looked up.
 */
export function resolveMentions(
  text: string,
  users: readonly SlackUser[] | null,
  maxMentions = 20,
): MentionResult {
  if (users === null) return { posted: escapeSlack(text), shown: text, tags: [], unresolved: [] };
  const tags: SlackTag[] = [];
  const unresolved: SlackUnresolved[] = [];
  const decided = new Map<string, MentionMatch>();
  const decide = (token: string): MentionMatch => {
    const key = token.toLowerCase();
    const known = decided.get(key);
    if (known) return known;
    const match =
      decided.size >= maxMentions ? ({ kind: "none" } as MentionMatch) : matchMention(token, users);
    decided.set(key, match);
    return match;
  };
  const posted = escapeSlack(text).replace(MENTION, (whole, lead: string, raw: string) => {
    const token = trimTail(raw);
    const rest = raw.slice(token.length);
    const match = decide(token);
    return match.kind === "one" ? `${lead}<@${match.user.id}>${rest}` : whole;
  });
  const shown = text.replace(MENTION, (whole, lead: string, raw: string) => {
    const token = trimTail(raw);
    const rest = raw.slice(token.length);
    const match = decide(token);
    if (match.kind !== "one") return whole;
    const name = match.user.realName || match.user.displayName || match.user.name;
    return `${lead}@${name}${rest}`;
  });
  for (const [key, match] of decided) {
    const mention = `@${[...text.matchAll(MENTION)].map((m) => trimTail(m[2]!)).find((t) => t.toLowerCase() === key) ?? key}`;
    if (match.kind === "one") {
      // One person is listed once, however they were written.
      if (tags.some((tag) => tag.userId === match.user.id)) continue;
      tags.push({
        mention,
        userId: match.user.id,
        name: match.user.realName || match.user.displayName || match.user.name,
      });
    } else unresolved.push({ mention, reason: match.kind });
  }
  return { posted, shown, tags, unresolved };
}

/**
 * Posts one message to a channel as the owner. A busy answer is waited out and the same message
 * is sent again, so a rate limit does not lose it. `link_names` is off and links are not
 * expanded, so only the tags that were previewed can notify anyone.
 */
export async function postSlackMessage(options: {
  fetch: Fetch;
  limits: RateLimitOptions;
  channelId: string;
  text: string;
}): Promise<void> {
  const response = await requestWithRetry(
    options.fetch,
    `${API}/chat.postMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        channel: options.channelId,
        text: options.text,
        link_names: false,
        unfurl_links: false,
        unfurl_media: false,
      }),
    },
    options.limits,
    "Slack",
  );
  if (!response.ok) throw new ReadError(`Slack answered ${response.status}.`);
  const parsed = pageSchema.safeParse(await jsonOf(response));
  if (!parsed.success) throw new ReadError("Slack sent an answer Murmur cannot read.");
  if (!parsed.data.ok) throw failure(parsed.data.error);
}
