import {
  REWRITE_PANEL_MESSAGES,
  type InsertTextInput,
  type PlatformHelper,
  type Rewrite,
  type RewritePanelState,
  type SelectionResult,
} from "@murmur/shared";
import type { Logger } from "../helper/types";
import type { GenerationRun, GenerationService } from "../generation/service";
import { GenerationError } from "../generation/service";
import type { RewriteStore } from "./rewrite-store";
import type { RewriteOutcome, RewriteRunStore } from "./run-store";

/** The panel window as the controller sees it. */
export interface RewritePanelPort {
  /** Shows the panel with the keyboard, and the state. */
  show(state: RewritePanelState): void;
  /** Sends a new state to a panel that is already showing. */
  update(state: RewritePanelState): void;
  hide(): void;
}

export interface RewriteContext {
  style: string[];
  memory: string[];
  samples: string[];
}

export interface RewriteControllerDeps {
  helper: Pick<PlatformHelper, "readSelection" | "insertText" | "copyText">;
  rewrites: Pick<RewriteStore, "enabled" | "get" | "markUsed">;
  runs: Pick<RewriteRunStore, "record"> | null;
  generation: GenerationService;
  panel: RewritePanelPort;
  /** A short message on the Bar. */
  notify: (message: string) => void;
  /** Brings the app with the selection back to the front (the panel took the keyboard). */
  activateApp: (appId: string) => Promise<void>;
  /** Style notes, Memory facts and writing samples for the app and text. */
  context: (appId: string | null, text: string) => RewriteContext;
  /** Apps whose Accessibility text is wrong: their selection is copied instead. */
  clipboardFirstInApps: () => string[];
  /** The insertion rules per app (terminals, remote desktops). */
  insertRules: () => Pick<InsertTextInput, "typeInApps" | "trimTrailingNewlinesInApps">;
  logger: Logger;
  sleep?: (ms: number) => Promise<void>;
}

export interface RewriteController {
  /** The Rewrite shortcut: reads the selection and opens the panel. */
  open(): Promise<void>;
  choose(rewriteId: string): Promise<void>;
  regenerate(): Promise<void>;
  back(): void;
  replace(): Promise<void>;
  copy(): Promise<void>;
  close(): Promise<void>;
  /** What the panel shows now, for a page that has just loaded. */
  state(): RewritePanelState;
}

/** Time for the app to take the keyboard back before the selection is checked. */
export const REFOCUS_MS = 150;

interface Session {
  selection: SelectionResult;
  rewrite: Rewrite | null;
  output: string | null;
  durationMs: number | null;
  run: GenerationRun | null;
  state: RewritePanelState;
}

const detailOf = (rewrite: Rewrite) =>
  rewrite.builtinKey
    ? rewrite.description
    : rewrite.instruction.length > 90
      ? `${rewrite.instruction.slice(0, 89)}…`
      : rewrite.instruction;

/**
 * The Rewrite panel's session (RW-01): one selection, one Rewrite at a time, and what
 * happens to the result. Text is never logged.
 */
