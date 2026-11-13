import { describe, expect, it, vi } from "vitest";
import {
  COMMAND_MESSAGES,
  type CommandId,
  type FocusContext,
  type KeysPressInput,
  type SelectionResult,
} from "@murmur/shared";
import { createTestLogger } from "../helper/fakes";
import type { CommandTask } from "../rewrites/rewrite-controller";
import { capitalise, createCommandRunner, type LastDictation } from "./command-runner";
import type { CommandRunInput } from "./run-store";

function selected(text: string, app = "com.apple.Notes"): SelectionResult {
  return {
    status: text ? "ok" : "empty",
    text,
    length: text.length,
    range: null,
    hash: text ? `${"a".repeat(63)}${text.length % 10}` : "",
    source: text ? "ax" : null,
    appBundleId: app,
  };
}

function context(textBefore: string, bundleId = "com.apple.Notes"): FocusContext {
  return {
    appName: "Notes",
    bundleId,
    windowTitle: null,
    role: null,
    subrole: null,
    editable: true,
    secure: false,
    textBefore,
    textAfter: "",
  };
}

interface Options {
  selections?: SelectionResult[];
  model?: CommandId | null;
  answer?: boolean;
  last?: LastDictation | null;
  field?: FocusContext;
  mayRead?: boolean;
}

function setup(options: Options = {}) {
  const selections = [...(options.selections ?? [selected("Hello there friend")])];
  const keys: KeysPressInput[] = [];
  const inserted: string[] = [];
  const messages: string[] = [];
  const runs: CommandRunInput[] = [];
  const tasks: CommandTask[] = [];
  const asked: string[] = [];
  const helper = {
    readSelection: vi.fn(async () => selections.shift() ?? selected("")),
    insertText: vi.fn(async (input: { text: string }) => {
      inserted.push(input.text);
      return { method: "paste_cmd_v" as const, delivered: true, clipboardRestored: true };
    }),
    pressKey: vi.fn(async (input: KeysPressInput) => {
      keys.push(input);
      return { pressed: true, appBundleId: "com.apple.Notes" };
    }),
    focusContext: vi.fn(async () => options.field ?? context("")),
  };
  const chooseWithModel = vi.fn(async () => options.model ?? null);
  const runner = createCommandRunner({
    helper,
    chooseWithModel,
    panel: { runCommand: async (task) => void tasks.push(task) },
    notify: (message) => messages.push(message),
    ask: async (message) => {
      asked.push(message);
      return options.answer ?? false;
    },
    lastDictation: () => options.last ?? null,
    mayReadField: () => options.mayRead ?? true,
    runs: { record: (run) => (runs.push(run), "id") },
    clipboardFirstInApps: () => [],
    insertRules: () => ({}),
    logger: createTestLogger(),
    now: () => 1_000_000,
  });
  return { runner, helper, keys, inserted, messages, runs, tasks, asked, chooseWithModel };
}

