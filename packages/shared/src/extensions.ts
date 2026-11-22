import { z } from "zod";
import { CALENDAR_CONNECTOR_IDS } from "./calendar";
import { GMAIL_ID } from "./gmail";

/**
 * Extensions (CN-12): what connected apps can do for other features. In M6 this is a fixed set of
 * built-in actions, each with its own connector and a confirmation that is always required;
 * Murmur does not load or run third-party code. An action runs only from a click in the Hub, and a
 * model can only propose one.
 */

export const EXTENSION_ACTION_IDS = ["draft_email", "create_event", "post_to_slack"] as const;
export type ExtensionActionId = (typeof EXTENSION_ACTION_IDS)[number];

export interface ExtensionAction {
  id: ExtensionActionId;
  name: string;
  /** What it does, in a sentence. */
  description: string;
  /** The connectors that can run it: any one connected is enough. */
  connectors: readonly string[];
  /** What it asks the provider for, in words, when the owner turns it on. */
  permission: string;
  /** Where it appears: a task, a meeting's summary. */
  surfaces: readonly string[];
  /** Every action is confirmed by a click on its preview; there is no setting that skips it. */
  requiresConfirm: true;
}

export const EXTENSION_ACTIONS: readonly ExtensionAction[] = [
  {
    id: "draft_email",
    name: "Draft email",
    description: "Puts a draft in Gmail’s Drafts folder from a task or a summary. It never sends.",
    connectors: [GMAIL_ID],
    permission: "Create drafts in Gmail",
    surfaces: ["An open task", "A meeting’s summary"],
    requiresConfirm: true,
  },
  {
    id: "create_event",
    name: "Create event",
    description: "Creates a calendar event for a task or a next meeting after you check it.",
    connectors: [...CALENDAR_CONNECTOR_IDS],
    permission: "Create and change calendar events",
    surfaces: ["An open task", "A meeting’s summary"],
    requiresConfirm: true,
  },
  {
    id: "post_to_slack",
    name: "Send to Slack",
    description:
      "Posts a summary or a task to a channel after you check the exact message and the channel. Tags are added only if you turn that option on, and are listed first.",
    connectors: ["slack"],
    permission: "Post messages as you in Slack",
    surfaces: ["An open task", "A meeting’s summary"],
    requiresConfirm: true,
  },
];

/** `extensions.settings`: the master switch, and one switch for each action, off until turned on. */
export const extensionsSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  actions: z.strictObject({
    draft_email: z.boolean(),
    create_event: z.boolean(),
    post_to_slack: z.boolean(),
  }),
});
export type ExtensionsSettings = z.infer<typeof extensionsSettingsSchema>;

export const DEFAULT_EXTENSIONS_SETTINGS: ExtensionsSettings = {
  enabled: true,
  actions: { draft_email: false, create_event: false, post_to_slack: false },
};

/** Whether an action can be used now. */
export const EXTENSION_STATES = [
  "ready",
  /** The owner has not turned it on (or extensions are off): it is not shown where it would be used. */
  "off",
  /** The connector has no account: it is not shown where it would be used. */
  "not-connected",
  /** Connected, but an account needs attention or the permission is not given. */
  "blocked",
] as const;
export type ExtensionState = (typeof EXTENSION_STATES)[number];

export interface ExtensionActionState {
  state: ExtensionState;
  /** Why it is not ready; null when it is. */
  reason: string | null;
  /** Whether it is left out of the places it would be used (tasks, summaries). */
  hidden: boolean;
}

export interface ExtensionActionView extends ExtensionAction {
  enabled: boolean;
  status: ExtensionActionState;
  /** The accounts that can run it, as their names. */
  accounts: string[];
}

/** An action that is planned and not built. */
export interface ExtensionPlanned {
  name: string;
  detail: string;
}

export interface ExtensionsView {
  enabled: boolean;
  actions: ExtensionActionView[];
  planned: ExtensionPlanned[];
}

/** What a model may propose: an action of the set and what it would be given. Never executed by itself. */
export interface ActionProposal {
  actionId: ExtensionActionId;
  input: unknown;
}

export const PLANNED_EXTENSIONS: readonly ExtensionPlanned[] = [
  { name: "Create a Linear issue", detail: "Not planned for the first release." },
];
