import { describe, expect, it, vi } from "vitest";
import { INSTRUCT_PANEL_CHANNELS } from "@murmur/shared";
import type { InstructController } from "./instruct-controller";
import { createInstructPanelIpcHandler } from "./panel-ipc";

const URL = "file:///app/instruct.html";

function setup() {
  const controller: InstructController = {
    spoken: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    newThread: vi.fn(async () => {}),
    reuse: vi.fn(async () => true),
    insert: vi.fn(async () => {}),
    copy: vi.fn(async () => {}),
    regenerate: vi.fn(async () => {}),
    toggleSource: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    state: vi.fn(() => ({ stage: "hidden" as const })),
  };
  return { controller, handle: createInstructPanelIpcHandler({ entryUrl: URL, controller }) };
}

describe("Instruct panel IPC", () => {
  it("passes checked calls to the controller", async () => {
    const { controller, handle } = setup();
    expect(await handle(INSTRUCT_PANEL_CHANNELS.ready, URL, [])).toEqual({ stage: "hidden" });
    await handle(INSTRUCT_PANEL_CHANNELS.toggleSource, URL, ["samples"]);
    expect(controller.toggleSource).toHaveBeenCalledWith("samples");
    await handle(INSTRUCT_PANEL_CHANNELS.followUp, URL, ["make it shorter"]);
    expect(controller.followUp).toHaveBeenCalledWith("make it shorter");
    await handle(INSTRUCT_PANEL_CHANNELS.insert, URL, []);
    expect(controller.insert).toHaveBeenCalled();
  });

  it("refuses other pages and bad arguments", async () => {
    const { controller, handle } = setup();
    await expect(
      handle(INSTRUCT_PANEL_CHANNELS.insert, "file:///app/index.html", []),
    ).rejects.toThrow("untrusted sender");
    await expect(handle(INSTRUCT_PANEL_CHANNELS.toggleSource, URL, ["email"])).rejects.toThrow(
      "invalid call",
    );
    await expect(handle(INSTRUCT_PANEL_CHANNELS.followUp, URL, ["x".repeat(1001)])).rejects.toThrow(
      "invalid call",
    );
    await expect(handle(INSTRUCT_PANEL_CHANNELS.insert, URL, ["extra"])).rejects.toThrow(
      "invalid call",
    );
    expect(controller.insert).not.toHaveBeenCalled();
  });
});
