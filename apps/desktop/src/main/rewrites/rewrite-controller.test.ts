import { describe, expect, it, vi } from "vitest";
import type { RewritePanelState, SelectionResult } from "@murmur/shared";
import { createTestLogger } from "../helper/fakes";
import { openDatabase } from "../db/database";
import { GenerationError, type GenerationService } from "../generation/service";
import { createRewriteStore } from "./rewrite-store";
import { createRewriteRunStore } from "./run-store";
import { createRewriteController, type RewritePanelPort } from "./rewrite-controller";

const selected: SelectionResult = {
  status: "ok",
  text: "the long text",
  length: 13,
  range: { location: 0, length: 13 },
  hash: "a".repeat(64),
  source: "ax",
  appBundleId: "com.apple.Notes",
};

function panel() {
  const states: { state: RewritePanelState; shown: boolean }[] = [];
  const port: RewritePanelPort & { hidden: number } = {
    hidden: 0,
    show: (state) => states.push({ state, shown: true }),
    update: (state) => states.push({ state, shown: false }),
    hide: () => void port.hidden++,
  };
  return { port, states, last: () => states.at(-1)?.state };
}

/** A generation service whose answers the test settles. */
function generation() {
  const runs: {
    input: Parameters<GenerationService["generate"]>[0];
    handlers: Parameters<GenerationService["generate"]>[1];
    resolve: (text: string) => void;
    reject: (error: Error) => void;
    cancel: ReturnType<typeof vi.fn>;
  }[] = [];
  const service: GenerationService = {
    generate(input, handlers) {
      let resolve: (text: string) => void = () => {};
      let reject: (error: Error) => void = () => {};
      const result = new Promise<{ text: string; sources: []; ms: number; retried: boolean }>(
        (ok, fail) => {
          resolve = (text) => ok({ text, sources: [], ms: 800, retried: false });
          reject = fail;
        },
      );
      const cancel = vi.fn(() => reject(new GenerationError("cancelled")));
      runs.push({ input, handlers, resolve, reject, cancel });
      return { result, cancel };
    },
  };
  return { service, runs };
}

function setup(options: { reads?: (SelectionResult | Error)[] } = {}) {
  const db = openDatabase(":memory:");
  const rewrites = createRewriteStore(db);
  const runs = createRewriteRunStore(db);
  const reads = [...(options.reads ?? [selected, selected])];
  const helper = {
    readSelection: vi.fn(async () => {
      const next = reads.shift() ?? selected;
      if (next instanceof Error) throw next;
      return next;
    }),
    insertText: vi.fn(async () => ({
      method: "paste_cmd_v" as const,
      delivered: true,
      clipboardRestored: true,
      appBundleId: "com.apple.Notes",
    })),
    copyText: vi.fn(async () => {}),
  };
  const view = panel();
  const gen = generation();
  const notify = vi.fn();
  const activateApp = vi.fn(async () => {});
  const controller = createRewriteController({
    helper,
    rewrites,
    runs,
    generation: gen.service,
    panel: view.port,
    notify,
    activateApp,
    context: () => ({ style: ["Casual."], memory: [], samples: [] }),
    clipboardFirstInApps: () => ["com.google.Chrome"],
    insertRules: () => ({ typeInApps: [] }),
    logger: createTestLogger(),
    sleep: async () => {},
  });
  return { controller, helper, view, gen, notify, activateApp, rewrites, runs };
}

const flush = () => new Promise((done) => setTimeout(done, 0));

