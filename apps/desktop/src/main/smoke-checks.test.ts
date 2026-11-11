import { describe, expect, it } from "vitest";
import type { BarView, Settings } from "@murmur/shared";
import type { RecorderEvent } from "./recorder";
import { createSmokeChecks, inOrder, type SmokeChecks } from "./smoke-checks";

const settings: Settings = {
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
  experimental: {
    splitMessages: false,
    pauseMedia: false,
    headsetWear: false,
    ringMicrophone: false,
  },
};

/** A small stand-in for the app: dictation, the Bar, the tray, the output and the clipboard. */
function fakeApp(options: { muted?: boolean | null; broken?: "mute" | "silent" | "bar" } = {}) {
  let current = { ...settings };
  let muted: boolean | null = options.muted === undefined ? false : options.muted;
  let mutedByUs = false;
  let field = "";
  let clipboard = "owner's text";
  let silent = false;
  let recording = false;
  let last: string | null = null;
  let position: [number, number] = [500, 800];
  let saved: [number, number] = position;
  const ref = {} as { checks: SmokeChecks };
  const bar = (state: BarView["state"], message: string | null = null) =>
    ref.checks.handleBarView({ state, startedAt: null, words: null, message });
  const event = (type: string, extra: object = {}) =>
    ref.checks.handleRecorderEvent({ type, ...extra } as RecorderEvent);

  const start = () => {
    recording = true;
    event("started");
    bar("listening");
    ref.checks.handleSound("start");
    if (current.muteWhileDictating && muted === false && options.broken !== "mute") {
      muted = true;
      mutedByUs = true;
    }
    if (silent && options.broken !== "silent") {
      event("silent-mic", { deviceName: "Fixture clip" });
      bar("warning", "No sound from Fixture clip");
    }
  };
  const stop = () => {
    if (!recording) return;
    recording = false;
    if (mutedByUs) muted = false;
    mutedByUs = false;
    if (silent) return;
    bar("processing");
    last = "Hello there.";
    field = last;
    event("transcribed");
    bar("done");
    ref.checks.handleSound("success");
  };

  ref.checks = createSmokeChecks({
    sleep: async () => {},
    log: () => {},
    holdMs: 100,
    focusField: async () => {},
    isFieldFocused: () => true,
    clearField: async () => {
      field = "";
    },
    readField: async () => field,
    keyDown: start,
    keyUp: stop,
    settled: async () => {},
    barView: () => ({ state: "idle", startedAt: null, words: null, message: null }),
    barPosition: () => position,
    dragBar: async (dx, dy) => {
      position = [position[0] + dx, position[1] + dy];
      saved = position;
    },
    reopenBar: async () => {
      position = options.broken === "bar" ? [500, 800] : saved;
    },
    settings: () => current,
    updateSettings: (patch) => {
      current = { ...current, ...patch };
    },
    outputMuted: async () => muted,
    setOutputMuted: async (value) => {
      muted = value;
    },
    tray: (action) => {
      if (action.type === "toggle") (recording ? stop : start)();
      if (action.type === "device") current = { ...current, inputDevice: action.id };
      if (action.type === "language")
        current = { ...current, languages: action.code === "auto" ? [] : [action.code] };
      if (action.type === "copy-last" && last) clipboard = last;
    },
    lastTranscript: () => last,
    saveClipboard: async () => {
      const before = clipboard;
      return async () => {
        clipboard = before;
      };
    },
    readClipboardText: async () => clipboard,
    useSilentClip: (value) => {
      silent = value;
    },
  });
  return {
    checks: ref.checks,
    muted: () => muted,
    clipboard: () => clipboard,
    settings: () => current,
  };
}

const failed = (results: Awaited<ReturnType<SmokeChecks["run"]>>) =>
  results.filter((result) => result.ok === false).map((result) => result.name);

describe("full smoke checks", () => {
  it("passes when everything behaves, and leaves the Mac as it found it", async () => {
    const app = fakeApp();
    const results = await app.checks.run();
    expect(failed(results)).toEqual([]);
    expect(results.map((result) => result.name)).toEqual([
      "Bar position is saved and restored",
      "Tray: choosing a microphone",
      "Tray: choosing a language",
      "Bar shows listening, processing, done",
      "Text arrives while the test box keeps the focus",
      "Start and success sounds play",
      "Output muted while dictating, restored after",
      "Tray: Start and Stop dictation",
      "An output that was already muted stays muted",
      "Tray: Copy last transcript",
      "Silent microphone warns",
    ]);
    expect(app.muted()).toBe(false);
    expect(app.clipboard()).toBe("owner's text");
    expect(app.settings()).toMatchObject({ inputDevice: "auto", languages: [] });
  });

  it("fails the check that broke", async () => {
    expect(failed(await fakeApp({ broken: "mute" }).checks.run())).toEqual([
      "Output muted while dictating, restored after",
    ]);
    expect(failed(await fakeApp({ broken: "silent" }).checks.run())).toEqual([
      "Silent microphone warns",
    ]);
    expect(failed(await fakeApp({ broken: "bar" }).checks.run())).toEqual([
      "Bar position is saved and restored",
    ]);
  });

  it("skips the mute checks when there is no mute switch, and keeps a muted Mac muted", async () => {
    const none = await fakeApp({ muted: null }).checks.run();
    expect(none.find((result) => result.name.startsWith("Output muted"))?.ok).toBeNull();
    const mutedApp = fakeApp({ muted: true });
    const results = await mutedApp.checks.run();
    expect(results.find((result) => result.name.startsWith("Output muted"))?.ok).toBeNull();
    expect(failed(results)).toEqual([]);
    expect(mutedApp.muted()).toBe(true);
  });

  it("matches steps in order with others between", () => {
    expect(inOrder(["idle", "listening", "processing", "done"], ["listening", "done"])).toBe(true);
    expect(inOrder(["done", "listening"], ["listening", "done"])).toBe(false);
  });
});
