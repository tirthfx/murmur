import { describe, expect, it, vi } from "vitest";
import { FOCUS_OVERLAY_CHANNELS } from "@murmur/shared";
import { createFocusOverlayIpcHandler } from "./overlay-ipc";

const ENTRY = "file:///app/renderer/focus.html";

function setup() {
  const deps = {
    entryUrl: ENTRY,
    state: () => ({ stage: "blocked" as const, name: "Safari" }),
    goBack: vi.fn(async () => {}),
    pause: vi.fn(),
    turnOff: vi.fn(),
  };
  return { deps, handle: createFocusOverlayIpcHandler(deps) };
}

describe("focus overlay IPC", () => {
  it("answers the overlay page", async () => {
    const { deps, handle } = setup();
    expect(await handle(FOCUS_OVERLAY_CHANNELS.ready, ENTRY, [])).toEqual({
      stage: "blocked",
      name: "Safari",
    });
    await handle(FOCUS_OVERLAY_CHANNELS.goBack, ENTRY, []);
    await handle(FOCUS_OVERLAY_CHANNELS.pause, ENTRY, []);
    await handle(FOCUS_OVERLAY_CHANNELS.turnOff, ENTRY, []);
    expect(deps.goBack).toHaveBeenCalled();
    expect(deps.pause).toHaveBeenCalled();
    expect(deps.turnOff).toHaveBeenCalled();
  });

  it("refuses other pages and extra arguments", async () => {
    const { handle } = setup();
    await expect(handle(FOCUS_OVERLAY_CHANNELS.pause, "https://example.com/", [])).rejects.toThrow(
      "untrusted sender",
    );
    await expect(handle(FOCUS_OVERLAY_CHANNELS.pause, ENTRY, ["x"])).rejects.toThrow(
      "invalid call",
    );
  });
});
