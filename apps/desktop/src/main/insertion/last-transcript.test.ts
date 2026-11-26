import type { FocusContext } from "@murmur/shared";
import { describe, expect, it, vi } from "vitest";
import { createLastTranscript, type LastTranscriptDeps } from "./last-transcript";

const field: FocusContext = {
  appName: "Notes",
  bundleId: "com.example.notes",
  windowTitle: "Note",
  role: "AXTextArea",
  subrole: null,
  editable: true,
  secure: false,
  textBefore: "",
  textAfter: "",
};

function setup(over: Partial<LastTranscriptDeps> = {}) {
  const deps = {
    stored: vi.fn<() => string | null>(() => "the stored text"),
    focus: vi.fn(async () => field as FocusContext | null),
    insert: vi.fn(async () => ({
      method: "paste_cmd_v" as const,
      delivered: true,
      clipboardRestored: true,
    })),
    copy: vi.fn(async () => {}),
    busy: vi.fn(() => false),
    notify: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...over,
  };
  return { deps, last: createLastTranscript(deps as LastTranscriptDeps) };
}

describe("last transcript", () => {
  it("copies the newest stored text and says so", async () => {
    const { deps, last } = setup();
    await last.copy();
    expect(deps.copy).toHaveBeenCalledWith("the stored text");
    expect(deps.notify).toHaveBeenCalledWith("note", "Copied");
  });

  it("pastes into the focused field", async () => {
    const { deps, last } = setup();
    await last.paste();
    expect(deps.insert).toHaveBeenCalledWith("the stored text");
    expect(deps.copy).not.toHaveBeenCalled();
  });

  it("says there is nothing yet", async () => {
    const { deps, last } = setup({ stored: () => null });
    await last.copy();
    await last.paste();
    expect(deps.insert).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledTimes(2);
    expect(deps.notify).toHaveBeenCalledWith("warn", "Nothing dictated yet");
  });

  it("keeps text history did not store, until a stored one is newer", () => {
    const { last } = setup();
    last.remember("only in memory", false);
    expect(last.read()).toBe("only in memory");
    last.remember("", false);
    expect(last.read()).toBe("only in memory");
    last.remember("kept by history", true);
    expect(last.read()).toBe("the stored text");
    last.remember("again", false);
    last.forget();
    expect(last.read()).toBe("the stored text");
  });

  it("copies instead when nothing has the focus", async () => {
    const { deps, last } = setup({
      focus: async () => ({ ...field, role: null, editable: false }),
    });
    await last.paste();
    expect(deps.insert).not.toHaveBeenCalled();
    expect(deps.copy).toHaveBeenCalledWith("the stored text");
  });

  it("still pastes when the focus cannot be read", async () => {
    const { deps, last } = setup({
      focus: async () => {
        throw new Error("no permission");
      },
    });
    await last.paste();
    expect(deps.insert).toHaveBeenCalledOnce();
  });

  it("copies when the paste fails", async () => {
    const { deps, last } = setup({
      insert: async () => {
        throw new Error("PERMISSION_DENIED");
      },
    });
    await last.paste();
    expect(deps.copy).toHaveBeenCalledWith("the stored text");
    expect(deps.notify).toHaveBeenCalledWith("warn", "Copied: the text could not be pasted");
  });

  it("does nothing during a dictation, and never pastes twice at once", async () => {
    const during = setup({ busy: () => true });
    await during.last.paste();
    expect(during.deps.insert).not.toHaveBeenCalled();
    const { deps, last } = setup();
    await Promise.all([last.paste(), last.paste()]);
    expect(deps.insert).toHaveBeenCalledOnce();
  });
});
