// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INSTRUCT_MESSAGES, type InstructPanelState, type MurmurInstructApi } from "@murmur/shared";
import { InstructPanel } from "./InstructPanel";

afterEach(cleanup);

function api(initial: InstructPanelState) {
  let push: (state: InstructPanelState) => void = () => {};
  const mock: MurmurInstructApi = {
    ready: vi.fn(async () => initial),
    onState: vi.fn((handler) => {
      push = handler;
      return () => {};
    }),
    insert: vi.fn(async () => {}),
    copy: vi.fn(async () => {}),
    regenerate: vi.fn(async () => {}),
    toggleSource: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    newThread: vi.fn(async () => {}),
    undo: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  return { mock, push: (state: InstructPanelState) => act(() => push(state)) };
}

const thread = {
  instruction: "send this to Sam",
  earlier: [] as string[],
  turns: 1,
  model: "fast" as const,
  qualityAvailable: false,
  available: ["selection", "memory", "samples"] as const,
  off: [] as const,
};

describe("Instruct panel", () => {
  it("streams, then shows the draft with chips, the note and the actions", async () => {
    const { mock, push } = api({ stage: "hidden" });
    render(<InstructPanel api={mock} />);
    push({
      ...thread,
      available: [...thread.available],
      off: [],
      stage: "running",
      text: "Hi Sam",
      loading: false,
    });
    expect(screen.getByText("Hi Sam")).toBeTruthy();
    push({
      ...thread,
      available: [...thread.available],
      off: [],
      stage: "draft",
      text: "Hi Sam, here it is.",
      used: ["selection", "memory"],
      note: INSTRUCT_MESSAGES.draftsOnly,
    });
    expect(screen.getByLabelText("Draft").textContent).toBe("Hi Sam, here it is.");
    expect(screen.getByRole("note").textContent).toBe(INSTRUCT_MESSAGES.draftsOnly);
    expect(screen.getByText("“send this to Sam”")).toBeTruthy();
    const samples = screen.getByRole("button", {
      name: "Stop using Writing samples for this draft",
    });
    expect(samples.getAttribute("aria-pressed")).toBe("false");
    expect(
      screen
        .getByRole("button", { name: "Stop using Memory for this draft" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(samples);
    expect(mock.toggleSource).toHaveBeenCalledWith("samples");
    fireEvent.click(screen.getByRole("button", { name: "Insert at the caret" }));
    expect(mock.insert).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(mock.copy).toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const { mock, push } = api({ stage: "hidden" });
    render(<InstructPanel api={mock} />);
    push({
      ...thread,
      available: [],
      off: [],
      stage: "message",
      message: "Taking too long.",
      canRetry: true,
    });
    expect(screen.getByText("Taking too long.")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mock.close).toHaveBeenCalled();
  });

  it("sends a typed follow-up, shows earlier requests and stops at 20", async () => {
    const { mock, push } = api({ stage: "hidden" });
    render(<InstructPanel api={mock} />);
    const draft = {
      ...thread,
      available: [],
      off: [],
      instruction: "make it shorter",
      earlier: ["write to Sam"],
      turns: 2,
      stage: "draft" as const,
      text: "Short.",
      used: [],
      note: null,
    };
    push(draft);
    expect(screen.getByRole("list", { name: "Earlier requests" }).textContent).toBe("write to Sam");
    fireEvent.change(screen.getByRole("textbox", { name: "Ask for a change" }), {
      target: { value: "add a thank you" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send the request" }));
    expect(mock.followUp).toHaveBeenCalledWith("add a thank you");
    push({ ...draft, turns: 20 });
    expect(screen.queryByRole("textbox", { name: "Ask for a change" })).toBeNull();
    expect(screen.getByText(INSTRUCT_MESSAGES.turnLimit)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start a new thread" }));
    expect(mock.newThread).toHaveBeenCalled();
  });

  it("asks for a first request in a new thread", async () => {
    const { mock, push } = api({ stage: "hidden" });
    render(<InstructPanel api={mock} />);
    push({ stage: "empty" });
    expect(screen.getByText(INSTRUCT_MESSAGES.newThread)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "What should Murmur write?" }), {
      target: { value: "a haiku" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send the request" }));
    expect(mock.followUp).toHaveBeenCalledWith("a haiku");
  });

  it("undoes the last insert on Control+Z, but not on Command+Z", async () => {
    const { mock, push } = api({ stage: "hidden" });
    render(<InstructPanel api={mock} />);
    push({ stage: "empty" });
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(mock.undo).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(mock.undo).toHaveBeenCalled();
  });

  it("shows the model switch and says Quality needs a download", async () => {
    const { mock, push } = api({ stage: "hidden" });
    render(<InstructPanel api={mock} />);
    push({ ...thread, available: [], off: [], stage: "draft", text: "x", used: [], note: null });
    expect(screen.getByText(INSTRUCT_MESSAGES.downloadQuality)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Quality" }));
    expect(mock.setModel).toHaveBeenCalledWith("quality");
  });
});
