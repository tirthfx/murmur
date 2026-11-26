import { describe, expect, it, vi } from "vitest";
import type { Settings } from "@murmur/shared";
import { barMenu, type BarMenuState } from "./bar-menu";
import { createNextSession } from "./next-session";

const settings = {
  language: "en",
  inputDevice: "auto",
  languages: ["en"],
  cleanupLevel: "standard",
} as unknown as Settings;

const state: BarMenuState = {
  settings,
  devices: [
    {
      id: "built-in",
      name: "Laptop Mic",
      isDefault: true,
      transport: "builtin",
      sampleRate: 48000,
    },
    { id: "desk", name: "Desk Mic", isDefault: false, transport: "usb", sampleRate: 48000 },
  ],
  deviceId: "desk",
  pending: false,
  typingReminder: "on",
};

const labels = (menu: ReturnType<typeof barMenu>) =>
  menu.flatMap((row) => (row.kind === "item" ? [row.label] : []));

describe("the Bar's menu (DC-46)", () => {
  it("names the microphone the next dictation will use, the language and the level", () => {
    expect(labels(barMenu(state))).toEqual([
      "Microphone: Desk Mic",
      "Language: English",
      "Cleanup: Standard",
      "Whisper mode",
      expect.any(String),
    ]);
  });

  it("names the system default when no device is chosen", () => {
    expect(labels(barMenu({ ...state, deviceId: null }))[0]).toBe("Microphone: Laptop Mic");
    expect(labels(barMenu({ ...state, deviceId: null, devices: null }))[0]).toBe(
      "Microphone: System default",
    );
  });

  it("offers to save only while a choice waits", () => {
    expect(labels(barMenu(state))).not.toContain("Save as default");
    expect(labels(barMenu({ ...state, pending: true }))).toContain("Save as default");
  });
});

describe("choices for the next dictation", () => {
  function setup() {
    const update = vi.fn();
    return { update, next: createNextSession(() => settings, update) };
  }

  it("apply to the next dictation, and not the one after", () => {
    const { next, update } = setup();
    next.choose({ cleanupLevel: "off" });
    expect(next.settings().cleanupLevel).toBe("off");
    next.started();
    expect(next.pending()).toBe(false);
    expect(next.settings().cleanupLevel).toBe("off");
    next.finished();
    expect(next.settings().cleanupLevel).toBe("standard");
    expect(update).not.toHaveBeenCalled();
  });

  it("are kept when saved as the default", () => {
    const { next, update } = setup();
    next.choose({ cleanupLevel: "full" });
    next.choose({ inputDevice: "desk" });
    next.save();
    expect(update).toHaveBeenCalledWith({ cleanupLevel: "full", inputDevice: "desk" });
    expect(next.pending()).toBe(false);
    next.save();
    expect(update).toHaveBeenCalledOnce();
  });
});
