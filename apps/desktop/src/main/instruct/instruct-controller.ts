import {
  INSTRUCT_FIELD_CHARS,
  INSTRUCT_MESSAGES,
  type InsertTextInput,
  type InstructPanelState,
  type InstructSource,
  type PlatformHelper,
  type Settings,
} from "@murmur/shared";
import type { Logger } from "../helper/types";
import { GenerationError, type GenerationRun, type GenerationService } from "../generation/service";
import type { RewriteContext } from "../rewrites/rewrite-controller";
import { actionInstruction, asksForAction } from "./actions";

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
  /** A spoken instruction (RW-11): reads the context, opens the panel and writes the draft. */
  start(instruction: string): Promise<void>;
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

interface Session {
  instruction: string;
  appId: string | null;
  /** The selection was used: the draft goes after it, never over it. */
  hadSelection: boolean;
  gathered: Gathered;
  off: Set<InstructSource>;
  action: boolean;
  draft: string | null;
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

/**
 * Instruct Mode (RW-11, RW-17): one thread at a time, drafted with the context the owner
 * allows. Nothing is sent or scheduled; text is never logged.
 */
export function createInstructController(deps: InstructControllerDeps): InstructController {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  let session: Session | null = null;

  function base(current: Session) {
    return {
      instruction: current.instruction,
      available: availableSources(current.gathered),
      off: [...current.off],
    };
  }

  function setState(current: Session, state: InstructPanelState, show = false): void {
    if (session !== current) return;
    current.state = state;
    if (show) deps.panel.show(state);
    else deps.panel.update(state);
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
        const before = context.textBefore.slice(-INSTRUCT_FIELD_CHARS);
        const after = context.textAfter.slice(0, INSTRUCT_FIELD_CHARS);
        // The selection is sent on its own; the field around it is the reference.
        field = `${before}${after}`.trim() === selected.trim() ? "" : `${before}${after}`.trim();
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

  async function write(current: Session): Promise<void> {
    current.run?.cancel();
    current.draft = null;
    const { gathered, off } = current;
    const use = (source: InstructSource) => !off.has(source);
    let text = "";
    let loading = false;
    const running = () => setState(current, { ...base(current), stage: "running", text, loading });
    running();
    const instruction = current.action
      ? actionInstruction(current.instruction)
      : current.instruction;
    const run = deps.generation.generate(
      {
        kind: "instruct",
        instruction,
        text: use("selection") ? gathered.selection : "",
        ...(use("field") && gathered.field ? { fieldText: gathered.field } : {}),
        style: use("style") ? gathered.style : [],
        memory: use("memory") ? gathered.memory : [],
        samples: use("samples") ? gathered.samples : [],
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
      current.draft = result.text;
      const used: InstructSource[] = [
        ...(use("selection") && gathered.selection ? (["selection"] as const) : []),
        ...result.sources,
      ];
      deps.logger.info(`draft written with ${used.join(", ") || "no context"}`);
      setState(current, {
        ...base(current),
        stage: "draft",
        text: result.text,
        used,
        note: current.action ? INSTRUCT_MESSAGES.draftsOnly : null,
      });
    } catch (error) {
      if (session !== current || current.run !== run) return;
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

  /** Ends the thread; the panel goes away and the app gets the keyboard back. */
  async function end(refocus: boolean): Promise<void> {
    const current = session;
    session = null;
    current?.run?.cancel();
    deps.panel.hide();
    if (refocus && current?.appId) await deps.activateApp(current.appId);
  }

  return {
    async start(instruction) {
      if (session) await end(false);
      if (instruction.trim() === "") {
        deps.notify(INSTRUCT_MESSAGES.nothingSaid);
        return;
      }
      const { gathered, appId } = await gather();
      const current: Session = {
        instruction: instruction.trim(),
        appId,
        hadSelection: gathered.selection !== "",
        gathered,
        off: new Set(),
        action: asksForAction(instruction),
        draft: null,
        run: null,
        state: { stage: "hidden" },
      };
      session = current;
      setState(current, { ...base(current), stage: "running", text: "", loading: false }, true);
      await write(current);
    },

    async insert() {
      const current = session;
      if (!current?.draft) return;
      const draft = current.draft;
      session = null;
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
      const current = session;
      if (!current?.draft) return;
      await deps.helper.copyText(current.draft).catch(() => {});
      deps.notify(INSTRUCT_MESSAGES.copied);
      await end(true);
    },

    async regenerate() {
      if (session) await write(session);
    },

    async toggleSource(source) {
      const current = session;
      if (!current || !availableSources(current.gathered).includes(source)) return;
      if (current.off.has(source)) current.off.delete(source);
      else current.off.add(source);
      await write(current);
    },

    async close() {
      await end(true);
    },

    state() {
      return session?.state ?? { stage: "hidden" };
    },
  };
}
