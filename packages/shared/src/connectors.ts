import { z } from "zod";
import {
  DEFAULT_FIREFLIES_SETTINGS,
  DEFAULT_ZOOM_SETTINGS,
  firefliesSettingsSchema,
  zoomSettingsSchema,
} from "./connector-import";
import {
  DEFAULT_GITHUB_SETTINGS,
  DEFAULT_LINEAR_SETTINGS,
  DEFAULT_NOTION_SETTINGS,
  DEFAULT_SLACK_SETTINGS,
  githubSettingsSchema,
  linearSettingsSchema,
  notionSettingsSchema,
  slackSettingsSchema,
} from "./connector-data";
import { DEFAULT_GMAIL_SETTINGS, gmailSettingsSchema } from "./gmail";

/**
 * Connectors (CN-01). A connector is a provider the owner signed in to (a calendar, a mail
 * service, a chat service). Murmur keeps one account row per sign-in; the tokens are never in the
 * database, in logs or in anything the window can read: they live in the Mac's Keychain, which is
 * reached only through the helper.
 */

/** A Keychain item: a generic password named by a service and an account. */
export const KEYCHAIN_LIMITS = { name: 200, value: 16_384 } as const;

const keychainName = z.string().min(1).max(KEYCHAIN_LIMITS.name);

export const keychainGetPayloadSchema = z.object({
  service: keychainName,
  account: keychainName,
});
export type KeychainGetInput = z.infer<typeof keychainGetPayloadSchema>;

export const keychainGetResultSchema = z.object({
  found: z.boolean(),
  /** Empty when nothing was found. */
  value: z.string().max(KEYCHAIN_LIMITS.value),
});
export type KeychainGetResult = z.infer<typeof keychainGetResultSchema>;

export const keychainSetPayloadSchema = z.object({
  service: keychainName,
  account: keychainName,
  value: z.string().min(1).max(KEYCHAIN_LIMITS.value),
});
export type KeychainSetInput = z.infer<typeof keychainSetPayloadSchema>;

export const keychainSetResultSchema = z.object({ ok: z.literal(true) });

export const keychainDeletePayloadSchema = z.object({
  service: keychainName,
  account: keychainName,
});
export type KeychainDeleteInput = z.infer<typeof keychainDeletePayloadSchema>;

export const keychainDeleteResultSchema = z.object({
  /** False when there was no such item; deleting twice is not an error. */
  deleted: z.boolean(),
});

/** The Keychain as the rest of main sees it. Tests use a fake. */
export interface Keychain {
  get(service: string, account: string): Promise<string | null>;
  set(service: string, account: string, value: string): Promise<void>;
  delete(service: string, account: string): Promise<boolean>;
}

/** The Keychain service name of a connector's tokens (`com.murmur.connector.<id>`). */
export const connectorKeychainService = (connector: string) => `com.murmur.connector.${connector}`;

/**
 * - `connected`: the account works.
 * - `needs_attention`: the token cannot be refreshed or was revoked; the owner reconnects.
 * - `disabled`: the owner turned the account off; nothing is fetched.
 */
export const CONNECTOR_STATUSES = ["connected", "needs_attention", "disabled"] as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];

export const CONNECTOR_STATUS_TEXT: Record<ConnectorStatus, string> = {
  connected: "Connected",
  needs_attention: "Needs attention",
  disabled: "Disabled",
};

/** An account as the window sees it: never a token. */
export interface ConnectorAccount {
  id: string;
  /** The provider id, for example `googleCalendar`. */
  connector: string;
  email: string;
  scopes: string[];
  status: ConnectorStatus;
  /** Why it needs attention, in plain words; null otherwise. */
  statusReason: string | null;
  lastSyncAt: number | null;
  createdAt: number;
}

// ------------------------------------------------------------------ the catalogue (CN-15)

/** One thing a connector lets Murmur do, in plain words, with the scope it comes from. */
export interface ConnectorScopeText {
  /** What the owner is agreeing to, for example "Read your calendar events". */
  text: string;
  /** True for a scope that is asked for only when the feature that needs it is turned on. */
  optional: boolean;
}

/**
 * A connector the Connectors page knows about. The page lists these whether or not the provider
 * is built yet; a connector with no provider says so instead of failing (CN-15).
 */
