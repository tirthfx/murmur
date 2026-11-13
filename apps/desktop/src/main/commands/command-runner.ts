import {
  COMMAND_DELETE_CONFIRM_CHARS,
  COMMAND_LAST_DICTATION_MS,
  COMMAND_MESSAGES,
  commandById,
  type CommandDefinition,
  type CommandId,
  type CommandOutcome,
  type CommandTrigger,
  type InsertTextInput,
  type PlatformHelper,
  type SelectionResult,
  UNDO_MESSAGES,
} from "@murmur/shared";
import type { Logger } from "../helper/types";
import type { RewriteController } from "../rewrites/rewrite-controller";
import { findLanguage, matchCommand, type CommandMatch } from "./match";
import type { CommandRunInput, CommandRunStore, CommandTarget } from "./run-store";
import type { UndoService } from "../undo/undo-service";

/** The last dictation that went in, for a command said with nothing selected (RW-08). */
export interface LastDictation {
  text: string;
  appBundleId: string | null;
  /** When it went in, epoch ms. */
  at: number;
}

export interface CommandRunnerDeps {
  helper: Pick<PlatformHelper, "readSelection" | "insertText" | "pressKey" | "focusContext">;
  /** The model's pick when no rule matches; null for none, or when the model cannot run. */
  chooseWithModel: (phrase: string) => Promise<CommandId | null>;
  /** The Rewrite panel, for commands that use the model. */
  panel: Pick<RewriteController, "runCommand">;
  /** A short message on the Bar. */
  notify: (message: string) => void;
  /** A yes or no question on the Bar; false when it times out. */
  ask: (message: string, detail: string) => Promise<boolean>;
  lastDictation: () => LastDictation | null;
  /** Whether the field's text may be read (context awareness); the last dictation needs it. */
  mayReadField: () => boolean;
  runs: Pick<CommandRunStore, "record"> | null;
  /** Murmur's own undo (RW-10): edits are recorded; "undo that" uses it first. */
  undo?: Pick<UndoService, "record" | "has" | "undoLast">;
  clipboardFirstInApps: () => string[];
  insertRules: () => Pick<InsertTextInput, "typeInApps" | "trimTrailingNewlinesInApps">;
  logger: Logger;
  now?: () => number;
}

export interface CommandRunner {
  /** Matches what was said to a command and runs it. Never inserts the words themselves. */
  run(phrase: string, trigger: CommandTrigger): Promise<void>;
}

/** Caret moves per key request; the helper takes at most 200. */
const MAX_REPEAT = 200;
/** The last dictation is selected key by key; longer text is not worth it. */
const MAX_SELECT_CHARS = 2000;

export function upperCase(text: string): string {
  return text.toLocaleUpperCase();
}

export function lowerCase(text: string): string {
  return text.toLocaleLowerCase();
}

