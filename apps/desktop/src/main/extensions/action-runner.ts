import {
  EXTENSION_ACTIONS,
  PLANNED_EXTENSIONS,
  calendarEventInputSchema,
  emailDraftInputSchema,
  type ActionProposal,
  type ConnectorAccount,
  type ExtensionAction,
  type ExtensionActionId,
  type ExtensionActionState,
  type ExtensionActionView,
  type ExtensionsSettings,
  type ExtensionsView,
} from "@murmur/shared";
import type { z } from "zod";

/**
 * The only way an extension action runs (CN-12). Actions are a fixed set of built-in code, each
 * with its own connector and a confirmation that is always required: the runner never gets a
 * token or the connector service, only the two things an action offers, whether it can be used
 * and the call that does it. An action runs only for a click: the window's click handler asks for
 * it with `fromUserClick()`, and a model's output can only become a proposal (`parseProposal`),
 * which nothing runs.
 */
const CLICK = Symbol("user-click");

/** Proof that the owner clicked. Only the code that handles a click in the Hub may make one. */
export interface UserClick {
  readonly [CLICK]: true;
}

/** Makes the proof of a click. Used only where a click from the window arrives (main). */
export function fromUserClick(): UserClick {
  return { [CLICK]: true };
}

const isClick = (value: unknown): value is UserClick =>
  typeof value === "object" && value !== null && (value as { [CLICK]?: unknown })[CLICK] === true;

/** What one action offers the runner. */
export interface ActionExecutor {
  /** Whether it can be used now, apart from the extension switches, and why not. */
  state(): { available: boolean; reason: string | null };
  /** Does it, once. Returns the action's own result. */
  run(input: unknown): Promise<unknown>;
}

export interface ActionRunnerDeps {
  settings(): ExtensionsSettings;
  accounts(): ConnectorAccount[];
  executors: Record<ExtensionActionId, ActionExecutor>;
}

export type ActionRunResult = { ok: true; result: unknown } | { ok: false; message: string };

export interface ActionRunner {
  /** What the Extensions page shows. */
  view(): ExtensionsView;
  /** One action's state: whether it can run, why not, and whether it is hidden where it would be used. */
  stateOf(id: ExtensionActionId): ExtensionActionState;
  /** The actions that task and summary screens may offer: turned on, and their connector is connected. */
  visible(): ExtensionActionId[];
  /**
   * A model's answer as a proposal, or null. It only describes an action and what it would be
   * given; nothing is run and no provider is called. The owner has to click to run it.
   */
  parseProposal(text: string): ActionProposal | null;
  /** Runs an action the owner confirmed with a click. Refused without one, and when it is not ready. */
  run(id: ExtensionActionId, input: unknown, click: UserClick): Promise<ActionRunResult>;
}

/** What each action is given: the same checks as its own form. */
const INPUT_SCHEMAS: Record<ExtensionActionId, z.ZodType> = {
  draft_email: emailDraftInputSchema,
  create_event: calendarEventInputSchema,
};

const actionOf = (id: ExtensionActionId): ExtensionAction =>
  EXTENSION_ACTIONS.find((action) => action.id === id)!;

export function createActionRunner(deps: ActionRunnerDeps): ActionRunner {
  function stateOf(id: ExtensionActionId): ExtensionActionState {
    const action = EXTENSION_ACTIONS.find((candidate) => candidate.id === id);
    if (!action) return { state: "off", reason: "That action does not exist.", hidden: true };
    const settings = deps.settings();
    if (!settings.enabled)
      return { state: "off", reason: "Extensions are turned off.", hidden: true };
    if (!settings.actions[id])
      return {
        state: "off",
        reason: `Turn on “${action.name}” on the Extensions page.`,
        hidden: true,
      };
    const accounts = deps
      .accounts()
      .filter((account) => action.connectors.includes(account.connector));
    if (accounts.length === 0)
      return {
        state: "not-connected",
        reason: "Connect an account for it on the Connectors page.",
        hidden: true,
      };
    if (!accounts.some((account) => account.status === "connected"))
      return {
        state: "blocked",
        reason: "Its account needs to be connected again.",
        hidden: false,
      };
    const own = deps.executors[id].state();
    return own.available
      ? { state: "ready", reason: null, hidden: false }
      : { state: "blocked", reason: own.reason, hidden: false };
  }

  return {
    stateOf,

    view() {
      const settings = deps.settings();
      const actions: ExtensionActionView[] = EXTENSION_ACTIONS.map((action) => ({
        ...action,
        enabled: settings.enabled && settings.actions[action.id],
        status: stateOf(action.id),
        accounts: deps
          .accounts()
          .filter(
            (account) =>
              action.connectors.includes(account.connector) && account.status === "connected",
          )
          .map((account) => account.email),
      }));
      return { enabled: settings.enabled, actions, planned: [...PLANNED_EXTENSIONS] };
    },

    visible: () =>
      EXTENSION_ACTIONS.filter((action) => !stateOf(action.id).hidden).map((action) => action.id),

    parseProposal(text) {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start === -1 || end <= start) return null;
      let value: unknown;
      try {
        value = JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
      if (typeof value !== "object" || value === null) return null;
      const { action, input } = value as { action?: unknown; input?: unknown };
      const found = EXTENSION_ACTIONS.find((candidate) => candidate.id === action);
      if (!found) return null;
      // The proposal has to be something the action would accept, or it is dropped.
      if (!INPUT_SCHEMAS[found.id].safeParse(input).success) return null;
      return { actionId: found.id, input };
    },

    async run(id, input, click) {
      // A model's text, a task's words or a page cannot make this: only a click does.
      if (!isClick(click)) return { ok: false, message: "An action needs a click to run." };
      const action = EXTENSION_ACTIONS.find((candidate) => candidate.id === id);
      if (!action) return { ok: false, message: "That action does not exist." };
      const state = stateOf(id);
      if (state.state !== "ready")
        return { ok: false, message: state.reason ?? "That action cannot run now." };
      const parsed = INPUT_SCHEMAS[id].safeParse(input);
      if (!parsed.success)
        return { ok: false, message: `${actionOf(id).name} was not given what it needs.` };
      return { ok: true, result: await deps.executors[id].run(parsed.data) };
    },
  };
}
