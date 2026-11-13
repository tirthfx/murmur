import { describe, expect, it, vi } from "vitest";
import { REWRITE_PANEL_CHANNELS } from "@murmur/shared";
import type { RewriteController } from "./rewrite-controller";
import { createRewritePanelIpcHandler } from "./panel-ipc";

const entryUrl = "file:///app/renderer/main_window/rewrite.html";

function setup() {
  const controller: RewriteController = {
    open: vi.fn(),
    runDirect: vi.fn(),
    runCommand: vi.fn(async () => {}),
    choose: vi.fn(async () => {}),
    regenerate: vi.fn(async () => {}),
    back: vi.fn(),
    replace: vi.fn(async () => {}),
    copy: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    state: vi.fn(() => ({ stage: "hidden" as const })),
  };
  return { controller, handle: createRewritePanelIpcHandler({ entryUrl, controller }) };
}

describe("Rewrite panel IPC", () => {
  it("answers ready with the state and passes choices on", async () => {
    const { controller, handle } = setup();
    await expect(handle(REWRITE_PANEL_CHANNELS.ready, entryUrl, [])).resolves.toEqual({
      stage: "hidden",
    });
    await handle(REWRITE_PANEL_CHANNELS.choose, entryUrl, ["builtin:concise"]);
    expect(controller.choose).toHaveBeenCalledWith("builtin:concise");
    for (const channel of ["regenerate", "back", "replace", "copy", "close"] as const) {
      await handle(REWRITE_PANEL_CHANNELS[channel], entryUrl, []);
      expect(controller[channel]).toHaveBeenCalledOnce();
    }
  });

  it("rejects other pages and bad arguments", async () => {
    const { controller, handle } = setup();
    await expect(
      handle(REWRITE_PANEL_CHANNELS.replace, "file:///app/renderer/main_window/index.html", []),
    ).rejects.toThrow("untrusted sender");
    await expect(handle(REWRITE_PANEL_CHANNELS.choose, entryUrl, [42])).rejects.toThrow(
      "invalid call",
    );
    await expect(handle("rewrite-panel:other", entryUrl, [])).rejects.toThrow("invalid call");
    expect(controller.replace).not.toHaveBeenCalled();
  });
});
