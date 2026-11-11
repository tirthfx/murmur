import { describe, expect, it, vi } from "vitest";
import { BAR_IPC_CHANNELS } from "@murmur/shared";
import { INITIAL_VIEW } from "./bar-machine";
import { createBarIpcHandler } from "./bar-ipc";

const barUrl = "file:///app/.vite/renderer/main_window/bar.html";
const hubUrl = "file:///app/.vite/renderer/main_window/index.html";

function setup() {
  const deps = {
    entryUrl: barUrl,
    getView: vi.fn(() => INITIAL_VIEW),
    dragStart: vi.fn(),
    drag: vi.fn(),
    dragEnd: vi.fn(),
    click: vi.fn(),
    answer: vi.fn(),
  };
  return { deps, handle: createBarIpcHandler(deps) };
}

describe("bar IPC", () => {
  it("answers ready with the current view and passes drags and clicks on", () => {
    const { deps, handle } = setup();
    expect(handle(BAR_IPC_CHANNELS.ready, barUrl, [])).toEqual(INITIAL_VIEW);
    handle(BAR_IPC_CHANNELS.dragStart, barUrl, []);
    handle(BAR_IPC_CHANNELS.drag, barUrl, [12, -4]);
    handle(BAR_IPC_CHANNELS.dragEnd, barUrl, []);
    handle(BAR_IPC_CHANNELS.click, barUrl, []);
    expect(deps.drag).toHaveBeenCalledWith(12, -4);
    expect(deps.dragStart).toHaveBeenCalledOnce();
    expect(deps.dragEnd).toHaveBeenCalledOnce();
    expect(deps.click).toHaveBeenCalledOnce();
  });

  it("refuses the Hub page and any other sender", () => {
    const { deps, handle } = setup();
    expect(() => handle(BAR_IPC_CHANNELS.click, hubUrl, [])).toThrow("untrusted sender");
    expect(() => handle(BAR_IPC_CHANNELS.click, "https://example.com/", [])).toThrow(
      "untrusted sender",
    );
    expect(() => handle(BAR_IPC_CHANNELS.click, undefined, [])).toThrow("untrusted sender");
    expect(deps.click).not.toHaveBeenCalled();
  });

  it("refuses bad arguments and unknown channels", () => {
    const { deps, handle } = setup();
    expect(() => handle(BAR_IPC_CHANNELS.drag, barUrl, ["12", 0])).toThrow("invalid call");
    expect(() => handle(BAR_IPC_CHANNELS.drag, barUrl, [1.5, 0])).toThrow("invalid call");
    expect(() => handle(BAR_IPC_CHANNELS.drag, barUrl, [1e9, 0])).toThrow("invalid call");
    expect(() => handle(BAR_IPC_CHANNELS.click, barUrl, ["extra"])).toThrow("invalid call");
    expect(() => handle("bar:nope", barUrl, [])).toThrow("invalid call");
    expect(() => handle("toString", barUrl, [])).toThrow("invalid call");
    expect(deps.drag).not.toHaveBeenCalled();
  });

  it("passes a valid answer on and refuses anything else", () => {
    const { deps, handle } = setup();
    handle(BAR_IPC_CHANNELS.answer, barUrl, ["yes"]);
    expect(deps.answer).toHaveBeenCalledWith("yes");
    expect(() => handle(BAR_IPC_CHANNELS.answer, barUrl, ["maybe"])).toThrow();
  });
});
