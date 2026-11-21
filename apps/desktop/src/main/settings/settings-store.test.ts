import { DEFAULT_NOTETAKER } from "@murmur/shared";
import { describe, expect, it, vi } from "vitest";
import type { Settings } from "@murmur/shared";
import { openDatabase } from "../db/database";
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
  setupComplete: true,
  pressEnterCommand: true,
  openHubOnLaunch: true,
  insights: { typingWpm: 40 },
  profile: { displayName: "", showOnHome: true },
  scratchpadShortcut: null,
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
  },
};

describe("settings store", () => {
  it("starts from the defaults and keeps changes across a restart", () => {
    const db = openDatabase(":memory:");
    const first = createSettingsStore(db, defaults, () => 7);
    expect(first.get()).toEqual(defaults);
    first.update({ languages: ["hi"], inputDevice: "USB-1" });
    first.setShortcut("handsFree", { type: "key", keyCode: 2, modifiers: ["control", "option"] });

    const again = createSettingsStore(db, defaults);
    expect(again.get()).toEqual({
      ...defaults,
      languages: ["hi"],
      inputDevice: "USB-1",
      handsFreeShortcut: { type: "key", keyCode: 2, modifiers: ["control", "option"] },
    });
    expect(
      db
        .prepare("SELECT key, value_json, updated_at FROM settings WHERE key = 'speech.languages'")
        .get(),
    ).toEqual({
      key: "speech.languages",
      value_json: '["hi"]',
      updated_at: 7,
    });
  });

  it("tells listeners what changed, and nothing when nothing did", () => {
    const store = createSettingsStore(openDatabase(":memory:"), defaults);
    const handler = vi.fn();
    store.onChange(handler);
    store.update({ cleanupLevel: "full" });
    store.update({ cleanupLevel: "full" });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![1]).toEqual(["cleanupLevel"]);
  });

  it("carries a single language stored before over to the list", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, 1)").run(
      "speech.language",
      '"hi"',
    );
    expect(createSettingsStore(db, defaults).get().languages).toEqual(["hi"]);
    const auto = openDatabase(":memory:");
    auto
      .prepare("INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, 1)")
      .run("speech.language", '"auto"');
    expect(createSettingsStore(auto, defaults).get().languages).toEqual([]);
  });

  it("ignores stored values that no longer validate", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, 1)").run(
      "speech.languages",
      '["klingon"]',
    );
    expect(createSettingsStore(db, defaults).get().languages).toEqual([]);
  });

  it("keeps stored flags when a new flag is added to their group", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, 1)").run(
      "experimental.flags",
      JSON.stringify({
        splitMessages: true,
        pauseMedia: true,
        headsetWear: false,
        ringMicrophone: false,
      }),
    );
    expect(createSettingsStore(db, defaults).get().experimental).toEqual({
      ...defaults.experimental,
      splitMessages: true,
      pauseMedia: true,
    });
  });

  it("refuses invalid values and clearing the hold key", () => {
    const store = createSettingsStore(null, defaults);
    expect(() => store.update({ languages: ["xx"] as never })).toThrow();
    expect(() => store.update({ languages: ["en", "hi", "fr", "de", "it", "es"] })).toThrow();
    expect(() => store.update({ languages: ["en", "en"] })).toThrow();
    expect(() => store.setShortcut("hold", null)).toThrow("always needs a key");
    expect(store.setShortcut("handsFree", null).handsFreeShortcut).toBeNull();
  });
});

describe("notetaker consent setting (NT-25)", () => {
  it("defaults to the first time, and a value saved before it existed still reads", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, 1)").run(
      "notetaker.settings",
      JSON.stringify({ captureSystem: false, chunkSeconds: 20, live: true }),
    );
    const store = createSettingsStore(db, defaults);
    expect(store.get().notetaker).toEqual({
      captureSystem: false,
      chunkSeconds: 20,
      live: true,
      consent: { notice: "first", seen: false },
    });
    store.update({
      notetaker: { ...store.get().notetaker, consent: { notice: "always", seen: true } },
    });
    expect(createSettingsStore(db, defaults).get().notetaker.consent).toEqual({
      notice: "always",
      seen: true,
    });
  });
});