describe("rewrite controller", () => {
  it("opens the panel with the enabled Rewrites for a selection", async () => {
    const { controller, helper, view, rewrites } = setup();
    rewrites.setEnabled("builtin:reorder", false);
    await controller.open();
    expect(helper.readSelection).toHaveBeenCalledWith({
      clipboardFallback: true,
      clipboardFirstInApps: ["com.google.Chrome"],
    });
    const shown = view.states[0]!;
    expect(shown.shown).toBe(true);
    expect(shown.state).toMatchObject({ stage: "list", selectionLength: 13 });
    const names = shown.state.stage === "list" ? shown.state.items.map((item) => item.name) : [];
    expect(names).toEqual(["Clarify", "Tighten", "Keep tone", "Structure"]);
    expect(controller.state().stage).toBe("list");
  });

  it.each([
    ["empty", "Select some text first"],
    ["unavailable", "Select some text first"],
    ["too_long", "Select less text to rewrite (8,000 characters max)."],
    ["secure", "Rewrites do not read password fields"],
  ] as const)("a %s selection shows a Bar message, not the panel", async (status, message) => {
    const { controller, view, notify } = setup({ reads: [{ ...selected, status, text: "" }] });
    await controller.open();
    expect(notify).toHaveBeenCalledWith(message);
    expect(view.states).toHaveLength(0);
  });

  it("explains a missing permission", async () => {
    const denied = Object.assign(new Error("no"), { code: "PERMISSION_DENIED" });
    const { controller, notify } = setup({ reads: [denied] });
    await controller.open();
    expect(notify).toHaveBeenCalledWith("Rewrites need Accessibility. Turn it on in Settings.");
  });

  it("streams a Rewrite into the panel with its context, then shows the result", async () => {
    const { controller, view, gen, rewrites } = setup();
    await controller.open();
    void controller.choose("builtin:concise");
    await flush();
    const run = gen.runs[0]!;
    expect(run.input).toMatchObject({
      kind: "rewrite",
      text: "the long text",
      instruction: rewrites.get("builtin:concise")!.instruction,
      style: ["Casual."],
    });
    run.handlers!.onLoading!();
    expect(view.last()).toMatchObject({ stage: "running", loading: true, text: "" });
    run.handlers!.onChunk!("Short");
    expect(view.last()).toMatchObject({ stage: "running", loading: false, text: "Short" });
    run.resolve("Short text.");
    await flush();
    expect(view.last()).toEqual({
      stage: "result",
      rewriteName: "Tighten",
      text: "Short text.",
      source: "the long text",
    });
    expect(rewrites.get("builtin:concise")!.useCount).toBe(1);
  });

  it("shows a failure with a way back, and records it", async () => {
    const { controller, view, gen, runs } = setup();
    await controller.open();
    void controller.choose("builtin:clarify");
    await flush();
    gen.runs[0]!.reject(new GenerationError("timeout"));
    await flush();
    expect(view.last()).toEqual({
      stage: "message",
      message: "Taking too long. Try again or pick a smaller selection.",
      canCopy: false,
      canRetry: true,
    });
    expect(runs.recent(1)[0]).toMatchObject({ outcome: "failed", rewriteName: "Clarify" });
  });

  it("regenerate and back cancel the running Rewrite", async () => {
    const { controller, view, gen } = setup();
    await controller.open();
    void controller.choose("builtin:clarify");
    await flush();
    void controller.regenerate();
    await flush();
    expect(gen.runs[0]!.cancel).toHaveBeenCalled();
    expect(gen.runs).toHaveLength(2);
    controller.back();
    expect(gen.runs[1]!.cancel).toHaveBeenCalled();
    expect(view.last()?.stage).toBe("list");
  });

  it("replaces after bringing the app back and checking the selection is unchanged", async () => {
    const { controller, helper, view, gen, notify, activateApp, runs } = setup();
    await controller.open();
    void controller.choose("builtin:concise");
    await flush();
    gen.runs[0]!.resolve("Short text.");
    await flush();
    await controller.replace();
    expect(view.port.hidden).toBe(1);
    expect(activateApp).toHaveBeenCalledWith("com.apple.Notes");
    expect(helper.readSelection).toHaveBeenCalledTimes(2);
    expect(helper.insertText).toHaveBeenCalledWith({
      text: "Short text.",
      method: "auto",
      restoreClipboard: true,
      restoreDelayMs: 350,
      typeInApps: [],
    });
    expect(notify).toHaveBeenCalledWith("Replaced");
    expect(runs.recent(1)[0]).toMatchObject({
      outcome: "replaced",
      sourceText: "the long text",
      outputText: "Short text.",
      appBundleId: "com.apple.Notes",
      durationMs: 800,
    });
    expect(controller.state().stage).toBe("hidden");
  });

  it("blocks Replace when the selection changed, and offers Copy", async () => {
    const { controller, helper, view, gen, notify, runs } = setup({
      reads: [selected, { ...selected, hash: "b".repeat(64) }],
    });
    await controller.open();
    void controller.choose("builtin:concise");
    await flush();
    gen.runs[0]!.resolve("Short text.");
    await flush();
    await controller.replace();
    expect(helper.insertText).not.toHaveBeenCalled();
    expect(view.states.at(-1)).toEqual({
      shown: true,
      state: {
        stage: "message",
        message: "Selection changed. Copy instead?",
        canCopy: true,
        canRetry: false,
      },
    });
    await controller.copy();
    expect(helper.copyText).toHaveBeenCalledWith("Short text.");
    expect(notify).toHaveBeenCalledWith("Copied");
    expect(runs.recent(1)[0]!.outcome).toBe("copied");
  });

  it("copies instead when another app is in front", async () => {
    const { controller, helper, gen, notify } = setup({
      reads: [selected, { ...selected, appBundleId: "com.apple.mail" }],
    });
    await controller.open();
    void controller.choose("builtin:concise");
    await flush();
    gen.runs[0]!.resolve("Short text.");
    await flush();
    await controller.replace();
    expect(helper.insertText).not.toHaveBeenCalled();
    expect(helper.copyText).toHaveBeenCalledWith("Short text.");
    expect(notify).toHaveBeenCalledWith(
      "Could not get back to the app. The result was copied instead.",
    );
  });

  it("close discards, records it, and gives the app the keyboard back", async () => {
    const { controller, view, gen, activateApp, runs } = setup();
    await controller.open();
    void controller.choose("builtin:concise");
    await flush();
    gen.runs[0]!.resolve("Short text.");
    await flush();
    await controller.close();
    expect(view.port.hidden).toBe(1);
    expect(activateApp).toHaveBeenCalledWith("com.apple.Notes");
    expect(runs.recent(1)[0]!.outcome).toBe("discarded");
    expect(controller.state()).toEqual({ stage: "hidden" });
  });

  it("closing before choosing records nothing", async () => {
    const { controller, runs } = setup();
    await controller.open();
    await controller.close();
    expect(runs.recent(5)).toEqual([]);
  });

  it("ignores a disabled or unknown Rewrite", async () => {
    const { controller, gen, rewrites } = setup();
    await controller.open();
    rewrites.setEnabled("builtin:clarify", false);
    await controller.choose("builtin:clarify");
    await controller.choose("nope");
    expect(gen.runs).toHaveLength(0);
  });

  describe("a Rewrite's own shortcut", () => {
    it("replaces directly without the panel, after checking the selection", async () => {
      const { controller, helper, view, gen, notify, activateApp, runs } = setup();
      void controller.runDirect("builtin:concise");
      await flush();
      expect(view.states).toHaveLength(0);
      gen.runs[0]!.handlers!.onLoading!();
      expect(notify).toHaveBeenCalledWith("Loading model");
      gen.runs[0]!.resolve("Short text.");
      await flush();
      await flush();
      expect(helper.readSelection).toHaveBeenCalledTimes(2);
      expect(activateApp).not.toHaveBeenCalled();
      expect(helper.insertText).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Short text." }),
      );
      expect(notify).toHaveBeenLastCalledWith("Replaced");
      expect(runs.recent(1)[0]).toMatchObject({ outcome: "replaced", rewriteName: "Tighten" });
      expect(view.states).toHaveLength(0);
    });

    it("copies the result when the selection changed meanwhile", async () => {
      const { controller, helper, gen, notify } = setup({
        reads: [selected, { ...selected, hash: "c".repeat(64) }],
      });
      void controller.runDirect("builtin:concise");
      await flush();
      gen.runs[0]!.resolve("Short text.");
      await flush();
      await flush();
      expect(helper.insertText).not.toHaveBeenCalled();
      expect(helper.copyText).toHaveBeenCalledWith("Short text.");
      expect(notify).toHaveBeenLastCalledWith("Selection changed. The result was copied instead.");
    });

    it("shows the result in the panel when Apply directly is off", async () => {
      const { controller, view, gen, rewrites } = setup();
      rewrites.setApplyDirectly("builtin:concise", false);
      void controller.runDirect("builtin:concise");
      await flush();
      expect(view.states[0]).toMatchObject({ shown: true, state: { stage: "running" } });
      gen.runs[0]!.resolve("Short text.");
      await flush();
      expect(view.last()).toMatchObject({ stage: "result", text: "Short text." });
    });

    it("says when nothing is selected, and reports a failure on the Bar", async () => {
      const empty = setup({ reads: [{ ...selected, status: "empty", text: "" }] });
      await empty.controller.runDirect("builtin:concise");
      expect(empty.notify).toHaveBeenCalledWith("Select some text first");
      expect(empty.gen.runs).toHaveLength(0);

      const { controller, gen, notify, runs } = setup();
      void controller.runDirect("builtin:concise");
      await flush();
      gen.runs[0]!.reject(new GenerationError("timeout"));
      await flush();
      expect(notify).toHaveBeenLastCalledWith(
        "Taking too long. Try again or pick a smaller selection.",
      );
      expect(runs.recent(1)[0]!.outcome).toBe("failed");
    });

    it("ignores a switched-off Rewrite", async () => {
      const { controller, helper, rewrites } = setup();
      rewrites.setEnabled("builtin:concise", false);
      await controller.runDirect("builtin:concise");
      expect(helper.readSelection).not.toHaveBeenCalled();
    });
  });

  it("runs a command on the panel and puts its output below the text", async () => {
    const { controller, helper, view, gen, runs } = setup();
    const outcomes: [string, string | null, number | null][] = [];
    void controller.runCommand({
      name: "Add a summary below",
      instruction: "Summarise it.",
      selection: selected,
      placement: "below",
      onOutcome: (outcome, inserted, ms) => outcomes.push([outcome, inserted, ms]),
    });
    await flush();
    expect(view.states[0]).toMatchObject({ shown: true, state: { stage: "running" } });
    expect(gen.runs[0]!.input).toMatchObject({ kind: "command", instruction: "Summarise it." });
    gen.runs[0]!.resolve("A short summary.");
    await flush();
    expect(view.last()).toMatchObject({
      stage: "result",
      rewriteName: "Add a summary below",
      placement: "below",
    });
    await controller.replace();
    expect(helper.insertText).toHaveBeenCalledWith(
      expect.objectContaining({ text: "the long text\n\nA short summary." }),
    );
    expect(outcomes).toEqual([["replaced", "the long text\n\nA short summary.", 800]]);
    // Command runs are kept with the command, not as Rewrite runs.
    expect(runs.recent(10)).toEqual([]);
  });

  it("records a command that is closed as discarded", async () => {
    const { controller, gen } = setup();
    const outcomes: string[] = [];
    void controller.runCommand({
      name: "Make it shorter",
      instruction: "Shorter.",
      selection: selected,
      placement: "replace",
      onOutcome: (outcome) => outcomes.push(outcome),
    });
    await flush();
    gen.runs[0]!.resolve("short");
    await flush();
    await controller.close();
    expect(outcomes).toEqual(["discarded"]);
  });
});
