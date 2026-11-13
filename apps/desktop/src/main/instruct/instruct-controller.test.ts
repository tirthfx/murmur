import { describe, expect, it, vi } from "vitest";
import {
  INSTRUCT_MESSAGES,
  type FocusContext,
  type InstructPanelState,
  type SelectionResult,
} from "@murmur/shared";
import { createTestLogger } from "../helper/fakes";
import { GenerationError, type GenerationService } from "../generation/service";
import { buildGenerationPrompt } from "../generation/prompt";
import { createInstructController } from "./instruct-controller";
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
function generation(answer = "Thursday works for me.") {
  const inputs: Parameters<GenerationService["generate"]>[0][] = [];
  const service: GenerationService = {
    generate(input) {
      inputs.push(input);
      const { sources } = buildGenerationPrompt(input);
      return {
        result: Promise.resolve({ text: answer, sources, ms: 500, retried: false }),
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
  settings?: Partial<{ fieldContext: boolean; memory: boolean; samples: boolean }>;
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
  const controller = createInstructController({
    helper,
    generation: options.generation ?? gen.service,
    panel,
    notify,
    activateApp,
    context: () => ({
      style: ["Professional."],
      memory: ["Sam is the design lead."],
      samples: ["Hi all, quick update."],
    }),
    settings: () => ({
      instruct: { fieldContext: true, memory: true, samples: true, ...options.settings },
      contextAwareness: options.contextAwareness ?? true,
    }),
    clipboardFirstInApps: () => [],
    insertRules: () => ({}),
    logger: createTestLogger(),
    sleep: async () => {},
  });
  return { controller, helper, panel, states, gen, notify, activateApp };
}

const last = (states: { state: InstructPanelState }[]) => states.at(-1)!.state;

describe("instruct controller", () => {
  it("drafts from the instruction with the field, Memory, samples and style", async () => {
    const { controller, states, gen } = setup({ before: "Can you meet on Thursday?" });
    await controller.start("draft a reply saying I can do Thursday");
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
    await controller.start("write a short thank-you note");
    expect(gen.inputs[0]!.samples).toEqual([]);
    const draft = last(states);
    expect(draft.stage === "draft" && draft.used).not.toContain("samples");
    expect(draft.stage !== "hidden" && draft.available).not.toContain("samples");
  });

  it("turns a source off for the thread and writes the draft again", async () => {
    const { controller, states, gen } = setup();
    await controller.start("write a short thank-you note");
    await controller.toggleSource("memory");
    expect(gen.inputs).toHaveLength(2);
    expect(gen.inputs[1]!.memory).toEqual([]);
    expect(last(states)).toMatchObject({ stage: "draft", off: ["memory"] });
    await controller.toggleSource("memory");
    expect(gen.inputs[2]!.memory).toEqual(["Sam is the design lead."]);
  });

  it("drafts an action request and says nothing was sent", async () => {
    const { controller, states, gen } = setup();
    await controller.start("send this to Sam");
    expect(gen.inputs[0]!.instruction).toBe(actionInstruction("send this to Sam"));
    expect(last(states)).toMatchObject({ stage: "draft", note: INSTRUCT_MESSAGES.draftsOnly });
  });

  it("reads no field text without context awareness, nor from a password field", async () => {
    const off = setup({ before: "secret plans", contextAwareness: false });
    await off.controller.start("write a reply");
    expect(off.helper.focusContext).not.toHaveBeenCalled();
    expect(off.gen.inputs[0]!.fieldText).toBeUndefined();
    const secure = setup({ before: "hunter2", secure: true });
    await secure.controller.start("write a reply");
    expect(secure.gen.inputs[0]!.fieldText).toBeUndefined();
  });

  it("uses the selection as the text and inserts after it, never over it", async () => {
    const { controller, helper, activateApp, notify, gen } = setup({ selected: "Are you free?" });
    await controller.start("reply that I am");
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
    await controller.start("write a haiku");
    await controller.insert();
    expect(helper.pressKey).not.toHaveBeenCalled();
    expect(helper.insertText).toHaveBeenCalled();
  });

  it("copies the draft when the paste fails", async () => {
    const { controller, helper, notify } = setup();
    helper.insertText.mockRejectedValueOnce(new Error("no"));
    await controller.start("write a haiku");
    await controller.insert();
    expect(helper.copyText).toHaveBeenCalledWith("Thursday works for me.");
    expect(notify).toHaveBeenCalledWith(INSTRUCT_MESSAGES.notBack);
  });

  it("copies, or discards and gives the app the keyboard back", async () => {
    const copied = setup();
    await copied.controller.start("write a haiku");
    await copied.controller.copy();
    expect(copied.helper.copyText).toHaveBeenCalledWith("Thursday works for me.");
    expect(copied.panel.hidden).toBe(1);
    const closed = setup();
    await closed.controller.start("write a haiku");
    await closed.controller.close();
    expect(closed.activateApp).toHaveBeenCalledWith("com.apple.mail");
    expect(closed.helper.insertText).not.toHaveBeenCalled();
  });

  it("asks to say something when the instruction is empty", async () => {
    const { controller, notify, panel } = setup();
    await controller.start("  ");
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
    await controller.start("write a haiku");
    expect(last(states)).toMatchObject({ stage: "message", canRetry: true });
  });
});
