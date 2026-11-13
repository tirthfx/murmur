import { describe, expect, it, vi } from "vitest";
import {
  INSTRUCT_MESSAGES,
  UNDO_MESSAGES,
  type FocusContext,
  type InstructPanelState,
  type SelectionResult,
} from "@murmur/shared";
import { createTestLogger } from "../helper/fakes";
import { GenerationError, type GenerationService } from "../generation/service";
import { buildGenerationPrompt } from "../generation/prompt";
import { openDatabase } from "../db/database";
import { createInstructController, followUpInstruction } from "./instruct-controller";
import { createInstructThreadStore } from "./thread-store";
import { actionInstruction } from "./actions";

const selection = (text: string): SelectionResult => ({
  status: text ? "ok" : "empty",
  text,
  length: text.length,
  range: null,
  hash: text ? "b".repeat(64) : "",
  source: text ? "ax" : null,
  appBundleId: "com.apple.mail",
});

const field = (textBefore: string, secure = false): FocusContext => ({
  appName: "Mail",
  bundleId: "com.apple.mail",
  windowTitle: null,
  role: null,
  subrole: null,
  editable: true,
  secure,
  textBefore,
  textAfter: "",
});

/** A generation service that answers at once, built like the real prompt for its sources. */
function generation() {
  const inputs: Parameters<GenerationService["generate"]>[0][] = [];
  const service: GenerationService = {
    generate(input) {
      inputs.push(input);
      const { sources } = buildGenerationPrompt(input);
      const text = inputs.length === 1 ? "Thursday works for me." : `Draft ${inputs.length}`;
      return {
        result: Promise.resolve({ text, sources, ms: 500, retried: false }),
        cancel: () => {},
      };
    },
  };
  return { service, inputs };
}

interface Options {
  selected?: string;
  before?: string;
  secure?: boolean;
  settings?: Partial<{
    fieldContext: boolean;
    memory: boolean;
    samples: boolean;
    saveThreads: boolean;
    model: "fast" | "quality";
  }>;
  qualityReady?: boolean;
  contextAwareness?: boolean;
  generation?: GenerationService;
}

function setup(options: Options = {}) {
  const states: { state: InstructPanelState; shown: boolean }[] = [];
  const panel = {
    hidden: 0,
    show: (state: InstructPanelState) => states.push({ state, shown: true }),
    update: (state: InstructPanelState) => states.push({ state, shown: false }),
    hide: () => void panel.hidden++,
  };
  const gen = generation();
  const helper = {
    readSelection: vi.fn(async () => selection(options.selected ?? "")),
    focusContext: vi.fn(async () => field(options.before ?? "", options.secure)),
    insertText: vi.fn(async () => ({
      method: "paste_cmd_v" as const,
      delivered: true,
      clipboardRestored: true,
    })),
    copyText: vi.fn(async () => {}),
    pressKey: vi.fn(async () => ({ pressed: true, appBundleId: "com.apple.mail" })),
  };
  const notify = vi.fn();
  const activateApp = vi.fn(async () => {});
  const threads = createInstructThreadStore(openDatabase(":memory:"));
  const models: string[] = [];
  const undoEntries: { before: string; after: string; onUndone?: () => void }[] = [];
  const undo = {
    record: vi.fn(
      async (_kind: string, edit: { before: string; after: string; onUndone?: () => void }) => {
        undoEntries.push(edit);
      },
    ),
    has: vi.fn(() => undoEntries.length > 0),
    undoLast: vi.fn(async () => {
      undoEntries.pop()?.onUndone?.();
      return "undone" as const;
    }),
  };
  const controller = createInstructController({
    helper,
    generation: (model) => {
      models.push(model);
      return options.generation ?? gen.service;
    },
    qualityReady: () => options.qualityReady ?? false,
    panel,
    threads,
    undo,
    modelId: (model) => `test-${model}`,
    notify,
    activateApp,
    context: () => ({
      style: ["Professional."],
      memory: ["Sam is the design lead."],
      samples: ["Hi all, quick update."],
    }),
    settings: () => ({
      instruct: {
        fieldContext: true,
        memory: true,
        samples: true,
        saveThreads: true,
        model: "fast",
        ...options.settings,
      },
      contextAwareness: options.contextAwareness ?? true,
    }),
    clipboardFirstInApps: () => [],
    insertRules: () => ({}),
    logger: createTestLogger(),
    sleep: async () => {},
  });
  return {
    controller,
    helper,
    panel,
    states,
    gen,
    notify,
    activateApp,
    threads,
    undo,
    undoEntries,
    models,
  };
}

