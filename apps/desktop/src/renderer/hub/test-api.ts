import { vi } from "vitest";
import type { MurmurApi, PermissionsInfo, SettingsView, SetupStatus } from "@murmur/shared";

export const SAMPLE_SETTINGS: SettingsView = {
  settings: {
    holdShortcut: { type: "key", keyCode: 61, modifiers: [] },
    handsFreeShortcut: null,
    inputDevice: "auto",
    language: "auto",
    cleanupLevel: "standard",
    sounds: { start: true, lock: true, success: true, error: true, cancel: false },
    muteWhileDictating: false,
    setupComplete: true,
    pressEnterCommand: true,
    contextAwareness: true,
    mouseButtons: { hold: null, handsFree: null },
    typingReminder: { enabled: true, snoozedUntil: null },
    whisperMode: false,
  },
  shortcutLabels: { hold: "Right Option", handsFree: "Double-tap Right Option" },
  devices: [
    {
      id: "BuiltIn",
      name: "MacBook Pro Microphone",
      isDefault: true,
      transport: "builtin",
      sampleRate: 48000,
    },
    { id: "USB-1", name: "Desk Mic", isDefault: false, transport: "usb", sampleRate: 44100 },
  ],
};

export const SAMPLE_PERMISSIONS: PermissionsInfo = {
  statuses: {
    microphone: "granted",
    accessibility: "denied",
    inputMonitoring: "not_determined",
    screenRecording: "unknown",
  },
  message: null,
};

export const SAMPLE_SETUP: SetupStatus = {
  model: {
    state: "ready",
    label: "Test speech model",
    totalBytes: 648_000_000,
    downloadedBytes: 0,
    message: null,
  },
  blockers: [],
};

/** A mocked preload API for renderer tests. Override any member. */
export function createMockApi(overrides: Partial<MurmurApi> = {}): MurmurApi {
  return {
    getAppInfo: vi.fn().mockResolvedValue({ name: "Murmur", version: "1.2.3", platform: "darwin" }),
    getHelperStatus: vi
      .fn()
      .mockResolvedValue({ state: "ready", helperVersion: "0.1.0", message: null }),
    getPermissions: vi.fn().mockResolvedValue(SAMPLE_PERMISSIONS),
    requestPermission: vi.fn().mockResolvedValue(SAMPLE_PERMISSIONS),
    openPermissionSettings: vi.fn().mockResolvedValue(undefined),
    getSettings: vi.fn().mockResolvedValue(SAMPLE_SETTINGS),
    updateSettings: vi.fn().mockResolvedValue(SAMPLE_SETTINGS),
    setShortcut: vi.fn().mockResolvedValue({ ok: true, view: SAMPLE_SETTINGS }),
    captureShortcut: vi.fn().mockResolvedValue(undefined),
    getSetupStatus: vi.fn().mockResolvedValue(SAMPLE_SETUP),
    downloadSpeechModel: vi.fn().mockResolvedValue(SAMPLE_SETUP),
    micCheckStart: vi.fn().mockResolvedValue({ ok: true, deviceName: "Desk Mic" }),
    micCheckStop: vi.fn().mockResolvedValue(null),
    onMicCheckLevel: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}
