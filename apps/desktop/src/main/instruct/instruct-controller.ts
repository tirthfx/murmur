import {
  INSTRUCT_FIELD_CHARS,
  INSTRUCT_LIMITS,
  INSTRUCT_MESSAGES,
  type InsertTextInput,
  type InstructOutcome,
  type InstructPanelState,
  type InstructSource,
  type PlatformHelper,
  type Settings,
} from "@murmur/shared";
import type { Logger } from "../helper/types";
import type { GenerationTurn } from "../cleanup/engine";
import { GenerationError, type GenerationRun, type GenerationService } from "../generation/service";
import type { RewriteContext } from "../rewrites/rewrite-controller";
import { actionInstruction, asksForAction, followUpInstruction } from "./actions";

export { followUpInstruction } from "./actions";
import type { InstructThreadStore } from "./thread-store";

/** The Instruct panel window as the controller sees it. */
export interface InstructPanelPort {
  show(state: InstructPanelState): void;
  update(state: InstructPanelState): void;
  hide(): void;
}

export interface InstructControllerDeps {
  helper: Pick<
    PlatformHelper,
    "readSelection" | "focusContext" | "insertText" | "copyText" | "pressKey"
  >;
  generation: GenerationService;
  panel: InstructPanelPort;
  /** Saved threads (RW-14); null without a database. */
  threads: Pick<
    InstructThreadStore,
    "create" | "addTurn" | "updateLastDraft" | "setOutcome" | "get"
  > | null;
  /** The model's id, for the saved turns. */
  modelId: () => string;
  /** A short message on the Bar. */
  notify: (message: string) => void;
  /** Brings the app back to the front (the panel took the keyboard). */
  activateApp: (appId: string) => Promise<void>;
  /** Style notes, Memory facts and writing samples for the app and text. */
  context: (appId: string | null, text: string) => RewriteContext;
  /** Which context Settings allow (RW-17), and whether the field may be read (DC-30). */
  settings: () => { instruct: Settings["instruct"]; contextAwareness: boolean };
  clipboardFirstInApps: () => string[];
  insertRules: () => Pick<InsertTextInput, "typeInApps" | "trimTrailingNewlinesInApps">;
  logger: Logger;
  sleep?: (ms: number) => Promise<void>;
}

export interface InstructController {
  /**
   * A spoken request (the Instruct key, RW-11): a follow-up while the panel is open, otherwise
   * a new thread with fresh context.
   */
  spoken(text: string): Promise<void>;
  /** A typed request from the panel: a follow-up, or the first request of a new thread. */
  followUp(text: string): Promise<void>;
  /** Drops the thread; the panel waits for a new first request. */
  newThread(): Promise<void>;
  /** A saved thread's last draft as the start of a new thread (RW-14). False if it is gone. */
  reuse(threadId: string): Promise<boolean>;
  insert(): Promise<void>;
  copy(): Promise<void>;
  regenerate(): Promise<void>;
  toggleSource(source: InstructSource): Promise<void>;
  close(): Promise<void>;
  state(): InstructPanelState;
}

/** Time for the app to take the keyboard back before pasting. */
export const REFOCUS_MS = 150;

interface Gathered {
  selection: string;
  field: string;
  style: string[];
  memory: string[];
  samples: string[];
}

interface Turn {
  instruction: string;
  draft: string;
}

interface Thread {
  appId: string | null;
  /** The selection was used: the draft goes after it, never over it. */
  hadSelection: boolean;
  gathered: Gathered;
  off: Set<InstructSource>;
  /** The first request asked Murmur to act (send, schedule, remind). */
  action: boolean;
  /** Requests answered so far, oldest first. */
  turns: Turn[];
  /** The request being answered (or that failed), or the last answered one. */
  instruction: string;
  /** True while `instruction` is a new request not yet in `turns`; false when the last turn is redone. */
  pending: boolean;
  /** Saved thread id, once the first draft is saved. */
  savedId: string | null;
  run: GenerationRun | null;
  state: InstructPanelState;
}

/** Sources with content, in the panel's order. */
function availableSources(gathered: Gathered): InstructSource[] {
  const available: InstructSource[] = [];
  if (gathered.selection) available.push("selection");
  if (gathered.field) available.push("field");
  if (gathered.memory.length > 0) available.push("memory");
  if (gathered.samples.length > 0) available.push("samples");
  if (gathered.style.length > 0) available.push("style");
  return available;
}

const EMPTY_CONTEXT: Gathered = { selection: "", field: "", style: [], memory: [], samples: [] };

/**
 * Instruct Mode (RW-11, RW-12, RW-17): one thread at a time, drafted with the context the
 * owner allows, refined by follow-ups up to 20 requests, and saved for 30 days. Nothing is
 * sent or scheduled; text is never logged.
 */
