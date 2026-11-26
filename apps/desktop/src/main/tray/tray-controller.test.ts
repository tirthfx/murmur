import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CONNECTOR_SETTINGS,
  DEFAULT_MCP_SETTINGS,
  DEFAULT_EXTENSIONS_SETTINGS,
  DEFAULT_NOTETAKER,
  DEFAULT_SOUNDS,
  type AudioDevice,
  type RecordingState,
  type Settings,
} from "@murmur/shared";
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
    sounds: DEFAULT_SOUNDS,
    muteWhileDictating: false,
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

describe("tray meeting recording", () => {
  it("starts a meeting, then shows its time with a way to stop it", () => {
    let meeting: RecordingState = { status: "idle" };
    const startMeeting = vi.fn();
    const stopMeeting = vi.fn();
    const clock = new FakeClock();
    const views: TrayView[] = [];
    const tray = createTrayController({
      host: { render: (view) => views.push(view) },
      clock,
      logger: createTestLogger(),
      settings: () => setup().settings(),
      updateSettings: () => {},
      listDevices: async () => [],
      lastTranscript: () => null,
      toggleDictation: () => {},
      canRetry: () => false,
      retryLast: () => {},
      snoozeReminder: () => {},
      copy: () => {},
      quit: () => {},
      meetingState: () => meeting,
      startMeeting,
      stopMeeting,
    });
    const find = (label: string) =>
      tray.view().items.find((item) => item.kind === "item" && item.label === label);
    const start = find("Record a meeting");
    expect(start).toMatchObject({ enabled: true, action: { type: "meeting-start" } });
    tray.perform({ type: "meeting-start" });
    expect(startMeeting).toHaveBeenCalledOnce();

    meeting = {
      status: "recording",
      meetingId: "m",
      title: "Meeting",
      startedAt: clock.now() - 125_000,
      channels: ["mic", "system"],
      warnings: [],
    };
    const view = tray.view();
    expect(view.status).toBe("meeting");
    expect(view.elapsed).toBe("2:05");
    expect(view.tooltip).toBe("Murmur: recording a meeting");
    expect(find("Recording a meeting: 2:05")).toMatchObject({ enabled: false });
    expect(find("Stop recording the meeting")).toMatchObject({ action: { type: "meeting-stop" } });
    tray.perform({ type: "meeting-stop" });
    expect(stopMeeting).toHaveBeenCalledOnce();

    meeting = { status: "starting" };
    expect(find("Record a meeting")).toMatchObject({ enabled: false });
  });
});

describe("tray next meeting (NT-29)", () => {
  function make(
    next: ReturnType<NonNullable<Parameters<typeof createTrayController>[0]["nextMeeting"]>>,
    recording = false,
  ) {
    const join = vi.fn();
    const recordEvent = vi.fn();
    const openBrief = vi.fn();
    const state: { next: typeof next } = { next };
    const tray = createTrayController({
      host: { render: () => {} },
      clock: new FakeClock(),
      logger: createTestLogger(),
      settings: () => setup().settings(),
      updateSettings: () => {},
      listDevices: async () => [],
      lastTranscript: () => null,
      toggleDictation: () => {},
      canRetry: () => false,
      retryLast: () => {},
      snoozeReminder: () => {},
      copy: () => {},
      quit: () => {},
      meetingState: () =>
        recording
          ? {
              status: "recording",
              meetingId: "m",
              title: "M",
              startedAt: 0,
              channels: ["mic"],
              warnings: [],
            }
          : { status: "idle" },
      nextMeeting: () => state.next,
      joinMeeting: join,
      recordEvent,
      openBrief,
    });
    const labels = () =>
      tray.view().items.flatMap((item) => (item.kind === "item" ? [item.label] : []));
    return { tray, join, recordEvent, openBrief, state, labels };
  }
  const NEXT = {
    eventId: "e1",
    title: "Design sync",
    when: "in 12 min",
    hasLink: true,
    text: "Design sync in 12 min",
  };

  it("shows the next meeting next to the icon and in the menu, with join and record", () => {
    const t = make(NEXT);
    expect(t.tray.view().nextText).toBe("Design sync in 12 min");
    expect(t.labels()).toContain("Next: Design sync, in 12 min");
    expect(t.labels()).toContain("Join the meeting");
    expect(t.labels()).toContain("Record this meeting");
    t.tray.perform({ type: "meeting-join", eventId: "e1" });
    t.tray.perform({ type: "meeting-record-event", eventId: "e1" });
    expect(t.join).toHaveBeenCalledWith("e1");
    expect(t.recordEvent).toHaveBeenCalledWith("e1");
  });

  it("offers to open the brief only when one has been built (NT-11)", () => {
    const without = make(NEXT);
    expect(without.labels()).not.toContain("Open the brief");
    const t = make({ ...NEXT, hasBrief: true });
    expect(t.labels()).toContain("Open the brief");
    t.tray.perform({ type: "meeting-brief", eventId: "e1" });
    expect(t.openBrief).toHaveBeenCalledWith("e1");
  });

  it("has no join for a meeting with no link, and updates when the next meeting changes or goes", () => {
    const t = make({ ...NEXT, hasLink: false });
    expect(t.labels()).not.toContain("Join the meeting");
    t.state.next = null;
    expect(t.tray.view().nextText).toBeUndefined();
    expect(t.labels().some((label) => label.startsWith("Next:"))).toBe(false);
  });

  it("shows the recording instead while a meeting records", () => {
    const t = make(NEXT, true);
    expect(t.tray.view().nextText).toBeUndefined();
    expect(t.tray.view().elapsed).toBeDefined();
    expect(t.labels().some((label) => label.startsWith("Next:"))).toBe(false);
  });

  it("changes nothing when there is no calendar", () => {
    const t = make(null);
    expect(t.tray.view().nextText).toBeUndefined();
    expect(t.labels().some((label) => label.startsWith("Next:"))).toBe(false);
  });
});

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