export interface ConnectorCatalogueEntry {
  /** The provider id used in settings, tables and the Keychain. */
  id: string;
  name: string;
  /** What Murmur reads from it, in one sentence. */
  reads: string;
  /** What it can write, off by default; null when it never writes. */
  writes: string | null;
  scopes: readonly ConnectorScopeText[];
  /** What the owner has to set up first, in plain words. */
  setup: string;
  /** Whether the provider also needs a client secret (kept in the Keychain). */
  clientSecret: boolean;
  /** Minutes between syncs when the owner has not chosen. */
  defaultSyncMinutes: number;
  /** Whether there is a write scope, so a read-only switch means something. */
  supportsWrite: boolean;
  /** How the owner signs in: an OAuth app of their own (default), or a personal key. */
  auth?: "oauth" | "key";
}

export const CONNECTOR_CATALOGUE: readonly ConnectorCatalogueEntry[] = [
  {
    id: "googleCalendar",
    name: "Google Calendar",
    reads:
      "Your calendars, and the events from yesterday to two weeks ahead: title, time, who is invited, and the meeting link.",
    writes: "Creating a follow-up event, and answering an invitation, only when you ask.",
    scopes: [
      { text: "Read your calendar events", optional: false },
      { text: "Create and change events", optional: true },
    ],
    setup:
      "An OAuth client of type Desktop app in your own Google Cloud project, with you as a test user.",
    clientSecret: true,
    defaultSyncMinutes: 15,
    supportsWrite: true,
  },
  {
    id: "outlookCalendar",
    name: "Outlook calendar",
    reads:
      "Your calendars, and the events from yesterday to two weeks ahead: title, time, who is invited, and the Teams or other meeting link.",
    writes: "Creating a follow-up event, and answering an invitation, only when you ask.",
    scopes: [
      { text: "Read your calendars", optional: false },
      { text: "Create and change events", optional: true },
    ],
    setup:
      "An app registration in Microsoft Entra, as a public client with a loopback redirect. A work account may need an administrator's consent.",
    clientSecret: false,
    defaultSyncMinutes: 15,
    supportsWrite: true,
  },
  {
    id: "gmail",
    name: "Gmail",
    reads:
      "Recent threads with the people in a meeting, and a thread you pick as the source of a reply. Attachments are never fetched.",
    writes: "Creating a draft. Murmur never sends mail.",
    scopes: [
      { text: "Read your mail", optional: true },
      { text: "Create drafts", optional: true },
    ],
    setup: "An OAuth client in the same Google Cloud project as Google Calendar.",
    clientSecret: true,
    defaultSyncMinutes: 30,
    supportsWrite: true,
  },
  {
    id: "slack",
    name: "Slack",
    reads:
      "People and channel names, and messages from the channels you choose when a brief or a question includes Slack.",
    writes: null,
    scopes: [
      { text: "Read people and channel names", optional: false },
      { text: "Read messages in the channels you choose", optional: false },
    ],
    setup:
      "A Slack app with the user scopes users:read, channels:read, channels:history, groups:read and im:read, and the redirect address http://127.0.0.1:17821/callback.",
    clientSecret: true,
    defaultSyncMinutes: 30,
    supportsWrite: false,
  },
  {
    id: "notion",
    name: "Notion",
    reads:
      "The pages and databases you share with the integration: title, last change, and the text of a page up to 10,000 characters.",
    writes: null,
    scopes: [
      { text: "Read the pages shared with the integration", optional: false },
      { text: "Read who you are", optional: false },
    ],
    setup:
      "A public Notion integration with the redirect address http://127.0.0.1:17822/callback, and the pages shared with it.",
    clientSecret: true,
    defaultSyncMinutes: 30,
    supportsWrite: false,
  },
  {
    id: "linear",
    name: "Linear",
    reads: "Issues assigned to you or in the teams you choose: status, title and last update.",
    writes: null,
    scopes: [{ text: "Read your issues", optional: false }],
    setup:
      "An OAuth application in Linear with the redirect address http://127.0.0.1:17823/callback.",
    clientSecret: true,
    defaultSyncMinutes: 30,
    supportsWrite: false,
  },
  {
    id: "github",
    name: "GitHub",
    reads:
      "Issues and pull requests you are assigned to or mentioned in, in the repositories you choose: title, state and labels.",
    writes: null,
    scopes: [{ text: "Read issues and pull requests", optional: false }],
    setup:
      "A GitHub App with read-only Issues, Pull requests and Metadata permissions, installed on the repositories you choose, with user authorization turned on (or a GitHub OAuth app, which sees what its token may see).",
    clientSecret: true,
    defaultSyncMinutes: 30,
    supportsWrite: false,
  },
  {
    id: "zoom",
    name: "Zoom",
    reads:
      "Your cloud recordings and their transcript files, to import a meeting you did not record.",
    writes: null,
    scopes: [{ text: "Read your cloud recordings", optional: false }],
    setup: "A Zoom Marketplace app with permission to read cloud recordings.",
    clientSecret: true,
    defaultSyncMinutes: 30,
    supportsWrite: false,
  },
  {
    id: "fireflies",
    name: "Fireflies",
    reads: "Your transcripts: sentences, speakers and times, and the summary when there is one.",
    writes: null,
    scopes: [{ text: "Read your transcripts with your own API key", optional: false }],
    setup: "Your personal API key from your Fireflies account (there is no OAuth app to set up).",
    clientSecret: false,
    defaultSyncMinutes: 30,
    supportsWrite: false,
    auth: "key",
  },
] as const;

