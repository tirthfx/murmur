import { z } from "zod";

/**
 * What the read connectors (Slack, Notion, Linear, GitHub; CN-05 to CN-08) hand to the rest of
 * Murmur: briefs and Ask read these items, never the providers. Each connector reads only what
 * its documented scopes allow, only from what the owner selected, and keeps the result on this Mac
 * for a limited time.
 */

export const SLACK_ID = "slack";
export const NOTION_ID = "notion";
export const LINEAR_ID = "linear";
export const GITHUB_ID = "github";

/** The connectors that read items for briefs and Ask. */
export const DATA_CONNECTOR_IDS = [SLACK_ID, NOTION_ID, LINEAR_ID, GITHUB_ID] as const;
export type DataConnectorId = (typeof DATA_CONNECTOR_IDS)[number];

/** Slack: read scopes only (a user token). Posting is not here. */
export const SLACK_SCOPES = [
  "users:read",
  "channels:read",
  "channels:history",
  "groups:read",
  "im:read",
] as const;
/** Linear: the one read scope. */
export const LINEAR_SCOPES = ["read"] as const;
/** GitHub: who the account is. What else can be read depends on the app (see ADR-0086). */
export const GITHUB_SCOPES = ["read:user"] as const;

export const ITEM_KINDS = ["message", "page", "issue", "pull_request"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** One thing a connector read, in the same shape whichever provider it came from. */
export interface ConnectorItem {
  /** The provider's id of it, unique within an account. */
  id: string;
  connector: DataConnectorId;
  kind: ItemKind;
  /** A message's channel, a page's or an issue's title. */
  title: string;
  /** Plain text. For a page, cut at the page limit. */
  text: string;
  /** True when `text` was cut at a limit. */
  truncated: boolean;
  /** Milliseconds of the last change (a message's time, a page's last edit, an issue's update). */
  updatedAt: number;
  /** An address in the provider, to open it; null when there is none. */
  url: string | null;
  /** Short plain labels: the state, the labels of an issue, the author of a message. */
  tags: string[];
}

export const CONNECTOR_DATA_LIMITS = {
  /** Messages kept for each selected Slack channel. */
  messagesPerChannel: 30,
  channels: 20,
  pages: 50,
  issues: 100,
  repos: 20,
  teams: 20,
  titleChars: 300,
  messageChars: 1000,
} as const;

// ------------------------------------------------------------------ settings

const idList = (max: number) => z.array(z.string().min(1).max(200)).max(max);

/** `connectors.slack`: only the channels the owner selected are read. Nothing is selected at first. */
export const slackSettingsSchema = z.strictObject({
  channels: idList(CONNECTOR_DATA_LIMITS.channels),
});
export type SlackSettings = z.infer<typeof slackSettingsSchema>;
export const DEFAULT_SLACK_SETTINGS: SlackSettings = { channels: [] };

/** `connectors.notion`: a page is read only if it is shared with the integration; its text is cut here. */
export const notionSettingsSchema = z.strictObject({
  maxCharsPerPage: z.number().int().min(500).max(20_000),
});
export type NotionSettings = z.infer<typeof notionSettingsSchema>;
export const DEFAULT_NOTION_SETTINGS: NotionSettings = { maxCharsPerPage: 10_000 };

/** `connectors.linear`: issues assigned to the owner, and those of the selected teams. */
export const linearSettingsSchema = z.strictObject({
  teams: idList(CONNECTOR_DATA_LIMITS.teams),
  assignedOnly: z.boolean(),
});
export type LinearSettings = z.infer<typeof linearSettingsSchema>;
export const DEFAULT_LINEAR_SETTINGS: LinearSettings = { teams: [], assignedOnly: true };

/** A repository as `owner/name`. */
export const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
/** `connectors.github`: only these repositories are ever asked about. */
export const githubSettingsSchema = z.strictObject({
  repos: z.array(z.string().regex(REPO_PATTERN)).max(CONNECTOR_DATA_LIMITS.repos),
});
export type GithubSettings = z.infer<typeof githubSettingsSchema>;
export const DEFAULT_GITHUB_SETTINGS: GithubSettings = { repos: [] };

// ------------------------------------------------------------------ what the window can ask

/** A channel or a team the owner can select. */
export interface ConnectorOption {
  id: string;
  label: string;
}

export type ConnectorOptionsResult =
  { ok: true; options: ConnectorOption[] } | { ok: false; message: string };

/** What an account has kept, for the page. */
export interface ConnectorDataStatus {
  accountId: string;
  /** How many items are kept now; 0 when none or when they have expired. */
  itemCount: number;
  /** Milliseconds of the last read; null when never. */
  readAt: number | null;
}
