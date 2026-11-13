import { describe, expect, it, vi } from "vitest";
import {
  UNDO_LIMITS,
  type FocusContext,
  type KeysPressInput,
  type SelectionResult,
} from "@murmur/shared";
import { createTestLogger } from "../helper/fakes";
import { createUndoService } from "./undo-service";

const APP = "com.apple.TextEdit";

function context(textBefore: string, bundleId = APP): FocusContext {
  return {
    appName: "TextEdit",
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

const selection = (text: string): SelectionResult => ({
  status: text ? "ok" : "empty",
  text,
  length: text.length,
  range: null,
  hash: text ? "c".repeat(64) : "",
  source: text ? "ax" : null,
  appBundleId: APP,
});

/**
 * A field the fake helper edits for real: text before the caret plus an optional selection
 * made with Shift+Left, so undo can be checked end to end.
 */
function field(initial: string) {
  let text = initial;
  let selected = 0;
  let readable = true;
  const helper = {
    focusContext: vi.fn(async () => {
      if (!readable) throw new Error("no field");
      return context(text.slice(0, text.length - selected));
    }),
    pressKey: vi.fn(async (input: KeysPressInput) => {
      if (input.key === "left" && input.modifiers.includes("shift")) {
        selected = Math.min(text.length, selected + (input.repeat ?? 1));
      } else if (input.key === "right") {
        selected = 0;
      } else if (input.key === "delete") {
        text = text.slice(0, text.length - (selected || 1));
        selected = 0;
      }
      return { pressed: true, appBundleId: APP };
    }),
    readSelection: vi.fn(async () => selection(selected ? text.slice(text.length - selected) : "")),
    insertText: vi.fn(async (input: { text: string }) => {
      text = text.slice(0, text.length - selected) + input.text;
      selected = 0;
      return { method: "paste_cmd_v" as const, delivered: true, clipboardRestored: true };
    }),
    copyText: vi.fn(async () => {}),
  };
  return {
    helper,
    text: () => text,
    /** What Murmur's edit does: replace the last `count` characters with `after`. */
    edit: (count: number, after: string) => {
      text = text.slice(0, text.length - count) + after;
    },
    type: (more: string) => {
      text += more;
    },
    unreadable: () => {
      readable = false;
    },
  };
}

function setup(initial = "Dear Sam, ", options: { mayRead?: boolean } = {}) {
  const box = field(initial);
  let time = 0;
  const onUndone = vi.fn();
  const undo = createUndoService({
    helper: box.helper,
    mayReadField: () => options.mayRead ?? true,
    insertRules: () => ({}),
    logger: createTestLogger(),
    now: () => time,
  });
  return { box, undo, onUndone, advance: (ms: number) => (time += ms) };
}

describe("undo service", () => {
  it("restores the exact previous text after a replace", async () => {
    const { box, undo, onUndone } = setup("Notes: please make this shorter");
    box.edit("please make this shorter".length, "shorten this");
    await undo.record("command", {
      appBundleId: APP,
      before: "please make this shorter",
      after: "shorten this",
      onUndone,
    });
    expect(await undo.undoLast("command")).toBe("undone");
    expect(box.text()).toBe("Notes: please make this shorter");
    expect(onUndone).toHaveBeenCalled();
    expect(await undo.undoLast("command")).toBe("nothing");
  });

  it("removes an Instruct insert, and puts deleted text back", async () => {
    const inserted = setup("Hi Sam, ");
    inserted.box.edit(0, "Thursday works.");
    await inserted.undo.record("instruct", {
      appBundleId: APP,
      before: "",
      after: "Thursday works.",
    });
    expect(await inserted.undo.undoLast("instruct")).toBe("undone");
    expect(inserted.box.text()).toBe("Hi Sam, ");

    const deleted = setup("Keep this. Drop this.");
    deleted.box.edit(" Drop this.".length, "");
    await deleted.undo.record("command", { appBundleId: APP, before: " Drop this.", after: "" });
    expect(await deleted.undo.undoLast("command")).toBe("undone");
    expect(deleted.box.text()).toBe("Keep this. Drop this.");
  });

  it("refuses after a manual edit, and leaves the text alone", async () => {
    const { box, undo } = setup("Hi ");
    box.edit(0, "THERE");
    await undo.record("command", { appBundleId: APP, before: "there", after: "THERE" });
    box.type("!");
    expect(await undo.undoLast("command")).toBe("changed");
    expect(box.text()).toBe("Hi THERE!");
  });

  it("copies the previous text where the field cannot be read", async () => {
    const { box, undo } = setup("Hi ", { mayRead: false });
    box.edit(0, "THERE");
    await undo.record("command", { appBundleId: APP, before: "there", after: "THERE" });
    expect(await undo.undoLast("command")).toBe("copied");
    expect(box.helper.copyText).toHaveBeenCalledWith("there");
    expect(box.text()).toBe("Hi THERE");
  });

  it("keeps the last 10 command edits for 5 minutes, and 20 Instruct inserts", async () => {
    const { undo, advance } = setup();
    for (let index = 0; index < 12; index++) {
      await undo.record("command", { appBundleId: APP, before: `${index}`, after: "x" });
    }
    let undone = 0;
    while ((await undo.undoLast("command")) !== "nothing") undone++;
    expect(undone).toBe(UNDO_LIMITS.command.entries);

    await undo.record("command", { appBundleId: APP, before: "a", after: "b" });
    advance(UNDO_LIMITS.command.windowMs + 1);
    expect(undo.has("command")).toBe(false);

    for (let index = 0; index < 25; index++) {
      await undo.record("instruct", { appBundleId: APP, before: "", after: `${index}` });
    }
    let instructs = 0;
    while ((await undo.undoLast("instruct")) !== "nothing") instructs++;
    expect(instructs).toBe(UNDO_LIMITS.instruct.entries);
  });

  it("undoes the newest edit of either kind for any", async () => {
    const { box, undo, advance } = setup("A ");
    box.edit(0, "one");
    await undo.record("instruct", { appBundleId: APP, before: "", after: "one" });
    advance(10);
    box.edit(3, "ONE");
    await undo.record("command", { appBundleId: APP, before: "one", after: "ONE" });
    expect(await undo.undoLast("any")).toBe("undone");
    expect(box.text()).toBe("A one");
    expect(await undo.undoLast("any")).toBe("undone");
    expect(box.text()).toBe("A ");
  });

  it("refuses in another app", async () => {
    const { box, undo } = setup("Hi ");
    box.edit(0, "x");
    await undo.record("command", { appBundleId: "com.apple.Notes", before: "y", after: "x" });
    expect(await undo.undoLast("command")).toBe("copied");
    expect(box.text()).toBe("Hi x");
  });
});
