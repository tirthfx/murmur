import {
  GENERATION_MESSAGES,
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

/**
 * A Command Mode command that uses the model (RW-09): shown on the panel like a Rewrite, then
 * put over the text or below it.
 */
export interface CommandTask {
  name: string;
  instruction: string;
  /** The text it acts on, read just before. */
  selection: SelectionResult;
  placement: "replace" | "below";
  /** How it ended, with the text that went in (or would have) and the model's time. */
  onOutcome(outcome: RewriteOutcome, inserted: string | null, durationMs: number | null): void;
}

export interface RewriteController {
  /** The Rewrite shortcut: reads the selection and opens the panel. */
  open(): Promise<void>;
  /**
   * A Rewrite's own shortcut (RW-04): runs it on the selection without the list. With Apply
   * directly the result replaces the text and the Bar says so; otherwise the panel shows it.
   */
  runDirect(rewriteId: string): Promise<void>;
  /** A Command Mode command on the panel (RW-09): the result is shown before it goes in. */
  runCommand(task: CommandTask): Promise<void>;
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

/** What the model is asked: a Rewrite, or a command. */
interface Job {
  name: string;
  instruction: string;
  example?: string;
  rewrite: Rewrite | null;
  task: CommandTask | null;
}

const rewriteJob = (rewrite: Rewrite): Job => ({
  name: rewrite.name,
  instruction: rewrite.instruction,
  ...(rewrite.example ? { example: rewrite.example } : {}),
  rewrite,
  task: null,
});

const taskJob = (task: CommandTask): Job => ({
  name: task.name,
  instruction: task.instruction,
  rewrite: null,
  task,
});

/** The text that goes into the app for a result. */
function insertedText(job: Job | null, source: string, output: string): string {
  return job?.task?.placement === "below" ? `${source.replace(/\s+$/, "")}\n\n${output}` : output;
}

interface Session {
  selection: SelectionResult;
  job: Job | null;
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

  function record(outcome: RewriteOutcome, current: Session | null = session): void {
    const task = current?.job?.task;
    if (current && task) {
      const inserted =
        current.output === null
          ? null
          : insertedText(current.job, current.selection.text, current.output);
      try {
        task.onOutcome(outcome, inserted, current.durationMs);
      } catch (error) {
        deps.logger.warn(`command run not saved: ${String(error)}`);
      }
      return;
    }
    if (!current?.job?.rewrite || !deps.runs) return;
    try {
      deps.runs.record({
        rewriteId: current.job.rewrite.id,
        rewriteName: current.job.rewrite.name,
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

  /** Reads the selection; anything but text gives a Bar message and null. */
  async function readSelection(): Promise<SelectionResult | null> {
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
      return null;
    }
    switch (selection.status) {
      case "ok":
        return selection;
      case "too_long":
        deps.notify(REWRITE_PANEL_MESSAGES.tooLong);
        return null;
      case "secure":
        deps.notify(REWRITE_PANEL_MESSAGES.secure);
        return null;
      default:
        deps.notify(REWRITE_PANEL_MESSAGES.noSelection);
        return null;
    }
  }

  function inputFor(job: Job, selection: SelectionResult) {
    const context = deps.context(selection.appBundleId, selection.text);
    return {
      kind: job.task ? ("command" as const) : ("rewrite" as const),
      instruction: job.instruction,
      ...(job.example ? { example: job.example } : {}),
      text: selection.text,
      style: context.style,
      memory: context.memory,
      samples: context.samples,
    };
  }

  /** Drops any session in progress, as when the shortcut is pressed again. */
  function dropSession(): void {
    if (!session) return;
    if (session.output !== null) record("discarded");
    session.run?.cancel();
    session = null;
  }

  /**
   * Pastes the result over the selection, after checking it is the very same text in the same
   * app. `changed` when it is not (nothing pasted); `copied` when the paste could not happen.
   */
  async function pasteChecked(
    current: Session,
    output: string,
  ): Promise<"replaced" | "copied" | "changed"> {
    let check: SelectionResult | null;
    try {
      check = await deps.helper.readSelection(readOptions());
    } catch {
      check = null;
    }
    if (!check || check.status !== "ok" || check.hash !== current.selection.hash) return "changed";
    if (check.appBundleId !== current.selection.appBundleId) {
      await deps.helper.copyText(output).catch(() => {});
      return "copied";
    }
    try {
      await deps.helper.insertText({
        text: output,
        method: "auto",
        restoreClipboard: true,
        restoreDelayMs: 350,
        ...deps.insertRules(),
      });
      return "replaced";
    } catch {
      await deps.helper.copyText(output).catch(() => {});
      return "copied";
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

  async function start(job: Job): Promise<void> {
    const current = session;
    if (!current) return;
    current.run?.cancel();
    current.job = job;
    current.output = null;
    current.durationMs = null;
    let text = "";
    let loading = false;
    const running = () => setState({ stage: "running", rewriteName: job.name, text, loading });
    running();
    const run = deps.generation.generate(inputFor(job, current.selection), {
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
    });
    current.run = run;
    try {
      const result = await run.result;
      if (session !== current || current.run !== run) return;
      current.run = null;
      current.output = result.text;
      current.durationMs = result.ms;
      if (job.rewrite) deps.rewrites.markUsed(job.rewrite.id);
      setState({
        stage: "result",
        rewriteName: job.name,
        text: result.text,
        source: current.selection.text,
        ...(job.task?.placement === "below" ? { placement: "below" as const } : {}),
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
      dropSession();
      const selection = await readSelection();
      if (!selection) return;
      const state = listState(selection);
      if (state.stage === "list" && state.items.length === 0) {
        deps.notify(REWRITE_PANEL_MESSAGES.noRewrites);
        return;
      }
      session = { selection, job: null, output: null, durationMs: null, run: null, state };
      setState(state, true);
    },

    async runDirect(rewriteId) {
      const rewrite = deps.rewrites.get(rewriteId);
      if (!rewrite?.enabled) return;
      if (session) {
        dropSession();
        deps.panel.hide();
      }
      const selection = await readSelection();
      if (!selection) return;
      const current: Session = {
        selection,
        job: rewriteJob(rewrite),
        output: null,
        durationMs: null,
        run: null,
        state: { stage: "hidden" },
      };
      session = current;
      if (!rewrite.applyDirectly) {
        setState({ stage: "running", rewriteName: rewrite.name, text: "", loading: false }, true);
        await start(rewriteJob(rewrite));
        return;
      }
      const run = deps.generation.generate(inputFor(rewriteJob(rewrite), selection), {
        onLoading: () => deps.notify(GENERATION_MESSAGES.loading),
      });
      current.run = run;
      let output: string;
      try {
        const result = await run.result;
        output = result.text;
        current.output = output;
        current.durationMs = result.ms;
      } catch (error) {
        if (session !== current) return;
        session = null;
        const code = error instanceof GenerationError ? error.code : "error";
        if (code === "cancelled") return;
        record("failed", current);
        deps.notify(error instanceof Error ? error.message : String(error));
        return;
      }
      if (session !== current) return;
      current.run = null;
      deps.rewrites.markUsed(rewrite.id);
      const outcome = await pasteChecked(current, output);
      if (session !== current) return;
      if (outcome === "changed") {
        await deps.helper.copyText(output).catch(() => {});
        record("copied");
        deps.notify(REWRITE_PANEL_MESSAGES.changedCopied);
      } else {
        record(outcome);
        deps.notify(
          outcome === "replaced" ? REWRITE_PANEL_MESSAGES.replaced : REWRITE_PANEL_MESSAGES.notBack,
        );
      }
      session = null;
    },

    async runCommand(task) {
      if (session) {
        dropSession();
        deps.panel.hide();
      }
      const job = taskJob(task);
      session = {
        selection: task.selection,
        job,
        output: null,
        durationMs: null,
        run: null,
        state: { stage: "hidden" },
      };
      setState({ stage: "running", rewriteName: task.name, text: "", loading: false }, true);
      await start(job);
    },

    async choose(rewriteId) {
      const rewrite = deps.rewrites.get(rewriteId);
      if (!session || !rewrite || !rewrite.enabled) return;
      await start(rewriteJob(rewrite));
    },

    async regenerate() {
      if (session?.job) await start(session.job);
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
      const output = insertedText(current.job, current.selection.text, current.output);
      const app = current.selection.appBundleId;
      deps.panel.hide();
      if (app) await deps.activateApp(app);
      await sleep(REFOCUS_MS);
      // Replace only over the very same text, in the same app.
      const outcome = await pasteChecked(current, output);
      if (session !== current) return;
      if (outcome === "changed") {
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
      record(outcome);
      deps.notify(
        outcome === "replaced" ? REWRITE_PANEL_MESSAGES.replaced : REWRITE_PANEL_MESSAGES.notBack,
      );
      session = null;
    },

    async copy() {
      const current = session;
      if (!current?.output) return;
      // Only the result: "below" output is copied without the text it was made from.
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