describe("command runner", () => {
  it("presses Command+B for bold, without reading the selection", async () => {
    const { runner, keys, helper, runs } = setup();
    await runner.run("bold that", "key");
    expect(keys).toEqual([{ key: "b", modifiers: ["command"] }]);
    expect(helper.readSelection).not.toHaveBeenCalled();
    expect(runs[0]).toMatchObject({ commandId: "bold", outcome: "keys_sent", matchedBy: "rule" });
  });

  it("changes case in Murmur and pastes it over the selection", async () => {
    const { runner, inserted, runs } = setup();
    await runner.run("uppercase that", "wake_phrase");
    expect(inserted).toEqual(["HELLO THERE FRIEND"]);
    expect(runs[0]).toMatchObject({
      commandId: "uppercase",
      target: "selection",
      sourceText: "Hello there friend",
      outputText: "HELLO THERE FRIEND",
      outcome: "replaced",
    });
  });

  it("capitalises each word and keeps the rest", () => {
    expect(capitalise("the iPhone's case, at 3pm")).toBe("The IPhone's Case, At 3pm");
  });

  it("sends a model command to the panel, with the language filled in", async () => {
    const { runner, tasks, runs } = setup();
    await runner.run("translate this into French", "key");
    expect(tasks[0]).toMatchObject({
      name: "Translate to French",
      placement: "replace",
      selection: { text: "Hello there friend" },
    });
    expect(tasks[0]!.instruction).toContain("into French");
    tasks[0]!.onOutcome("replaced", "Bonjour", 800);
    expect(runs[0]).toMatchObject({
      commandId: "translate",
      language: "French",
      outputText: "Bonjour",
      outcome: "replaced",
      durationMs: 800,
    });
  });

  it("puts a summary below the text", async () => {
    const { runner, tasks } = setup();
    await runner.run("add a summary below", "key");
    expect(tasks[0]).toMatchObject({ name: "Add a summary below", placement: "below" });
  });

  it("asks for a language when none was said", async () => {
    const { runner, messages, tasks } = setup();
    await runner.run("translate this", "key");
    expect(messages).toEqual([COMMAND_MESSAGES.noLanguage]);
    expect(tasks).toEqual([]);
  });

  it("asks the model when no rule matches, and uses only its command id", async () => {
    const { runner, chooseWithModel, keys, runs } = setup({ model: "italic" });
    await runner.run("slant those words", "key");
    expect(chooseWithModel).toHaveBeenCalledWith("slant those words");
    expect(keys).toEqual([{ key: "i", modifiers: ["command"] }]);
    expect(runs[0]).toMatchObject({ commandId: "italic", matchedBy: "model" });
  });

  it("inserts nothing when nothing matches", async () => {
    const { runner, messages, inserted, keys, runs } = setup();
    await runner.run("what's the weather", "wake_phrase");
    expect(messages).toEqual([COMMAND_MESSAGES.notUnderstood]);
    expect(inserted).toEqual([]);
    expect(keys).toEqual([]);
    expect(runs[0]).toMatchObject({ commandId: null, outcome: "not_understood" });
  });

  it("deletes a short selection with the Delete key", async () => {
    const { runner, keys, asked, runs } = setup();
    await runner.run("delete that", "key");
    expect(asked).toEqual([]);
    expect(keys).toEqual([{ key: "delete", modifiers: [], onlyInApp: "com.apple.Notes" }]);
    expect(runs[0]).toMatchObject({ outcome: "replaced", outputText: "" });
  });

  it("asks before deleting more than 200 characters", async () => {
    const long = selected("x".repeat(450));
    const declined = setup({ selections: [long] });
    await declined.runner.run("delete that", "key");
    expect(declined.asked).toEqual([COMMAND_MESSAGES.deleteAsk]);
    expect(declined.keys).toEqual([]);
    expect(declined.runs[0]).toMatchObject({ outcome: "discarded" });

    const accepted = setup({ selections: [long, long], answer: true });
    await accepted.runner.run("delete that", "key");
    expect(accepted.keys.map((key) => key.key)).toEqual(["delete"]);

    const changed = setup({ selections: [long, selected("other")], answer: true });
    await changed.runner.run("delete that", "key");
    expect(changed.keys).toEqual([]);
    expect(changed.messages).toEqual([COMMAND_MESSAGES.changed]);
  });

  it("acts on the last dictation when nothing is selected", async () => {
    const last = { text: "see you soon", appBundleId: "com.apple.Notes", at: 1_000_000 - 60_000 };
    const { runner, keys, inserted, runs } = setup({
      selections: [selected(""), selected("see you soon")],
      last,
      field: context("Thanks! see you soon"),
    });
    await runner.run("uppercase that", "key");
    expect(keys).toEqual([
      { key: "left", modifiers: ["shift"], repeat: 12, onlyInApp: "com.apple.Notes" },
    ]);
    expect(inserted).toEqual(["SEE YOU SOON"]);
    expect(runs[0]).toMatchObject({ target: "last_dictation" });
  });

  it("says to select text when the last dictation is old, elsewhere or not before the caret", async () => {
    const recent = { text: "see you soon", appBundleId: "com.apple.Notes", at: 1_000_000 - 1000 };
    const cases: Options[] = [
      { last: null },
      { last: { ...recent, at: 1_000_000 - 6 * 60_000 } },
      { last: recent, field: context("see you soon", "com.apple.mail") },
      { last: recent, field: context("see you later") },
      { last: recent, field: context("see you soon"), mayRead: false },
    ];
    for (const options of cases) {
      const { runner, messages, keys, runs } = setup({ ...options, selections: [selected("")] });
      await runner.run("make it shorter", "key");
      expect(messages).toEqual([COMMAND_MESSAGES.selectText]);
      expect(keys).toEqual([]);
      expect(runs[0]).toMatchObject({ outcome: "no_text" });
    }
  });

  it("puts the caret back when the selected text is not the dictation", async () => {
    const last = { text: "see you soon", appBundleId: "com.apple.Notes", at: 1_000_000 };
    const { runner, keys, messages } = setup({
      selections: [selected(""), selected("ee you soon!")],
      last,
      field: context("see you soon"),
    });
    await runner.run("lowercase that", "key");
    expect(keys.at(-1)).toEqual({ key: "right", modifiers: [], onlyInApp: "com.apple.Notes" });
    expect(messages).toEqual([COMMAND_MESSAGES.selectText]);
  });

  it("puts a new line after the selection, never over it", async () => {
    const { runner, keys, inserted } = setup();
    await runner.run("new paragraph", "key");
    expect(keys).toEqual([{ key: "right", modifiers: [] }]);
    expect(inserted).toEqual(["\n\n"]);
  });

  it("refuses password fields and long selections", async () => {
    const secure = setup({ selections: [{ ...selected(""), status: "secure" }] });
    await secure.runner.run("make it shorter", "key");
    expect(secure.messages).toEqual([COMMAND_MESSAGES.secure]);
    const long = setup({ selections: [{ ...selected(""), status: "too_long", length: 9000 }] });
    await long.runner.run("make it shorter", "key");
    expect(long.messages).toEqual([COMMAND_MESSAGES.tooLong]);
  });
});