/** A feature that needs a connector. It works when any one of `connectors` is connected. */
export interface ConnectorFeature {
  id: string;
  name: string;
  /** What it does with the connector, in a sentence. */
  detail: string;
  connectors: readonly string[];
  /** False for a feature whose connectors can be connected but whose feature is not built yet. */
  built: boolean;
}

export const CONNECTOR_FEATURES: readonly ConnectorFeature[] = [
  {
    id: "reminders",
    name: "Meeting reminders and starting a recording",
    detail: "Offers to record when a calendar meeting begins.",
    connectors: ["googleCalendar", "outlookCalendar"],
    built: true,
  },
  {
    id: "next-meeting",
    name: "Next meeting in the menu bar",
    detail: "Shows what is next, and joins it in one click.",
    connectors: ["googleCalendar", "outlookCalendar"],
    built: true,
  },
  {
    id: "briefs",
    name: "Meeting briefs",
    detail: "A page before a meeting: who is coming, past notes, and open tasks.",
    connectors: [
      "googleCalendar",
      "outlookCalendar",
      "gmail",
      "slack",
      "notion",
      "linear",
      "github",
    ],
    built: true,
  },
  {
    id: "email-drafts",
    name: "Follow-up email drafts",
    detail: "Puts a draft in Gmail's Drafts folder.",
    connectors: ["gmail"],
    built: true,
  },
  {
    id: "calendar-events",
    name: "Follow-up events",
    detail: "Creates a calendar event for a task or a next meeting.",
    connectors: ["googleCalendar", "outlookCalendar"],
    built: true,
  },
  {
    id: "slack-send",
    name: "Send to Slack",
    detail: "Posts a summary or a task to a channel after you check the text.",
    connectors: ["slack"],
    built: false,
  },
  {
    id: "notion-links",
    name: "Notion pages as meeting links",
    detail: "Lists your Notion pages when you attach a link to a meeting.",
    connectors: ["notion"],
    built: false,
  },
  {
    id: "import-services",
    name: "Import from Zoom and Fireflies",
    detail: "Brings in a transcript you did not record yourself.",
    connectors: ["zoom", "fireflies"],
    built: true,
  },
] as const;

export const SYNC_INTERVALS = [5, 15, 30, 60, 240] as const;

/** What the owner chose for one connector; a missing entry means the catalogue's defaults. */
export const connectorChoiceSchema = z.strictObject({
  syncIntervalMinutes: z.number().int().min(5).max(1440),
  /** True until the owner turns writing on. */
  readOnly: z.boolean(),
});
export type ConnectorChoice = z.infer<typeof connectorChoiceSchema>;

export const connectorSettingsSchema = z.strictObject({
  /** How long fetched data may be used before it is fetched again. */
  cacheTtlMinutes: z.number().int().min(1).max(1440),
  choices: z.record(z.string().max(64), connectorChoiceSchema),
  /** CN-04: what Murmur may do with Gmail. */
  gmail: gmailSettingsSchema.default(DEFAULT_GMAIL_SETTINGS),
  /** CN-05 to CN-08: what the read connectors may read. */
  slack: slackSettingsSchema.default(DEFAULT_SLACK_SETTINGS),
  notion: notionSettingsSchema.default(DEFAULT_NOTION_SETTINGS),
  linear: linearSettingsSchema.default(DEFAULT_LINEAR_SETTINGS),
  github: githubSettingsSchema.default(DEFAULT_GITHUB_SETTINGS),
  /** CN-09, CN-10: importing meetings from Zoom and Fireflies. */
  zoom: zoomSettingsSchema.default(DEFAULT_ZOOM_SETTINGS),
  fireflies: firefliesSettingsSchema.default(DEFAULT_FIREFLIES_SETTINGS),
});
export type ConnectorSettings = z.infer<typeof connectorSettingsSchema>;

export const DEFAULT_CONNECTOR_SETTINGS: ConnectorSettings = {
  cacheTtlMinutes: 15,
  choices: {},
  gmail: DEFAULT_GMAIL_SETTINGS,
  slack: DEFAULT_SLACK_SETTINGS,
  notion: DEFAULT_NOTION_SETTINGS,
  linear: DEFAULT_LINEAR_SETTINGS,
  github: DEFAULT_GITHUB_SETTINGS,
  zoom: DEFAULT_ZOOM_SETTINGS,
  fireflies: DEFAULT_FIREFLIES_SETTINGS,
};

