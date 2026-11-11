import { vi } from "vitest";
import type {
  MurmurApi,
  PermissionsInfo,
  SettingsView,
  SetupStatus,
  StylesView,
  VoiceProfileView,
} from "@murmur/shared";

export const SAMPLE_SETTINGS: SettingsView = {
  settings: {
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

export const SAMPLE_PROFILE: VoiceProfileView = {
  sessions: 0,
  totalWords: 0,
  measures: [],
  topPhrases: [],
  summary: null,
  milestones: [],
  examples: { personal: [], work: [], email: [], other: [] },
  passage: "",
};

export const SAMPLE_STYLES: StylesView = {
  styles: [
    {
      id: "style-personal",
      category: "personal",
      preset: "no-caps-less",
      instructions: "",
      updatedAt: 0,
    },
    { id: "style-work", category: "work", preset: "caps", instructions: "", updatedAt: 0 },
    { id: "style-email", category: "email", preset: "formal", instructions: "", updatedAt: 0 },
    { id: "style-other", category: "other", preset: "caps", instructions: "", updatedAt: 0 },
  ],
  overrides: [],
  recentApps: [],
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
    getMediaPlayback: vi.fn().mockResolvedValue({ available: true, playing: false }),
    dictionaryList: vi.fn().mockResolvedValue([]),
    dictionarySave: vi.fn(),
    dictionaryDelete: vi.fn().mockResolvedValue(undefined),
    dictionaryKeep: vi.fn().mockResolvedValue(undefined),
    snippetsList: vi.fn().mockResolvedValue([]),
    snippetsSave: vi.fn(),
    snippetsDelete: vi.fn().mockResolvedValue(undefined),
    stylesView: vi.fn().mockResolvedValue(SAMPLE_STYLES),
    stylesUpdate: vi.fn().mockResolvedValue(SAMPLE_STYLES),
    stylesSetOverride: vi.fn().mockResolvedValue(SAMPLE_STYLES),
    stylesClearOverride: vi.fn().mockResolvedValue(SAMPLE_STYLES),
    memoryList: vi.fn().mockResolvedValue([]),
    memorySave: vi.fn(),
    memoryDelete: vi.fn().mockResolvedValue(undefined),
    importPreview: vi.fn(),
    importApply: vi.fn(),
    voiceProfileView: vi.fn().mockResolvedValue(SAMPLE_PROFILE),
    voiceProfileReset: vi.fn().mockResolvedValue(SAMPLE_PROFILE),
    writingSamplesList: vi.fn().mockResolvedValue([]),
    writingSamplesSave: vi.fn().mockResolvedValue({
      ok: false,
      reason: "full",
      message: "Full",
    }),
    writingSamplesDelete: vi.fn().mockResolvedValue(undefined),
    onOpenPage: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}