export function createInstructController(deps: InstructControllerDeps): InstructController {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  let thread: Thread | null = null;
  let panelOpen = false;

  /** Turns before the request being answered. */
  const before = (current: Thread) =>
    current.pending ? current.turns : current.turns.slice(0, -1);

  function base(current: Thread) {
    return {
      instruction: current.instruction,
      earlier: before(current).map((turn) => turn.instruction),
      turns: current.turns.length + (current.pending ? 1 : 0),
      available: availableSources(current.gathered),
      off: [...current.off],
    };
  }

  function show(state: InstructPanelState): void {
    if (panelOpen) deps.panel.update(state);
    else deps.panel.show(state);
    panelOpen = true;
  }

  function setState(current: Thread, state: InstructPanelState): void {
    if (thread !== current) return;
    current.state = state;
    show(state);
  }

  function save(write: () => void): void {
    try {
      write();
    } catch (error) {
      deps.logger.warn(`thread not saved: ${String(error)}`);
    }
  }

  /** The app's text and Murmur's own context, each only when Settings allow it. */
  async function gather(): Promise<{ gathered: Gathered; appId: string | null }> {
    const settings = deps.settings();
    const selection = await deps.helper
      .readSelection({ clipboardFallback: true, clipboardFirstInApps: deps.clipboardFirstInApps() })
      .catch(() => null);
    const selected = selection?.status === "ok" ? selection.text : "";
    let field = "";
    let appId = selection?.appBundleId ?? null;
    if (settings.contextAwareness && settings.instruct.fieldContext) {
      const context = await deps.helper.focusContext({}).catch(() => null);
      if (context && !context.secure) {
        appId ??= context.bundleId;
        const textBefore = context.textBefore.slice(-INSTRUCT_FIELD_CHARS);
        const textAfter = context.textAfter.slice(0, INSTRUCT_FIELD_CHARS);
        const around = `${textBefore}${textAfter}`.trim();
        // The selection is sent on its own; the field around it is the reference.
        field = around === selected.trim() ? "" : around;
      }
    }
    const own = deps.context(appId, `${selected}\n${field}`);
    return {
      appId,
      gathered: {
        selection: selected,
        field,
        style: own.style,
        memory: settings.instruct.memory ? own.memory : [],
        samples: settings.instruct.samples ? own.samples : [],
      },
    };
  }

  /** What the model is asked for the request being answered. */
  function inputFor(current: Thread) {
    const { gathered, off } = current;
    const use = (source: InstructSource) => !off.has(source);
    const previous = before(current);
    const shared = {
      kind: "instruct" as const,
      ...(use("field") && gathered.field ? { fieldText: gathered.field } : {}),
      style: use("style") ? gathered.style : [],
      memory: use("memory") ? gathered.memory : [],
      samples: use("samples") ? gathered.samples : [],
    };
    const last = previous.at(-1);
    if (!last) {
      return {
        ...shared,
        instruction: current.action ? actionInstruction(current.instruction) : current.instruction,
        text: use("selection") ? gathered.selection : "",
      };
    }
    // A follow-up: the current draft is the text; recent turns go along as the chat, and
    // older requests as a short list.
    const messages: GenerationTurn[] = previous.flatMap((turn) => [
      { role: "user" as const, text: turn.instruction },
      { role: "assistant" as const, text: turn.draft },
    ]);
    const kept = INSTRUCT_LIMITS.promptTurns / 2;
    const older = previous.slice(0, Math.max(0, previous.length - kept));
    return {
      ...shared,
      instruction: followUpInstruction(
        current.instruction,
        older.map((turn) => turn.instruction),
      ),
      text: last.draft,
      followUp: true,
      history: messages.slice(-INSTRUCT_LIMITS.promptTurns),
    };
  }

  async function write(current: Thread): Promise<void> {
    current.run?.cancel();
    let text = "";
    let loading = false;
    const running = () => setState(current, { ...base(current), stage: "running", text, loading });
    const run = deps.generation.generate(inputFor(current), {
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
    running();
    try {
      const result = await run.result;
      if (thread !== current || current.run !== run) return;
      current.run = null;
      const turn = { instruction: current.instruction, draft: result.text };
      if (current.pending) {
        current.turns.push(turn);
        current.pending = false;
        if (deps.threads && deps.settings().instruct.saveThreads) {
          const store = deps.threads;
          save(() => {
            current.savedId ??= store.create(current.appId);
            store.addTurn(current.savedId, {
              instruction: turn.instruction,
              draft: turn.draft,
              modelId: deps.modelId(),
              appBundleId: current.appId,
              durationMs: result.ms,
            });
          });
        }
      } else {
        current.turns[current.turns.length - 1] = turn;
        const id = current.savedId;
        if (id) save(() => deps.threads?.updateLastDraft(id, result.text));
      }
      const use = (source: InstructSource) => !current.off.has(source);
      const used: InstructSource[] = [
        ...(use("selection") && current.gathered.selection && current.turns.length === 1
          ? (["selection"] as const)
          : []),
        ...result.sources,
      ];
      deps.logger.info(
        `draft ${current.turns.length} written with ${used.join(", ") || "no context"}`,
      );
      setState(current, {
        ...base(current),
        stage: "draft",
        text: result.text,
        used,
        note: current.action ? INSTRUCT_MESSAGES.draftsOnly : null,
      });
    } catch (error) {
      if (thread !== current || current.run !== run) return;
      current.run = null;
      if (error instanceof GenerationError && error.code === "cancelled") return;
      setState(current, {
        ...base(current),
        stage: "message",
        message: error instanceof Error ? error.message : String(error),
        canRetry: true,
      });
    }
  }

  function outcome(current: Thread | null, value: InstructOutcome): void {
    const id = current?.savedId;
    if (id) save(() => deps.threads?.setOutcome(id, value));
  }

  /** Ends the thread; the panel goes away and the app gets the keyboard back. */
  async function end(refocus: boolean): Promise<void> {
    const current = thread;
    thread = null;
    panelOpen = false;
    current?.run?.cancel();
    deps.panel.hide();
    if (refocus && current?.appId) await deps.activateApp(current.appId);
  }

  function emptyThread(appId: string | null): Thread {
    return {
      appId,
      hadSelection: false,
      gathered: EMPTY_CONTEXT,
      off: new Set(),
      action: false,
      turns: [],
      instruction: "",
      pending: false,
      savedId: null,
      run: null,
      state: { stage: "empty" },
    };
  }

  async function ask(text: string): Promise<void> {
    const request = text.trim();
    if (request === "") {
      deps.notify(INSTRUCT_MESSAGES.nothingSaid);
      return;
    }
    const current = thread;
    if (!current || current.turns.length === 0) {
      // A new thread, or one waiting for its first request: read the context now.
      if (current?.run) return;
      const { gathered, appId } = await gather();
      const started: Thread = {
        ...emptyThread(appId ?? current?.appId ?? null),
        hadSelection: gathered.selection !== "",
        gathered,
        action: asksForAction(request),
        instruction: request,
        pending: true,
        state: { stage: "hidden" },
      };
      thread = started;
      await write(started);
      return;
    }
    if (current.run) return;
    if (current.turns.length >= INSTRUCT_LIMITS.turns) {
      deps.notify(INSTRUCT_MESSAGES.turnLimit);
      return;
    }
    current.instruction = request;
    current.pending = true;
    await write(current);
  }

  /** Writes the last answered request again (Regenerate, or a chip turned off or on). */
  async function redo(current: Thread): Promise<void> {
    if (!current.pending) {
      const last = current.turns.at(-1);
      if (!last) return;
      current.instruction = last.instruction;
    }
    await write(current);
  }

  return {
    async spoken(text) {
      if (thread && !panelOpen) await end(false);
      await ask(text);
    },

    followUp: ask,

    async newThread() {
      const current = thread;
      current?.run?.cancel();
      if (current && current.turns.length > 0) outcome(current, "discarded");
      // The new thread keeps the app, so Insert still goes back to it.
      thread = emptyThread(current?.appId ?? null);
      show({ stage: "empty" });
    },

    async reuse(threadId) {
      const saved = deps.threads?.get(threadId) ?? null;
      if (!saved || saved.textRemoved || !saved.finalDraft) return false;
      if (thread) await end(false);
      const current: Thread = {
        ...emptyThread(saved.appBundleId),
        turns: [{ instruction: saved.title, draft: saved.finalDraft }],
        instruction: saved.title,
        state: { stage: "hidden" },
      };
      thread = current;
      setState(current, {
        ...base(current),
        stage: "draft",
        text: saved.finalDraft,
        used: [],
        note: null,
      });
      return true;
    },

    async insert() {
      const current = thread;
      const draft = current?.turns.at(-1)?.draft;
      if (!current || current.run || !draft) return;
      outcome(current, "inserted");
      thread = null;
      panelOpen = false;
      deps.panel.hide();
      if (current.appId) await deps.activateApp(current.appId);
      await sleep(REFOCUS_MS);
      try {
        // Pasting over a selection would replace the text the draft was written from.
        if (current.hadSelection) {
          await deps.helper.pressKey({
            key: "right",
            modifiers: [],
            ...(current.appId ? { onlyInApp: current.appId } : {}),
          });
        }
        await deps.helper.insertText({
          text: draft,
          method: "auto",
          restoreClipboard: true,
          restoreDelayMs: 350,
          ...deps.insertRules(),
        });
        deps.notify(INSTRUCT_MESSAGES.inserted);
      } catch {
        await deps.helper.copyText(draft).catch(() => {});
        deps.notify(INSTRUCT_MESSAGES.notBack);
      }
    },

    async copy() {
      const current = thread;
      const draft = current?.turns.at(-1)?.draft;
      if (!current || current.run || !draft) return;
      await deps.helper.copyText(draft).catch(() => {});
      outcome(current, "copied");
      deps.notify(INSTRUCT_MESSAGES.copied);
      await end(true);
    },

    async regenerate() {
      const current = thread;
      if (!current || current.run || !current.instruction) return;
      await redo(current);
    },

    async toggleSource(source) {
      const current = thread;
      if (!current || current.run || !availableSources(current.gathered).includes(source)) return;
      if (current.off.has(source)) current.off.delete(source);
      else current.off.add(source);
      await redo(current);
    },

    async close() {
      const current = thread;
      if (current && current.turns.length > 0) outcome(current, "discarded");
      await end(true);
    },

    state() {
      return thread?.state ?? { stage: "hidden" };
    },
  };
}
