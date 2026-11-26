import {
  DEFAULT_CONNECTOR_SETTINGS,
  DEFAULT_MCP_SETTINGS,
  DEFAULT_EXTENSIONS_SETTINGS,
  DEFAULT_NOTETAKER,
} from "@murmur/shared";
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
  rewriteShortcut: null,
  instructShortcut: null,
  focusShortcut: null,
  focus: { duration: 25 },
  plan: "enterprise",
  instruct: { fieldContext: true, memory: true, samples: true, saveThreads: true, model: "fast" },
  commandShortcut: null,
  commandMode: { wakePhrase: "Hey Murmur", wakePhraseEnabled: true },
  inputDevice: "auto",
  languages: [],
  cleanupLevel: "standard",
  sounds: { start: true, lock: true, success: true, error: true, cancel: false },
  muteWhileDictating: false,
  sessionLimitMinutes: 20,
  setupComplete: true,
  pressEnterCommand: true,
  openHubOnLaunch: true,
  insights: { typingWpm: 40 },
  profile: { displayName: "", showOnHome: true },
  scratchpadShortcut: null,
  copyLastShortcut: null,
  pasteLastShortcut: null,
  meetingShortcut: null,
  scratchpad: { enabled: true, newTab: true },
  theme: "system",
  language: "en",
  notifications: {
    dictationFailed: true,
    modelDownload: true,
    focusEnded: true,
    milestone: false,
    weeklySummary: false,
  },
  privacy: { storeHistory: true, audio: "24h", historyDays: null, strictLocal: false },
  planState: { trial: null, student: false, log: [] },
  devMode: { enabled: false, disableCleanup: false, forceTyped: false, disableContext: false },
  help: { tours: {} },
  referral: { code: "ABCD2345", invites: 0 },
  notetaker: DEFAULT_NOTETAKER,
  connectors: DEFAULT_CONNECTOR_SETTINGS,
  mcp: DEFAULT_MCP_SETTINGS,
  extensions: DEFAULT_EXTENSIONS_SETTINGS,
  contextAwareness: true,
  mouseButtons: { hold: null, handsFree: null },
  typingReminder: { enabled: true, snoozedUntil: null },
  whisperMode: false,
  memory: { enabled: true, fromDictation: true },
  learnCorrections: true,
  voiceProfile: { enabled: true, useInCleanup: true, prompts: true },
  email: { signature: "", addToNew: true, addToReplies: false, language: null },
  jargonPacks: { git: true, packages: true, web: true, cloud: false, databases: false },
  developerTools: {
    fileTags: false,
    codeFolders: [],
    variables: false,
    cliDetection: false,
    cliNames: ["claude"],
  },
  experimental: {
    splitMessages: false,
    pauseMedia: false,
    headsetWear: false,
    ringMicrophone: false,
    bulkImport: false,
    phraseLearning: false,
    styleDetection: false,
    pronunciationClips: false,
    commandMode: false,
    autoInstruct: false,
    focusMode: false,
    askConnectorActions: false,
    slackTagging: false,
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
      rewrite: "Off",
      command: "Off",
      instruct: "Off",
      focus: "Off",
      scratchpad: "Off",
      meeting: "Off",
      copyLast: "Off",
      pasteLast: "Off",
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

  it("sets, checks and turns off the Rewrite shortcut", async () => {
    const { service } = setup();
    const saved = await service.setShortcut("rewrite", {
      code: "KeyR",
      modifiers: ["control", "option"],
    });
    expect(saved.ok && saved.view.shortcutLabels.rewrite).toBe("Control+Option+R");
    expect(
      await service.setShortcut("handsFree", { code: "KeyR", modifiers: ["control", "option"] }),
    ).toEqual({ ok: false, message: "Control+Option+R is already used for Rewrite." });
    const off = await service.setShortcut("rewrite", null);
    expect(off.ok && off.view.shortcutLabels.rewrite).toBe("Off");
  });

  it("binds the Rewrite shortcut to open the panel", () => {
    const trigger = {
      type: "key" as const,
      keyCode: 15,
      modifiers: ["control" as const, "option" as const],
    };
    expect(bindingsFor({ ...defaults, rewriteShortcut: trigger }).at(-1)).toEqual({
      id: "rewrite-panel",
      action: "rewrite",
      trigger,
      mode: "press",
      rewriteId: "panel",
    });
    expect(bindingsFor(defaults).some((binding) => binding.action === "rewrite")).toBe(false);
  });

  it("binds the Instruct key as a hold, unless it is off", () => {
    const trigger = {
      type: "key" as const,
      keyCode: 34,
      modifiers: ["control" as const, "option" as const],
    };
    expect(bindingsFor({ ...defaults, instructShortcut: trigger })).toContainEqual({
      id: "instruct-mode",
      action: "instruct.mode",
      trigger,
      mode: "hold",
    });
    expect(bindingsFor(defaults).some((binding) => binding.action === "instruct.mode")).toBe(false);
  });

  it("binds Command Mode and Focus only from Pro up, and Pro unlocks them at once", () => {
    const command = { type: "key" as const, keyCode: 54, modifiers: [] };
    const focus = {
      type: "key" as const,
      keyCode: 3,
      modifiers: ["control" as const, "option" as const],
    };
    const settings = {
      ...defaults,
      commandShortcut: command,
      focusShortcut: focus,
      experimental: { ...defaults.experimental, commandMode: true, focusMode: true },
    };
    const actions = (plan: typeof defaults.plan) =>
      bindingsFor({ ...settings, plan }).map((binding) => binding.action);
    expect(actions("free")).not.toContain("command.mode");
    expect(actions("free")).not.toContain("focus.toggle");
    expect(actions("pro")).toEqual(expect.arrayContaining(["command.mode", "focus.toggle"]));
  });

  it("binds the Focus shortcut as a press, only while Focus Mode is on", () => {
    const trigger = {
      type: "key" as const,
      keyCode: 3,
      modifiers: ["control" as const, "option" as const],
    };
    const settings = { ...defaults, focusShortcut: trigger };
    expect(bindingsFor(settings).some((binding) => binding.action === "focus.toggle")).toBe(false);
    expect(
      bindingsFor({ ...settings, experimental: { ...defaults.experimental, focusMode: true } }),
    ).toContainEqual({ id: "focus-toggle", action: "focus.toggle", trigger, mode: "press" });
  });

  it("binds the Command Mode key, exclusive, only while Command Mode is on", () => {
    const rightCommand = { type: "key" as const, keyCode: 54, modifiers: [] };
    const settings = { ...defaults, commandShortcut: rightCommand };
    expect(bindingsFor(settings).some((binding) => binding.action === "command.mode")).toBe(false);
    expect(
      bindingsFor({ ...settings, experimental: { ...defaults.experimental, commandMode: true } }),
    ).toContainEqual({
      id: "command-mode",
      action: "command.mode",
      trigger: rightCommand,
      mode: "hold",
      exclusive: true,
    });
    expect(
      bindingsFor({
        ...defaults,
        experimental: { ...defaults.experimental, commandMode: true },
      }).some((binding) => binding.action === "command.mode"),
    ).toBe(false);
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

describe("Scratchpad shortcut (HB-26, HB-34)", () => {
  it("binds the shortcut only while Scratchpad is on", () => {
    const trigger = {
      type: "key" as const,
      keyCode: 1,
      modifiers: ["control" as const, "option" as const],
    };
    const on = { ...defaults, scratchpadShortcut: trigger };
    expect(bindingsFor(on)).toContainEqual({
      id: "scratchpad-open",
      action: "scratchpad.open",
      trigger,
      mode: "press",
    });
    const off = { ...on, scratchpad: { enabled: false, newTab: true } };
    expect(bindingsFor(off).some((binding) => binding.action === "scratchpad.open")).toBe(false);
  });
});

describe("Meeting recording shortcut (NT-03)", () => {
  it("is not bound until it is set, then a press starts or stops a recording", () => {
    expect(bindingsFor(defaults).some((binding) => binding.action === "notetaker.start")).toBe(
      false,
    );
    const trigger = {
      type: "key" as const,
      keyCode: 15,
      modifiers: ["control" as const, "option" as const],
    };
    expect(bindingsFor({ ...defaults, meetingShortcut: trigger })).toContainEqual({
      id: "meeting-toggle",
      action: "notetaker.start",
      trigger,
      mode: "press",
    });
  });

  it("is checked against the dictation keys and the other shortcuts", async () => {
    const { service, store } = setup();
    const saved = await service.setShortcut("meeting", {
      code: "KeyM",
      modifiers: ["control", "option"],
    });
    expect(saved.ok && saved.view.shortcutLabels.meeting).toBe("Control+Option+M");
    expect(store.get().meetingShortcut).not.toBeNull();
    expect(
      await service.setShortcut("handsFree", { code: "KeyM", modifiers: ["control", "option"] }),
    ).toEqual({ ok: false, message: "Control+Option+M is already used for Meeting recording." });
    // The dictation key itself cannot be taken.
    const hold = await service.setShortcut("meeting", { code: "AltRight", modifiers: [] });
    expect(hold.ok).toBe(false);
    // A modifier on its own is refused: it would fire as a hold.
    const lone = await service.setShortcut("meeting", { code: "ShiftLeft", modifiers: [] });
    expect(lone.ok).toBe(false);
    const off = await service.setShortcut("meeting", null);
    expect(off.ok && off.view.shortcutLabels.meeting).toBe("Off");
  });
});

describe("copy and paste last transcript bindings (DC-39)", () => {
  const trigger = (keyCode: number) => ({
    type: "key" as const,
    keyCode,
    modifiers: ["control" as const, "option" as const],
  });

  it("binds both as presses, and neither when turned off", () => {
    const on = { ...defaults, copyLastShortcut: trigger(8), pasteLastShortcut: trigger(9) };
    expect(bindingsFor(on)).toEqual(
      expect.arrayContaining([
        { id: "copy-last", action: "copy.last", trigger: trigger(8), mode: "press" },
        { id: "paste-last", action: "paste.last", trigger: trigger(9), mode: "press" },
      ]),
    );
    expect(bindingsFor(defaults).map((binding) => binding.id)).not.toContain("paste-last");
  });
});
