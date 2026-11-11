import { describe, expect, it, vi } from "vitest";
import type { Settings } from "@murmur/shared";
import { keyPlatform } from "../platform";
import {
  bindingsFor,
  createSettingsService,
  deviceFor,
  languagesFor,
  wantsLatinHindi,
} from "./settings-service";
import { createSettingsStore } from "./settings-store";

const defaults: Settings = {
  holdShortcut: { type: "key", keyCode: 61, modifiers: [] },
  handsFreeShortcut: null,
  inputDevice: "auto",
  languages: [],
  cleanupLevel: "standard",
  sounds: { start: true, lock: true, success: true, error: true, cancel: false },
  muteWhileDictating: false,
  setupComplete: true,
  pressEnterCommand: true,
  contextAwareness: true,
  mouseButtons: { hold: null, handsFree: null },
  typingReminder: { enabled: true, snoozedUntil: null },
  whisperMode: false,
  memory: { enabled: true, fromDictation: true },
  learnCorrections: true,
  voiceProfile: { enabled: true, useInCleanup: true, prompts: true },
  email: { signature: "", addToNew: true, addToReplies: false, language: null },
  experimental: {
    splitMessages: false,
    pauseMedia: false,
    headsetWear: false,
    ringMicrophone: false,
    bulkImport: false,
  },
};

function setup() {
  const store = createSettingsStore(null, defaults);
  const listDevices = vi.fn(async () => [
    {
      id: "USB-1",
      name: "Desk Mic",
      isDefault: false,
      transport: "usb" as const,
      sampleRate: 44100,
    },
  ]);
  return {
    store,
    listDevices,
    service: createSettingsService({ store, platform: keyPlatform("darwin"), listDevices }),
  };
}

describe("settings service", () => {
  it("shows readable shortcut names and the device list", async () => {
    const { service } = setup();
    const view = await service.view();
    expect(view.shortcutLabels).toEqual({
      hold: "Right Option",
      handsFree: "Double-tap Right Option",
    });
    expect(view.devices?.[0]?.name).toBe("Desk Mic");
  });

  it("still shows the page when the helper cannot list devices", async () => {
    const { service, listDevices } = setup();
    listDevices.mockRejectedValueOnce(new Error("not running"));
    expect((await service.view()).devices).toBeNull();
  });

  it("saves a valid shortcut and refuses a conflicting one with the action's name", async () => {
    const { service, store } = setup();
    const saved = await service.setShortcut("handsFree", {
      code: "KeyD",
      modifiers: ["control", "option"],
    });
    expect(saved.ok && saved.view.shortcutLabels.handsFree).toBe("Control+Option+D");
    expect(
      await service.setShortcut("hold", { code: "KeyD", modifiers: ["option", "control"] }),
    ).toEqual({
      ok: false,
      message: "Control+Option+D is already used for Hands-free.",
    });
    expect(await service.setShortcut("hold", { code: "Space", modifiers: ["command"] })).toEqual({
      ok: false,
      message: "Command+Space is used by macOS for Spotlight.",
    });
    expect(store.get().holdShortcut.keyCode).toBe(61);
  });

  it("clears hands-free back to the double tap, but never the hold key", async () => {
    const { service, store } = setup();
    await service.setShortcut("handsFree", { code: "KeyD", modifiers: ["control"] });
    await service.setShortcut("handsFree", null);
    expect(store.get().handsFreeShortcut).toBeNull();
    expect(await service.setShortcut("hold", null)).toEqual({
      ok: false,
      message: "Push to talk always needs a key.",
    });
  });

  it("turns settings into bindings, a device and languages", () => {
    expect(bindingsFor(defaults)).toEqual([
      { id: "dictate-hold", action: "dictate.hold", trigger: defaults.holdShortcut, mode: "hold" },
    ]);
    const withToggle = {
      ...defaults,
      handsFreeShortcut: { type: "key" as const, keyCode: 2, modifiers: ["control" as const] },
    };
    expect(bindingsFor(withToggle)[1]).toMatchObject({
      id: "dictate-toggle",
      action: "dictate.toggle",
      mode: "press",
    });
    const withMouse = { ...defaults, mouseButtons: { hold: 3, handsFree: 4 } };
    expect(bindingsFor(withMouse).slice(1)).toEqual([
      {
        id: "dictate-hold-mouse",
        action: "dictate.hold",
        trigger: { type: "mouse", button: 3 },
        mode: "hold",
      },
      {
        id: "dictate-toggle-mouse",
        action: "dictate.toggle",
        trigger: { type: "mouse", button: 4 },
        mode: "press",
      },
    ]);
    expect(bindingsFor(defaults, 53).at(-1)).toEqual({
      id: "dictate-cancel",
      action: "dictate.cancel",
      trigger: { type: "key", keyCode: 53, modifiers: [] },
      mode: "press",
    });
    expect(deviceFor(defaults)).toBeNull();
    expect(deviceFor({ ...defaults, inputDevice: "USB-1" })).toBe("USB-1");
    expect(languagesFor(defaults)).toEqual([]);
    expect(languagesFor({ ...defaults, languages: ["hi", "en"] })).toEqual(["hi", "en"]);
    expect(languagesFor({ ...defaults, languages: ["hi-Latn", "en", "fr"] })).toEqual([
      "hi",
      "en",
      "fr",
    ]);
    expect(wantsLatinHindi({ ...defaults, languages: ["en", "hi-Latn"] })).toBe(true);
    expect(wantsLatinHindi({ ...defaults, languages: ["hi"] })).toBe(false);
  });
});