export function createRewriteController(deps: RewriteControllerDeps): RewriteController {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  let session: Session | null = null;

  function setState(state: RewritePanelState, show = false): void {
    if (session) session.state = state;
    if (show) deps.panel.show(state);
    else deps.panel.update(state);
  }

  function listState(selection: SelectionResult): RewritePanelState {
    return {
      stage: "list",
      items: deps.rewrites.enabled().map((rewrite) => ({
        id: rewrite.id,
        name: rewrite.name,
        detail: detailOf(rewrite),
      })),
      selectionLength: selection.length,
      appName: null,
    };
  }

  function readOptions() {
    return { clipboardFallback: true, clipboardFirstInApps: deps.clipboardFirstInApps() };
  }

  function record(outcome: RewriteOutcome): void {
    const current = session;
    if (!current?.rewrite || !deps.runs) return;
    try {
      deps.runs.record({
        rewriteId: current.rewrite.id,
        rewriteName: current.rewrite.name,
        sourceText: current.selection.text,
        outputText: current.output,
        outcome,
        appBundleId: current.selection.appBundleId,
        durationMs: current.durationMs,
      });
    } catch (error) {
      deps.logger.warn(`rewrite run not saved: ${String(error)}`);
    }
  }

  /** Ends the session; the panel is hidden and the app gets the keyboard back. */
  async function end(): Promise<void> {
    const current = session;
    session = null;
    current?.run?.cancel();
    deps.panel.hide();
    const app = current?.selection.appBundleId;
    if (app) await deps.activateApp(app);
  }

  async function start(rewrite: Rewrite): Promise<void> {
    const current = session;
    if (!current) return;
    current.run?.cancel();
    current.rewrite = rewrite;
    current.output = null;
    current.durationMs = null;
    let text = "";
    let loading = false;
    const running = () => setState({ stage: "running", rewriteName: rewrite.name, text, loading });
    running();
    const context = deps.context(current.selection.appBundleId, current.selection.text);
    const run = deps.generation.generate(
      {
        kind: "rewrite",
        instruction: rewrite.instruction,
        ...(rewrite.example ? { example: rewrite.example } : {}),
        text: current.selection.text,
        style: context.style,
        memory: context.memory,
        samples: context.samples,
      },
      {
        onChunk: (chunk) => {
          text += chunk;
          loading = false;
          running();
        },
        onLoading: () => {
          loading = true;
          running();
        },
        onReset: () => {
          text = "";
          running();
        },
      },
    );
    current.run = run;
    try {
      const result = await run.result;
      if (session !== current || current.run !== run) return;
      current.run = null;
      current.output = result.text;
      current.durationMs = result.ms;
      deps.rewrites.markUsed(rewrite.id);
      setState({
        stage: "result",
        rewriteName: rewrite.name,
        text: result.text,
        source: current.selection.text,
      });
    } catch (error) {
      if (session !== current || current.run !== run) return;
      current.run = null;
      const code = error instanceof GenerationError ? error.code : "error";
      if (code === "cancelled") return;
      record("failed");
      setState({
        stage: "message",
        message: error instanceof Error ? error.message : String(error),
        canCopy: false,
        canRetry: true,
      });
    }
  }

  return {
    async open() {
      if (session) {
        record("discarded");
        session.run?.cancel();
        session = null;
      }
      let selection: SelectionResult;
      try {
        selection = await deps.helper.readSelection(readOptions());
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        deps.notify(
          code === "PERMISSION_DENIED"
            ? "Rewrites need Accessibility. Turn it on in Settings."
            : "The selection could not be read",
        );
        return;
      }
      switch (selection.status) {
        case "too_long":
          deps.notify(REWRITE_PANEL_MESSAGES.tooLong);
          return;
        case "secure":
          deps.notify(REWRITE_PANEL_MESSAGES.secure);
          return;
        case "empty":
        case "unavailable":
          deps.notify(REWRITE_PANEL_MESSAGES.noSelection);
          return;
        case "ok":
          break;
      }
      const state = listState(selection);
      if (state.stage === "list" && state.items.length === 0) {
        deps.notify(REWRITE_PANEL_MESSAGES.noRewrites);
        return;
      }
      session = { selection, rewrite: null, output: null, durationMs: null, run: null, state };
      setState(state, true);
    },

    async choose(rewriteId) {
      const rewrite = deps.rewrites.get(rewriteId);
      if (!session || !rewrite || !rewrite.enabled) return;
      await start(rewrite);
    },

    async regenerate() {
      if (session?.rewrite) await start(session.rewrite);
    },

    back() {
      if (!session) return;
      session.run?.cancel();
      session.run = null;
      setState(listState(session.selection));
    },

    async replace() {
      const current = session;
      if (!current?.output) return;
      const output = current.output;
      const app = current.selection.appBundleId;
      deps.panel.hide();
      if (app) await deps.activateApp(app);
      await sleep(REFOCUS_MS);
      let check: SelectionResult | null;
      try {
        check = await deps.helper.readSelection(readOptions());
      } catch {
        check = null;
      }
      if (session !== current) return;
      // Replace only over the very same text, in the same app.
      if (!check || check.status !== "ok" || check.hash !== current.selection.hash) {
        setState(
          {
            stage: "message",
            message: REWRITE_PANEL_MESSAGES.selectionChanged,
            canCopy: true,
            canRetry: false,
          },
          true,
        );
        return;
      }
      if (check.appBundleId !== app) {
        await deps.helper.copyText(output).catch(() => {});
        record("copied");
        session = null;
        deps.notify(REWRITE_PANEL_MESSAGES.notBack);
        return;
      }
      try {
        await deps.helper.insertText({
          text: output,
          method: "auto",
          restoreClipboard: true,
          restoreDelayMs: 350,
          ...deps.insertRules(),
        });
        record("replaced");
        deps.notify(REWRITE_PANEL_MESSAGES.replaced);
      } catch {
        await deps.helper.copyText(output).catch(() => {});
        record("copied");
        deps.notify(REWRITE_PANEL_MESSAGES.notBack);
      }
      session = null;
    },

    async copy() {
      const current = session;
      if (!current?.output) return;
      await deps.helper.copyText(current.output).catch(() => {});
      record("copied");
      deps.notify(REWRITE_PANEL_MESSAGES.copied);
      await end();
    },

    async close() {
      if (!session) {
        deps.panel.hide();
        return;
      }
      if (session.output !== null) record("discarded");
      await end();
    },

    state() {
      return session?.state ?? { stage: "hidden" };
    },
  };
}
