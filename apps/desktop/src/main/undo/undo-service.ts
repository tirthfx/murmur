import {
  UNDO_LIMITS,
  type InsertTextInput,
  type PlatformHelper,
  type UndoKind,
  type UndoResult,
} from "@murmur/shared";
import type { Logger } from "../helper/types";

/** One edit Murmur made in another app. */
export interface UndoEdit {
  appBundleId: string | null;
  /** The text that was there before (empty for a plain insert). */
  before: string;
  /** The text Murmur left there (empty for a delete). */
  after: string;
  /** Called once the edit is undone, to mark its record. */
  onUndone?: () => void;
}

interface Entry extends UndoEdit {
  kind: UndoKind;
  at: number;
  /**
   * The field's text up to the caret right after the edit; null when the field could not be
   * read (then undo can only copy the previous text).
   */
  anchor: string | null;
}

export interface UndoServiceDeps {
  helper: Pick<
    PlatformHelper,
    "focusContext" | "pressKey" | "readSelection" | "insertText" | "copyText"
  >;
  /** Whether the field's text may be read (context awareness). */
  mayReadField: () => boolean;
  insertRules: () => Pick<InsertTextInput, "typeInApps" | "trimTrailingNewlinesInApps">;
  /** Brings the edit's app to the front first (undo from a panel that took the keyboard). */
  activateApp?: (appId: string) => Promise<void>;
  logger: Logger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface UndoService {
  /** Notes an edit just made; reads where the caret is now. Never throws. */
  record(kind: UndoKind, edit: UndoEdit): Promise<void>;
  /** Whether there is something to undo of this kind (or of either, for "any"). */
  has(kind: UndoKind | "any"): boolean;
  /**
   * Undoes the newest edit of this kind (or of either). With `refocus` the edit's app is
   * brought back first.
   */
  undoLast(kind: UndoKind | "any", options?: { refocus?: boolean }): Promise<UndoResult>;
}

/** Time for an app to take the keyboard back. */
const REFOCUS_MS = 150;
/** Text kept as the anchor: enough to be sure it is the same place. */
const ANCHOR_CHARS = 300;
/** Caret moves per key request; the helper takes at most 200. */
const MAX_REPEAT = 200;
/** Longer text is not selected key by key; its previous text is copied instead. */
const MAX_SELECT = 4000;

function graphemes(text: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length;
}

/**
 * Undo for Command Mode and Instruct Mode (RW-10, RW-13). Each edit keeps the text before and
 * after it and the text up to the caret just after it. Undo selects the edit's text again and
 * puts the old text back, but only when the field still ends with that anchor and the
 * selection is exactly what Murmur left; otherwise it refuses. Where the field cannot be read
 * the previous text is copied instead. Text is never logged.
 */
export function createUndoService(deps: UndoServiceDeps): UndoService {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const stacks: Record<UndoKind, Entry[]> = { command: [], instruct: [] };

  function live(kind: UndoKind): Entry[] {
    const window = UNDO_LIMITS[kind].windowMs;
    if (window !== null) {
      const since = now() - window;
      stacks[kind] = stacks[kind].filter((entry) => entry.at >= since);
    }
    return stacks[kind];
  }

  function newest(kind: UndoKind | "any"): Entry | null {
    const candidates = kind === "any" ? [...live("command"), ...live("instruct")] : [...live(kind)];
    return candidates.reduce<Entry | null>(
      (best, entry) => (best === null || entry.at >= best.at ? entry : best),
      null,
    );
  }

  function drop(entry: Entry): void {
    stacks[entry.kind] = stacks[entry.kind].filter((item) => item !== entry);
  }

  async function copyInstead(entry: Entry): Promise<UndoResult> {
    if (entry.before === "") return "changed";
    await deps.helper.copyText(entry.before).catch(() => {});
    return "copied";
  }

  async function undo(entry: Entry): Promise<UndoResult> {
    if (entry.anchor === null || !deps.mayReadField() || graphemes(entry.after) > MAX_SELECT) {
      return copyInstead(entry);
    }
    const context = await deps.helper.focusContext({}).catch(() => null);
    if (!context || context.secure) return copyInstead(entry);
    if (context.bundleId !== entry.appBundleId || !context.textBefore.endsWith(entry.anchor)) {
      return "changed";
    }
    const app = entry.appBundleId ?? undefined;
    const only = app ? { onlyInApp: app } : {};
    if (entry.after !== "") {
      let left = graphemes(entry.after);
      while (left > 0) {
        const step = Math.min(left, MAX_REPEAT);
        const pressed = await deps.helper.pressKey({
          key: "left",
          modifiers: ["shift"],
          repeat: step,
          ...only,
        });
        if (!pressed.pressed) return "changed";
        left -= step;
      }
      const selected = await deps.helper
        .readSelection({ clipboardFallback: true })
        .catch(() => null);
      if (selected?.status !== "ok" || selected.text !== entry.after) {
        await deps.helper.pressKey({ key: "right", modifiers: [], ...only }).catch(() => {});
        return "changed";
      }
    }
    if (entry.before !== "") {
      await deps.helper.insertText({
        text: entry.before,
        method: "auto",
        restoreClipboard: true,
        restoreDelayMs: 350,
        ...deps.insertRules(),
      });
    } else {
      await deps.helper.pressKey({ key: "delete", modifiers: [], ...only });
    }
    return "undone";
  }

  return {
    async record(kind, edit) {
      let anchor: string | null = null;
      if (deps.mayReadField()) {
        const context = await deps.helper.focusContext({}).catch(() => null);
        if (
          context &&
          !context.secure &&
          context.bundleId === edit.appBundleId &&
          context.textBefore.endsWith(edit.after)
        ) {
          anchor = context.textBefore.slice(
            -Math.max(ANCHOR_CHARS, Math.min(edit.after.length, 2000)),
          );
        }
      }
      const stack = live(kind);
      stack.push({ ...edit, kind, at: now(), anchor });
      const max = UNDO_LIMITS[kind].entries;
      if (stack.length > max) stack.splice(0, stack.length - max);
    },

    has(kind) {
      return newest(kind) !== null;
    },

    async undoLast(kind, options = {}) {
      const entry = newest(kind);
      if (!entry) return "nothing";
      drop(entry);
      if (options.refocus && entry.appBundleId && deps.activateApp) {
        await deps.activateApp(entry.appBundleId);
        await sleep(REFOCUS_MS);
      }
      let result: UndoResult;
      try {
        result = await undo(entry);
      } catch (error) {
        deps.logger.warn(`undo failed: ${String(error)}`);
        result = await copyInstead(entry);
      }
      deps.logger.info(`undo ${entry.kind}: ${result}`);
      if (result === "undone") {
        try {
          entry.onUndone?.();
        } catch (error) {
          deps.logger.warn(`undo not saved: ${String(error)}`);
        }
      }
      return result;
    },
  };
}