/** Each word starts with a capital; the rest is kept as written. */
export function capitalise(text: string): string {
  return text.replace(
    /(^|[^\p{L}\p{N}'’])(\p{L})/gu,
    (_, before: string, letter: string) => before + letter.toLocaleUpperCase(),
  );
}

const TEXT_CHANGES: Partial<Record<CommandId, (text: string) => string>> = {
  uppercase: upperCase,
  lowercase: lowerCase,
  capitalise,
};

function graphemes(text: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length;
}

function code(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}

type Target =
  | { kind: "text"; selection: SelectionResult; target: CommandTarget }
  | { kind: "none"; message: string };

/**
 * Command Mode (RW-08, RW-09): matches a spoken command (rules, then the model choosing an id)
 * and runs it on the selection, or on the last dictation when nothing is selected. Text is
 * never logged.
 */
export function createCommandRunner(deps: CommandRunnerDeps): CommandRunner {
  const now = deps.now ?? Date.now;
  const readOptions = () => ({
    clipboardFallback: true,
    clipboardFirstInApps: deps.clipboardFirstInApps(),
  });

  function record(run: CommandRunInput): void {
    try {
      deps.runs?.record(run);
    } catch (error) {
      deps.logger.warn(`command run not saved: ${String(error)}`);
    }
  }

  async function match(
    phrase: string,
  ): Promise<{ match: CommandMatch; by: "rule" | "model" } | null> {
    const byRule = matchCommand(phrase);
    if (byRule) return { match: byRule, by: "rule" };
    if (phrase.trim() === "") return null;
    const id = await deps.chooseWithModel(phrase).catch(() => null);
    if (!id) return null;
    return {
      match: { id, language: id === "translate" ? findLanguage(phrase) : null },
      by: "model",
    };
  }

  /** With nothing selected: selects the last dictation if it is still just before the caret. */
  async function lastDictation(): Promise<Target> {
    const none: Target = { kind: "none", message: COMMAND_MESSAGES.selectText };
    const last = deps.lastDictation();
    if (!last || !last.text || now() - last.at > COMMAND_LAST_DICTATION_MS) return none;
    if (!deps.mayReadField() || !last.appBundleId) return none;
    const context = await deps.helper.focusContext({}).catch(() => null);
    if (
      !context ||
      context.secure ||
      context.bundleId !== last.appBundleId ||
      !context.textBefore.endsWith(last.text)
    ) {
      return none;
    }
    let left = graphemes(last.text);
    if (left > MAX_SELECT_CHARS) return none;
    const app = last.appBundleId;
    try {
      while (left > 0) {
        const step = Math.min(left, MAX_REPEAT);
        const pressed = await deps.helper.pressKey({
          key: "left",
          modifiers: ["shift"],
          repeat: step,
          onlyInApp: app,
        });
        if (!pressed.pressed) return none;
        left -= step;
      }
    } catch {
      return none;
    }
    const check = await deps.helper.readSelection(readOptions()).catch(() => null);
    if (check?.status === "ok" && check.text === last.text) {
      return { kind: "text", selection: check, target: "last_dictation" };
    }
    // Not the dictation after all: put the caret back where it was.
    await deps.helper.pressKey({ key: "right", modifiers: [], onlyInApp: app }).catch(() => {});
    return none;
  }

  async function textTarget(): Promise<Target> {
    let selection: SelectionResult;
    try {
      selection = await deps.helper.readSelection(readOptions());
    } catch (error) {
      return {
        kind: "none",
        message:
          code(error) === "PERMISSION_DENIED"
            ? COMMAND_MESSAGES.needsAccessibility
            : COMMAND_MESSAGES.selectText,
      };
    }
    switch (selection.status) {
      case "ok":
        return { kind: "text", selection, target: "selection" };
      case "too_long":
        return { kind: "none", message: COMMAND_MESSAGES.tooLong };
      case "secure":
        return { kind: "none", message: COMMAND_MESSAGES.secure };
      default:
        return lastDictation();
    }
  }

  async function paste(text: string): Promise<CommandOutcome> {
    try {
      await deps.helper.insertText({
        text,
        method: "auto",
        restoreClipboard: true,
        restoreDelayMs: 350,
        ...deps.insertRules(),
      });
      return "inserted";
    } catch {
      return "failed";
    }
  }

  /** An edit Murmur made, for undo. Never throws. */
  async function remember(appBundleId: string | null, before: string, after: string) {
    await deps.undo?.record("command", { appBundleId, before, after }).catch(() => {});
  }

  /** Commands that need no text: key presses, new line and new paragraph. */
  async function runWithoutText(
    command: CommandDefinition,
    base: Omit<CommandRunInput, "outcome" | "appBundleId" | "durationMs">,
    started: number,
  ): Promise<void> {
    // "undo that" (RW-10): Murmur's own undo while there is an edit to undo; the app's
    // Command+Z otherwise.
    if (command.id === "undo" && deps.undo?.has("any")) {
      const result = await deps.undo.undoLast("any");
      deps.notify(UNDO_MESSAGES[result]);
      record({
        ...base,
        outcome: result === "undone" ? "replaced" : result === "copied" ? "copied" : "failed",
        appBundleId: null,
        durationMs: now() - started,
      });
      return;
    }
    if (command.keys) {
      try {
        const result = await deps.helper.pressKey({
          key: command.keys.key,
          modifiers: command.keys.modifiers,
        });
        deps.notify(command.label);
        record({
          ...base,
          outcome: "keys_sent",
          appBundleId: result.appBundleId,
          durationMs: now() - started,
        });
      } catch (error) {
        deps.notify(
          code(error) === "PERMISSION_DENIED"
            ? COMMAND_MESSAGES.needsAccessibility
            : COMMAND_MESSAGES.failed,
        );
        record({ ...base, outcome: "failed", appBundleId: null, durationMs: now() - started });
      }
      return;
    }
    // New line or paragraph: after the selection, never over it.
    const selection = await deps.helper.readSelection(readOptions()).catch(() => null);
    if (selection?.status === "ok" || selection?.status === "too_long") {
      await deps.helper.pressKey({ key: "right", modifiers: [] }).catch(() => {});
    }
    const text = command.id === "new_paragraph" ? "\n\n" : "\n";
    const outcome = await paste(text);
    if (outcome === "failed") deps.notify(COMMAND_MESSAGES.failed);
    else await remember(selection?.appBundleId ?? null, "", text);
    record({
      ...base,
      outputText: text,
      outcome,
      appBundleId: selection?.appBundleId ?? null,
      durationMs: now() - started,
    });
  }

  return {
    async run(phrase, trigger) {
      const started = now();
      const found = await match(phrase);
      const base = {
        phrase,
        trigger,
        commandId: found?.match.id ?? null,
        language: found?.match.language ?? null,
        matchedBy: found?.by ?? null,
        target: "none" as CommandTarget,
        sourceText: null,
        outputText: null,
      };
      const command = found ? commandById(found.match.id) : null;
      if (!found || !command) {
        deps.logger.info("command not understood");
        deps.notify(COMMAND_MESSAGES.notUnderstood);
        record({ ...base, outcome: "not_understood", appBundleId: null, durationMs: null });
        return;
      }
      deps.logger.info(`command ${command.id} (by ${found.by})`);
      if (command.id === "translate" && !found.match.language) {
        deps.notify(COMMAND_MESSAGES.noLanguage);
        record({ ...base, outcome: "not_understood", appBundleId: null, durationMs: null });
        return;
      }
      if (!command.needsText) {
        await runWithoutText(command, base, started);
        return;
      }
      const target = await textTarget();
      if (target.kind === "none") {
        deps.notify(target.message);
        record({ ...base, outcome: "no_text", appBundleId: null, durationMs: null });
        return;
      }
      const { selection } = target;
      const onText = {
        ...base,
        target: target.target,
        sourceText: selection.text,
        appBundleId: selection.appBundleId,
      };

      if (command.kind === "rewrite" || command.kind === "output") {
        const language = found.match.language;
        await deps.panel.runCommand({
          name: command.id === "translate" ? `Translate to ${language}` : command.label,
          instruction: (command.instruction ?? "").replace("{language}", language ?? ""),
          selection,
          placement: command.kind === "output" ? "below" : "replace",
          onOutcome: (outcome, inserted, durationMs) => {
            record({ ...onText, outputText: inserted, outcome, durationMs });
            if (outcome === "replaced" && inserted !== null) {
              void remember(selection.appBundleId, selection.text, inserted);
            }
          },
        });
        return;
      }

      const change = TEXT_CHANGES[command.id];
      if (change) {
        const output = change(selection.text);
        const outcome = await paste(output);
        deps.notify(outcome === "failed" ? COMMAND_MESSAGES.failed : command.label);
        if (outcome === "inserted") await remember(selection.appBundleId, selection.text, output);
        record({
          ...onText,
          outputText: output,
          outcome: outcome === "inserted" ? "replaced" : outcome,
          durationMs: now() - started,
        });
        return;
      }

      // Delete: a long selection asks first (RW-09).
      if (selection.text.length > COMMAND_DELETE_CONFIRM_CHARS) {
        const yes = await deps.ask(
          COMMAND_MESSAGES.deleteAsk,
          `${selection.text.length.toLocaleString("en")} characters`,
        );
        if (!yes) {
          record({ ...onText, outcome: "discarded", durationMs: now() - started });
          return;
        }
        // The answer may come a while later: delete only the very same text.
        const check = await deps.helper.readSelection(readOptions()).catch(() => null);
        if (check?.status !== "ok" || check.hash !== selection.hash) {
          deps.notify(COMMAND_MESSAGES.changed);
          record({ ...onText, outcome: "discarded", durationMs: now() - started });
          return;
        }
      }
      try {
        const pressed = await deps.helper.pressKey({
          key: "delete",
          modifiers: [],
          ...(selection.appBundleId ? { onlyInApp: selection.appBundleId } : {}),
        });
        if (!pressed.pressed) throw new Error("another app is in front");
        deps.notify(command.label);
        record({ ...onText, outputText: "", outcome: "replaced", durationMs: now() - started });
        await remember(selection.appBundleId, selection.text, "");
      } catch {
        deps.notify(COMMAND_MESSAGES.failed);
        record({ ...onText, outcome: "failed", durationMs: now() - started });
      }
    },
  };
}