const last = (states: { state: InstructPanelState }[]) => states.at(-1)!.state;

describe("instruct controller", () => {
  it("drafts from the instruction with the field, Memory, samples and style", async () => {
    const { controller, states, gen } = setup({ before: "Can you meet on Thursday?" });
    await controller.spoken("draft a reply saying I can do Thursday");
    expect(states[0]).toMatchObject({ shown: true, state: { stage: "running" } });
    expect(gen.inputs[0]).toMatchObject({
      kind: "instruct",
      instruction: "draft a reply saying I can do Thursday",
      text: "",
      fieldText: "Can you meet on Thursday?",
      memory: ["Sam is the design lead."],
      samples: ["Hi all, quick update."],
      style: ["Professional."],
    });
    expect(last(states)).toMatchObject({
      stage: "draft",
      text: "Thursday works for me.",
      note: null,
      available: ["field", "memory", "samples", "style"],
      used: ["style", "memory", "samples", "field"],
    });
  });

  it("leaves writing samples out of the prompt and the chips when Settings turn them off", async () => {
    const { controller, states, gen } = setup({ settings: { samples: false } });
    await controller.spoken("write a short thank-you note");
    expect(gen.inputs[0]!.samples).toEqual([]);
    const draft = last(states);
    expect(draft.stage === "draft" && draft.used).not.toContain("samples");
    expect(draft.stage === "draft" && draft.available).not.toContain("samples");
  });

  it("turns a source off for the thread and writes the draft again", async () => {
    const { controller, states, gen } = setup();
    await controller.spoken("write a short thank-you note");
    await controller.toggleSource("memory");
    expect(gen.inputs).toHaveLength(2);
    expect(gen.inputs[1]!.memory).toEqual([]);
    expect(last(states)).toMatchObject({ stage: "draft", off: ["memory"] });
    await controller.toggleSource("memory");
    expect(gen.inputs[2]!.memory).toEqual(["Sam is the design lead."]);
  });

  it("drafts an action request and says nothing was sent", async () => {
    const { controller, states, gen } = setup();
    await controller.spoken("send this to Sam");
    expect(gen.inputs[0]!.instruction).toBe(actionInstruction("send this to Sam"));
    expect(last(states)).toMatchObject({ stage: "draft", note: INSTRUCT_MESSAGES.draftsOnly });
  });

  it("reads no field text without context awareness, nor from a password field", async () => {
    const off = setup({ before: "secret plans", contextAwareness: false });
    await off.controller.spoken("write a reply");
    expect(off.helper.focusContext).not.toHaveBeenCalled();
    expect(off.gen.inputs[0]!.fieldText).toBeUndefined();
    const secure = setup({ before: "hunter2", secure: true });
    await secure.controller.spoken("write a reply");
    expect(secure.gen.inputs[0]!.fieldText).toBeUndefined();
  });

  it("uses the selection as the text and inserts after it, never over it", async () => {
    const { controller, helper, activateApp, notify, gen } = setup({ selected: "Are you free?" });
    await controller.spoken("reply that I am");
    expect(gen.inputs[0]!.text).toBe("Are you free?");
    await controller.insert();
    expect(activateApp).toHaveBeenCalledWith("com.apple.mail");
    expect(helper.pressKey).toHaveBeenCalledWith({
      key: "right",
      modifiers: [],
      onlyInApp: "com.apple.mail",
    });
    expect(helper.insertText).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Thursday works for me." }),
    );
    expect(notify).toHaveBeenCalledWith(INSTRUCT_MESSAGES.inserted);
    expect(controller.state()).toEqual({ stage: "hidden" });
  });

  it("inserts at the caret without moving it when nothing was selected", async () => {
    const { controller, helper } = setup();
    await controller.spoken("write a haiku");
    await controller.insert();
    expect(helper.pressKey).not.toHaveBeenCalled();
    expect(helper.insertText).toHaveBeenCalled();
  });

  it("copies the draft when the paste fails", async () => {
    const { controller, helper, notify } = setup();
    helper.insertText.mockRejectedValueOnce(new Error("no"));
    await controller.spoken("write a haiku");
    await controller.insert();
    expect(helper.copyText).toHaveBeenCalledWith("Thursday works for me.");
    expect(notify).toHaveBeenCalledWith(INSTRUCT_MESSAGES.notBack);
  });

  it("copies, or discards and gives the app the keyboard back", async () => {
    const copied = setup();
    await copied.controller.spoken("write a haiku");
    await copied.controller.copy();
    expect(copied.helper.copyText).toHaveBeenCalledWith("Thursday works for me.");
    expect(copied.panel.hidden).toBe(1);
    const closed = setup();
    await closed.controller.spoken("write a haiku");
    await closed.controller.close();
    expect(closed.activateApp).toHaveBeenCalledWith("com.apple.mail");
    expect(closed.helper.insertText).not.toHaveBeenCalled();
  });

  it("asks to say something when the instruction is empty", async () => {
    const { controller, notify, panel } = setup();
    await controller.spoken("  ");
    expect(notify).toHaveBeenCalledWith(INSTRUCT_MESSAGES.nothingSaid);
    expect(panel.hidden).toBe(0);
  });

  it("shows a failure with Try again", async () => {
    const failing: GenerationService = {
      generate: () => ({
        result: Promise.reject(new GenerationError("timeout")),
        cancel: () => {},
      }),
    };
    const { controller, states } = setup({ generation: failing });
    await controller.spoken("write a haiku");
    expect(last(states)).toMatchObject({ stage: "message", canRetry: true });
  });

  it("changes the same draft with a follow-up, sending it as the text with the chat", async () => {
    const { controller, states, gen } = setup({ before: "Can we meet?" });
    await controller.spoken("draft a reply saying I can do Thursday");
    await controller.followUp("make it shorter");
    expect(gen.inputs[1]).toMatchObject({
      kind: "instruct",
      followUp: true,
      text: "Thursday works for me.",
      instruction: followUpInstruction("make it shorter", []),
      history: [
        { role: "user", text: "draft a reply saying I can do Thursday" },
        { role: "assistant", text: "Thursday works for me." },
      ],
      fieldText: "Can we meet?",
    });
    expect(last(states)).toMatchObject({
      stage: "draft",
      text: "Draft 2",
      instruction: "make it shorter",
      earlier: ["draft a reply saying I can do Thursday"],
      turns: 2,
    });
  });

  it("takes a spoken follow-up while the panel is open", async () => {
    const { controller, gen, helper } = setup();
    await controller.spoken("write a haiku");
    await controller.spoken("make it about rain");
    expect(gen.inputs[1]!.followUp).toBe(true);
    expect(helper.readSelection).toHaveBeenCalledTimes(1);
  });

  it("sends the last 6 turns and lists older requests", async () => {
    const { controller, gen } = setup();
    await controller.spoken("request 1");
    for (let index = 2; index <= 5; index++) await controller.followUp(`request ${index}`);
    const fifth = gen.inputs[4]!;
    expect(fifth.history).toHaveLength(6);
    expect(fifth.history![0]).toEqual({ role: "user", text: "request 2" });
    expect(fifth.instruction).toContain(
      "Earlier requests in this thread, still to respect: request 1.",
    );
  });

  it("refuses request 21 with the message", async () => {
    const { controller, gen, notify, states } = setup();
    await controller.spoken("request 1");
    for (let index = 2; index <= 20; index++) await controller.followUp(`request ${index}`);
    expect(last(states)).toMatchObject({ turns: 20 });
    await controller.followUp("request 21");
    expect(gen.inputs).toHaveLength(20);
    expect(notify).toHaveBeenCalledWith(INSTRUCT_MESSAGES.turnLimit);
  });

  it("saves each turn with the outcome, and Regenerate replaces the last draft", async () => {
    const { controller, threads } = setup();
    await controller.spoken("write a haiku");
    await controller.followUp("about rain");
    await controller.regenerate();
    await controller.copy();
    const [saved] = threads.list("");
    const thread = threads.get(saved!.id)!;
    expect(thread).toMatchObject({
      title: "write a haiku",
      turnCount: 2,
      outcome: "copied",
      finalDraft: "Draft 3",
    });
    expect(thread.turns.map((turn) => turn.draft)).toEqual(["Thursday works for me.", "Draft 3"]);
  });

  it("saves nothing when saving threads is off", async () => {
    const { controller, threads } = setup({ settings: { saveThreads: false } });
    await controller.spoken("write a haiku");
    await controller.insert();
    expect(threads.list("")).toEqual([]);
  });

  it("starts a new thread on the button, keeping the panel and the app", async () => {
    const { controller, states, gen, threads, activateApp, helper } = setup();
    await controller.spoken("write a haiku");
    await controller.newThread();
    expect(last(states)).toEqual({ stage: "empty" });
    expect(threads.list("")[0]!.outcome).toBe("discarded");
    await controller.followUp("write a limerick");
    expect(gen.inputs[1]!.followUp).toBeUndefined();
    expect(last(states)).toMatchObject({ stage: "draft", turns: 1, earlier: [] });
    await controller.insert();
    expect(activateApp).toHaveBeenCalledWith("com.apple.mail");
    expect(helper.insertText).toHaveBeenCalledWith(expect.objectContaining({ text: "Draft 2" }));
  });

  it("reuses a saved thread's last draft as a new thread", async () => {
    const { controller, states, threads, gen } = setup();
    await controller.spoken("write a haiku");
    await controller.close();
    const id = threads.list("")[0]!.id;
    expect(await controller.reuse(id)).toBe(true);
    expect(last(states)).toMatchObject({
      stage: "draft",
      text: "Thursday works for me.",
      turns: 1,
    });
    await controller.followUp("shorter");
    expect(gen.inputs[1]).toMatchObject({ followUp: true, text: "Thursday works for me." });
    expect(threads.list("")).toHaveLength(2);
    expect(await controller.reuse("missing")).toBe(false);
  });

  it("records an insert for undo, and Control+Z in the panel takes it out", async () => {
    const { controller, undo, undoEntries, threads, notify, panel } = setup();
    await controller.spoken("write a haiku");
    await controller.insert();
    expect(undoEntries).toMatchObject([{ before: "", after: "Thursday works for me." }]);
    await controller.spoken("another one");
    await controller.undo();
    expect(undo.undoLast).toHaveBeenCalledWith("instruct", { refocus: true });
    expect(notify).toHaveBeenLastCalledWith(UNDO_MESSAGES.undone);
    expect(panel.hidden).toBeGreaterThan(0);
    const saved = threads.list("").find((thread) => thread.title === "write a haiku")!;
    expect(threads.get(saved.id)!.turns).toHaveLength(1);
  });

  it("says there is nothing to undo", async () => {
    const { controller, notify } = setup();
    await controller.undo();
    expect(notify).toHaveBeenCalledWith(UNDO_MESSAGES.nothing);
  });

  it("stays on Fast and says to download Quality when it is missing", async () => {
    const { controller, states, notify, models } = setup({ settings: { model: "quality" } });
    await controller.spoken("write a haiku");
    expect(last(states)).toMatchObject({ model: "fast", qualityAvailable: false });
    await controller.setModel("quality");
    expect(notify).toHaveBeenCalledWith(INSTRUCT_MESSAGES.downloadQuality);
    expect(models).toEqual(["fast"]);
  });

  it("switches to Quality for the next request and keeps the thread", async () => {
    const { controller, states, models, threads } = setup({ qualityReady: true });
    await controller.spoken("write a haiku");
    await controller.setModel("quality");
    expect(last(states)).toMatchObject({ stage: "draft", model: "quality", turns: 1 });
    await controller.followUp("about rain");
    expect(models).toEqual(["fast", "quality"]);
    expect(last(states)).toMatchObject({ turns: 2, earlier: ["write a haiku"] });
    const saved = threads.get(threads.list("")[0]!.id)!;
    expect(saved.turns).toHaveLength(2);
  });

  it("starts new threads on the Quality model when Settings choose it and it is there", async () => {
    const { controller, models } = setup({ qualityReady: true, settings: { model: "quality" } });
    await controller.spoken("write a haiku");
    expect(models).toEqual(["quality"]);
  });
});
