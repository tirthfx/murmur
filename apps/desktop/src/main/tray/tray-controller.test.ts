import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SOUNDS, type AudioDevice, type Settings } from "@murmur/shared";
import { FakeClock, createTestLogger } from "../helper/fakes";
import { createTrayController, WARNING_MS, type TrayView } from "./tray-controller";
import type { TrayItem } from "./tray-menu";

const desk: AudioDevice = {
  id: "desk",
  name: "Desk Mic",
  isDefault: true,
  transport: "usb",
  sampleRate: 48000,
};

function setup() {
  let settings: Settings = {
    holdShortcut: { type: "key", keyCode: 61, modifiers: [] },
    handsFreeShortcut: null,
    inputDevice: "auto",
    languages: [],
    cleanupLevel: "standard",
    sounds: DEFAULT_SOUNDS,
    muteWhileDictating: false,
    setupComplete: true,
    pressEnterCommand: true,
    contextAwareness: true,
    mouseButtons: { hold: null, handsFree: null },
    typingReminder: { enabled: true, snoozedUntil: null },
    whisperMode: false,
    memory: { enabled: true, fromDictation: true },
    experimental: {
      splitMessages: false,
      pauseMedia: false,
      headsetWear: false,
      ringMicrophone: false,
    },
  };
  const views: TrayView[] = [];
  const clock = new FakeClock();
  const state = { devices: [desk] as AudioDevice[] | Error, last: null as string | null };
  const deps = {
    toggleDictation: vi.fn(),
    snoozeReminder: vi.fn(),
    canRetry: vi.fn(() => false),
    retryLast: vi.fn(),
    copy: vi.fn(),
    quit: vi.fn(),
  };
  const controller = createTrayController({
    host: { render: (view) => views.push(view) },
    clock,
    logger: createTestLogger(),
    settings: () => settings,
    updateSettings: (patch) => {
      settings = { ...settings, ...patch } as Settings;
    },
    listDevices: async () => {
      if (state.devices instanceof Error) throw state.devices;
      return state.devices;
    },
    lastTranscript: () => state.last,
    ...deps,
  });
  const labels = (items: TrayItem[]) =>
    items.flatMap((item) => (item.kind === "item" ? [item.label] : []));
  return { controller, views, clock, state, deps, labels, settings: () => settings };
}

describe("tray controller", () => {
  it("follows a dictation: label and status", () => {
    const { controller, views, labels } = setup();
    controller.handleRecorderEvent({ type: "started", at: 1 });
    expect(views.at(-1)!.status).toBe("listening");
    expect(labels(views.at(-1)!.items)[0]).toBe("Stop dictation");
    controller.handleRecorderEvent({ type: "stopped" });
    expect(views.at(-1)!.status).toBe("idle");
    expect(labels(views.at(-1)!.items)[0]).toBe("Start dictation");
  });

  it("redraws in the same turn as the event", () => {
    const { controller, views } = setup();
    controller.handleRecorderEvent({ type: "started", at: 1 });
    expect(views).toHaveLength(1);
  });

  it("shows a warning for a silent microphone while still listening first", () => {
    const { controller, views } = setup();
    controller.handleRecorderEvent({ type: "started", at: 1 });
    controller.handleRecorderEvent({ type: "silent-mic", deviceName: "Desk Mic" });
    expect(views.at(-1)!.status).toBe("listening");
    controller.handleRecorderEvent({ type: "stopped" });
    expect(views.at(-1)!.status).toBe("warning");
  });

  it("shows a warning after a failed session and clears it after a while", async () => {
    const { controller, views, clock } = setup();
    controller.handleRecorderEvent({ type: "started", at: 1 });
    controller.handleRecorderEvent({ type: "stopped" });
    controller.handleRecorderEvent({ type: "transcription-failed" });
    expect(views.at(-1)!.status).toBe("warning");
    await clock.advance(WARNING_MS);
    expect(views.at(-1)!.status).toBe("idle");
  });

  it("clears the warning when the next dictation starts", () => {
    const { controller, views } = setup();
    controller.handleRecorderEvent({ type: "start-failed", message: "no mic" });
    expect(views.at(-1)!.status).toBe("warning");
    controller.handleRecorderEvent({ type: "started", at: 2 });
    expect(views.at(-1)!.status).toBe("listening");
  });

  it("forgets the recording when the helper stops", () => {
    const { controller, views } = setup();
    controller.handleRecorderEvent({ type: "started", at: 1 });
    controller.handleHelperDown();
    expect(views.at(-1)!.status).toBe("idle");
  });

  it("redraws when the microphone list changes, and only then", async () => {
    const { controller, views, state } = setup();
    await controller.refreshDevices();
    expect(views).toHaveLength(1);
    await controller.refreshDevices();
    expect(views).toHaveLength(1);
    state.devices = [desk, { ...desk, id: "usb-2", name: "Second Mic" }];
    await controller.refreshDevices();
    expect(views).toHaveLength(2);
    state.devices = new Error("helper down");
    await controller.refreshDevices();
    expect(views).toHaveLength(3);
  });

  it("performs each action", () => {
    const { controller, deps, state, settings } = setup();
    controller.perform({ type: "toggle" });
    expect(deps.toggleDictation).toHaveBeenCalledOnce();
    controller.perform({ type: "device", id: "desk" });
    expect(settings().inputDevice).toBe("desk");
    controller.perform({ type: "language", code: "hi" });
    expect(settings().languages).toEqual(["hi"]);
    controller.perform({ type: "language", code: "en" });
    expect(settings().languages).toEqual(["en", "hi"]);
    controller.perform({ type: "language", code: "auto" });
    expect(settings().languages).toEqual([]);
    controller.perform({ type: "copy-last" });
    expect(deps.copy).not.toHaveBeenCalled();
    state.last = "Hello there.";
    controller.perform({ type: "copy-last" });
    expect(deps.copy).toHaveBeenCalledWith("Hello there.");
    controller.perform({ type: "retry-last" });
    expect(deps.retryLast).toHaveBeenCalledOnce();
    controller.perform({ type: "reminder", choice: "hour" });
    expect(deps.snoozeReminder).toHaveBeenCalledWith("hour");
    controller.perform({ type: "quit" });
    expect(deps.quit).toHaveBeenCalledOnce();
  });
});