/** The sync interval and read-only switch of a connector, with the defaults filled in. */
export function connectorChoice(
  settings: ConnectorSettings,
  entry: Pick<ConnectorCatalogueEntry, "id" | "defaultSyncMinutes">,
): ConnectorChoice {
  return (
    settings.choices[entry.id] ?? { syncIntervalMinutes: entry.defaultSyncMinutes, readOnly: true }
  );
}

/**
 * Why a connector cannot be used yet, in order:
 * - `unavailable`: the provider is not built, so there is nothing to connect.
 * - `not-set-up`: the owner has not added the OAuth client id (or secret).
 * - `ready`: it can be connected.
 */
export type ConnectorReadiness = "unavailable" | "not-set-up" | "ready";

export interface ConnectorView {
  id: string;
  name: string;
  reads: string;
  writes: string | null;
  scopes: readonly ConnectorScopeText[];
  setup: string;
  clientSecret: boolean;
  supportsWrite: boolean;
  /** `key` for a connector that signs in with a personal key. */
  auth?: "oauth" | "key";
  readiness: ConnectorReadiness;
  /** The client id the owner entered, which is not secret; null when none. */
  clientId: string | null;
  /** Whether a client secret is saved. Its value is never sent to the window. */
  clientSecretSaved: boolean;
  choice: ConnectorChoice;
  accounts: ConnectorAccount[];
  /** True while a sign-in is waiting for the browser. */
  connecting: boolean;
}

export interface ConnectorsView {
  connectors: ConnectorView[];
  cacheTtlMinutes: number;
}

export interface ConnectorFeatureState {
  feature: ConnectorFeature;
  enabled: boolean;
  /** Why it is off, in plain words; null when it works. */
  reason: string | null;
  /** The account to reconnect when that is the reason. */
  reconnect: { connectorId: string; accountId: string; email: string } | null;
}

/**
 * Whether a feature can work: some account of one of its connectors is connected. When none is
 * but one needs attention, the reason says to reconnect it (CN-15). Disabled accounts count as
 * absent. A feature whose connectors are all unbuilt says so.
 */
export function connectorFeatureState(
  feature: ConnectorFeature,
  view: Pick<ConnectorsView, "connectors">,
): ConnectorFeatureState {
  if (!feature.built)
    return {
      feature,
      enabled: false,
      reason: "Not built yet. Connecting an account does not turn it on.",
      reconnect: null,
    };
  const mine = view.connectors.filter((connector) => feature.connectors.includes(connector.id));
  const accounts = mine.flatMap((connector) =>
    connector.accounts.map((account) => ({ connector, account })),
  );
  if (accounts.some(({ account }) => account.status === "connected"))
    return { feature, enabled: true, reason: null, reconnect: null };
  const broken = accounts.find(({ account }) => account.status === "needs_attention");
  if (broken)
    return {
      feature,
      enabled: false,
      reason: `Reconnect ${broken.connector.name} (${broken.account.email}) to use this.`,
      reconnect: {
        connectorId: broken.connector.id,
        accountId: broken.account.id,
        email: broken.account.email,
      },
    };
  if (accounts.some(({ account }) => account.status === "disabled"))
    return {
      feature,
      enabled: false,
      reason: "The account is turned off on the Connectors page.",
      reconnect: null,
    };
  const names = mine.map((connector) => connector.name);
  const list =
    names.length <= 1
      ? (names[0] ?? "a connector")
      : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  if (mine.length > 0 && mine.every((connector) => connector.readiness === "unavailable"))
    return {
      feature,
      enabled: false,
      reason: `Needs ${list}, which is not built yet.`,
      reconnect: null,
    };
  return { feature, enabled: false, reason: `Connect ${list} to use this.`, reconnect: null };
}

/** The states of every feature, for the "Used by" list. */
export function connectorFeatureStates(
  view: Pick<ConnectorsView, "connectors">,
): ConnectorFeatureState[] {
  return CONNECTOR_FEATURES.map((feature) => connectorFeatureState(feature, view));
}

export type ConnectorActionResult = { ok: true; message?: string } | { ok: false; message: string };

/** What an OAuth client id or secret may look like: one line, no spaces, not too long. */
export const CLIENT_CREDENTIAL_MAX = 300;
export const isClientCredential = (value: string) =>
  value.length > 0 && value.length <= CLIENT_CREDENTIAL_MAX && /^\S+$/.test(value);
