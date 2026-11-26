import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@murmur/shared";
import { createIpcHandler } from "./ipc";
import { SAMPLE_SETTINGS, SAMPLE_SETUP } from "../renderer/hub/test-api";

const entryUrl = "file:///app/.vite/renderer/main_window/index.html";
/** Whether the pretend app is locked (team mode). */
let lockedNow = false;
const info = { name: "Murmur", version: "0.0.0", platform: "darwin" };
const helperStatus = { state: "ready", helperVersion: "0.1.0", message: null } as const;

function setup() {
  const getAppInfo = vi.fn(() => info);
  const getHelperStatus = vi.fn(() => helperStatus);
  const permissionsInfo = {
    statuses: {
      microphone: "granted",
      accessibility: "denied",
      inputMonitoring: "not_determined",
      screenRecording: "unknown",
    },
    message: null,
  } as const;
  const getPermissions = vi.fn(() => Promise.resolve(permissionsInfo));
  const requestPermission = vi.fn(() => Promise.resolve(permissionsInfo));
  const openPermissionSettings = vi.fn(() => Promise.resolve());
  const getSettings = vi.fn(() => Promise.resolve(SAMPLE_SETTINGS));
  const updateSettings = vi.fn(() => Promise.resolve(SAMPLE_SETTINGS));
  const setShortcut = vi.fn(() => Promise.resolve({ ok: true as const, view: SAMPLE_SETTINGS }));
  const captureShortcut = vi.fn();
  const getSetupStatus = vi.fn(() => Promise.resolve(SAMPLE_SETUP));
  const downloadSpeechModel = vi.fn(() => Promise.resolve(SAMPLE_SETUP));
  const micCheckStart = vi.fn(() => Promise.resolve({ ok: true as const, deviceName: "Desk Mic" }));
  const micCheckStop = vi.fn(() => Promise.resolve(null));
  const getMediaPlayback = vi.fn(() => Promise.resolve(null));
  const handle = createIpcHandler({
    entryUrl,
    hubSetPage: vi.fn(),
    reportProblem: vi.fn(() => Promise.resolve({ ok: true, message: "" })),
    testingTool: vi.fn(() => Promise.resolve({ ok: true, message: "" })),
    axInspect: vi.fn(() => Promise.resolve(null)),
    planView: vi.fn(),
    planAct: vi.fn(),
    dataExport: vi.fn(() => Promise.resolve({ ok: false as const, message: "no", canceled: true })),
    dataCounts: vi.fn(() => ({ categories: [], failedFiles: 0 })),
    dataDelete: vi.fn(() => ({ rows: 0, files: 0, failedFiles: 0 })),
    dataReset: vi.fn(() => Promise.resolve({ rows: 0, files: 0, failedFiles: 0 })),
    dataRetryFailed: vi.fn(() => 0),
    storageView: vi.fn(() => ({ folder: "/x", parts: [] })),
    storageOpen: vi.fn(),
    retentionView: vi.fn(() => ({ lastRunAt: null, nextRunAt: null, removed: {} })),
    retentionRun: vi.fn(() => ({ lastRunAt: 1, nextRunAt: 2, removed: {} })),
    notesList: vi.fn(() => []),
    meetingsList: vi.fn(() => []),
    meetingDetail: vi.fn(() => null),
    meetingRecording: vi.fn(() => ({ status: "idle" as const })),
    meetingStart: vi.fn(async () => ({ ok: true as const, meetingId: "m" })),
    meetingStop: vi.fn(async () => {}),
    meetingRename: vi.fn(),
    meetingSummarize: vi.fn(),
    meetingSummaryFeedback: vi.fn(),
    skillsList: vi.fn(),
    skillSave: vi.fn(),
    skillDuplicate: vi.fn(),
    skillDelete: vi.fn(),
    skillVersions: vi.fn(),
    skillRestore: vi.fn(),
    skillExport: vi.fn(),
    skillImport: vi.fn(),
    tasksList: vi.fn(),
    taskAdd: vi.fn(),
    taskUpdate: vi.fn(),
    taskAction: vi.fn(),
    taskReorder: vi.fn(),
    tasksUndo: vi.fn(),
    meetingFindTasks: vi.fn(),
    askThreads: vi.fn(),
    askThread: vi.fn(),
    askSend: vi.fn(),
    askDelete: vi.fn(),
    meetingSpeakerRename: vi.fn(),
    meetingSpeakerClip: vi.fn(),
    meetingCorrect: vi.fn(),
    meetingSetLanguage: vi.fn(),
    foldersList: vi.fn(),
    folderCreate: vi.fn(),
    folderRename: vi.fn(),
    folderDelete: vi.fn(),
    folderUpdate: vi.fn(),
    folderChooseExport: vi.fn(),
    folderClearExport: vi.fn(),
    connectorsView: vi.fn(),
    connectorSync: vi.fn(),
    connectorOptions: vi.fn(),
    connectorConnectKey: vi.fn(),
    connectorRecordings: vi.fn(),
    connectorImportPrepare: vi.fn(),
    connectorDataStatus: vi.fn(),
    askActionPropose: vi.fn(),
    slackPostState: vi.fn(),
    slackPostStart: vi.fn(),
    slackPostPrepare: vi.fn(),
    slackPostSend: vi.fn(),
    extensionsView: vi.fn(),
    isLocked: () => lockedNow,
    policyView: vi.fn(),
    teamView: vi.fn(),
    teamConnect: vi.fn(),
    teamSetup: vi.fn(),
    teamSignIn: vi.fn(),
    teamSignOut: vi.fn(),
    teamLock: vi.fn(),
    teamUnlock: vi.fn(),
    teamRedeem: vi.fn(),
    teamSyncNow: vi.fn(),
    teamSetIdleLock: vi.fn(),
    teamDisconnect: vi.fn(),
    teamNoticesSeen: vi.fn(),
    teamOpenAdmin: vi.fn(),
    teamPropose: vi.fn(),
    teamChangePassword: vi.fn(),
    teamPeople: vi.fn(),
    teamFolderCreate: vi.fn(),
    teamNoteRead: vi.fn(),
    teamSkillAdd: vi.fn(),
    teamShareMeeting: vi.fn(),
    briefOverview: vi.fn(),
    briefGet: vi.fn(),
    briefBuild: vi.fn(),
    briefForMeeting: vi.fn(),
    briefOpen: vi.fn(),
    briefTarget: vi.fn(),
    emailDraftState: vi.fn(),
    emailDraftPropose: vi.fn(),
    emailDraftCreate: vi.fn(),
    emailDraftList: vi.fn(),
    emailDraftOpen: vi.fn(),
    calendarEventState: vi.fn(),
    calendarEventPropose: vi.fn(),
    calendarEventCreate: vi.fn(),
    calendarEventList: vi.fn(),
    calendarEventOpen: vi.fn(),
    mcpStatus: vi.fn(),
    mcpClients: vi.fn(),
    mcpIssue: vi.fn(),
    mcpRotate: vi.fn(),
    mcpRevoke: vi.fn(),
    mcpCopyToken: vi.fn(),
    mcpConfigPreview: vi.fn(),
    mcpConfigWrite: vi.fn(),
    mcpAudit: vi.fn(),
    mcpAuditClear: vi.fn(),
    connectorConnect: vi.fn(),
    connectorCancel: vi.fn(),
    connectorDisconnect: vi.fn(),
    connectorSetEnabled: vi.fn(),
    connectorSetClientId: vi.fn(),
    connectorSetClientSecret: vi.fn(),
    meetingMove: vi.fn(),
    meetingFolderDismiss: vi.fn(),
    meetingExport: vi.fn(),
    meetingRetentionDue: vi.fn(),
    meetingImportPreview: vi.fn(),
    meetingRecap: vi.fn(),
    meetingImportConfirm: vi.fn(),
    meetingImportCancel: vi.fn(),
    meetingRerun: vi.fn(),
    meetingVersionRestore: vi.fn(),
    meetingSegmentHistory: vi.fn(),
    meetingCorrectionRevert: vi.fn(),
    meetingDelete: vi.fn(),
    meetingNotesSave: vi.fn(() => true),
    meetingDocAddLink: vi.fn(() => ({ ok: false as const, message: "x" })),
    meetingDocAddFile: vi.fn(async () => ({ ok: false as const, message: "x" })),
    meetingDocOpen: vi.fn(async () => {}),
    meetingDocRemove: vi.fn(),
    noteGet: vi.fn(() => null),
    noteCreate: vi.fn(() => ({ ok: false as const, message: "no" })),
    noteSave: vi.fn(() => ({ ok: true as const, updatedAt: 1 })),
    noteDelete: vi.fn(),
    scratchpadOpen: vi.fn(),
    noteVersions: vi.fn(() => []),
    noteVersionSave: vi.fn(() => null),
    noteVersionText: vi.fn(() => null),
    noteVersionRestore: vi.fn(() => null),
    notePin: vi.fn(() => ({ ok: true as const })),
    notePinMove: vi.fn(),
    noteRewrites: vi.fn(() => []),
    noteRewriteRun: vi.fn(() => Promise.resolve({ ok: false as const, message: "no" })),
    noteRewriteRecord: vi.fn(),
    noteExport: vi.fn(() => Promise.resolve({ saved: false })),
    noteImport: vi.fn(() => ({ ok: false as const, message: "no" })),
    noteImageAdd: vi.fn(() => Promise.resolve({ ok: false as const, message: "no" })),
    noteImageData: vi.fn(() => null),
    homeView: vi.fn(),
    historyCopyAudioPath: vi.fn(),
    historyRetry: vi.fn(() => Promise.resolve({ ok: false as const, message: "no" })),
    dictationState: vi.fn(() => "idle" as const),
    milestonesList: vi.fn(() => []),
    milestonesSeen: vi.fn(),
    progressCardSave: vi.fn(() => Promise.resolve({ saved: false })),
    progressCardCopy: vi.fn(() => Promise.resolve()),
    insightsView: vi.fn(),
    insightsExport: vi.fn(() => Promise.resolve({ saved: false, rows: 0 })),
    historyPage: vi.fn(() => ({ rows: [], total: 0, apps: [], languages: [] })),
    historyArchive: vi.fn(() => 0),
    historyFeedback: vi.fn(),
    historyDelete: vi.fn(() => ({ rows: 0, files: 0 })),
    loginItemGet: vi.fn(() => ({ available: false, enabled: false })),
    loginItemSet: vi.fn(() => ({ available: false, enabled: false })),
    getAppInfo,
    getHelperStatus,
    getPermissions,
    requestPermission,
    openPermissionSettings,
    getSettings,
    updateSettings,
    resetShortcuts: vi.fn(),
    setShortcut,
    captureShortcut,
    getSetupStatus,
    downloadSpeechModel,
    micCheckStart,
    micCheckStop,
    getMediaPlayback,
    dictionaryList: vi.fn(() => []),
    dictionarySave: vi.fn(),
    dictionaryDelete: vi.fn(),
    dictionaryKeep: vi.fn(),
    dictionaryClipStart: vi.fn(async () => ({ ok: true as const, durationMs: 0 })),
    dictionaryClipStop: vi.fn(async () => ({ ok: true as const, durationMs: 1500 })),
    dictionaryClipPlay: vi.fn(async () => null),
    dictionaryClipDelete: vi.fn(async () => {}),
    snippetsList: vi.fn(() => []),
    snippetsSave: vi.fn(),
    snippetsDelete: vi.fn(),
    stylesView: vi.fn(() => ({ styles: [], overrides: [], recentApps: [] })),
    stylesUpdate: vi.fn(() => ({ styles: [], overrides: [], recentApps: [] })),
    stylesSetOverride: vi.fn(() => ({ styles: [], overrides: [], recentApps: [] })),
    stylesClearOverride: vi.fn(() => ({ styles: [], overrides: [], recentApps: [] })),
    memoryList: vi.fn(() => []),
    memorySave: vi.fn(),
    memoryDelete: vi.fn(),
    rewritesList: vi.fn(() => []),
    rewritesSave: vi.fn(),
    rewritesSetEnabled: vi.fn(),
    rewritesMove: vi.fn(),
    rewritesDuplicate: vi.fn(),
    rewritesDelete: vi.fn(() => null),
    rewritesSetShortcut: vi.fn(() => ({ ok: true as const })),
    rewritesSetApplyDirectly: vi.fn(),
    rewritesSetAutoApply: vi.fn(),
    instructThreads: vi.fn(() => []),
    instructThread: vi.fn(() => null),
    instructDelete: vi.fn(),
    instructDeleteAll: vi.fn(),
    instructReuse: vi.fn(() => true),
    instructModelStatus: vi.fn(),
    instructModelDownload: vi.fn(),
    instructModelRemove: vi.fn(),
    focusState: vi.fn(),
    focusStart: vi.fn(),
    focusStop: vi.fn(),
    focusApps: vi.fn(),
    focusAddApp: vi.fn(),
    focusRemoveApp: vi.fn(),
    focusInstalledApps: vi.fn(),
    focusSites: vi.fn(),
    focusAddSite: vi.fn(),
    importPreview: vi.fn(),
    importApply: vi.fn(),
    voiceProfileView: vi.fn(() => ({
      sessions: 0,
      totalWords: 0,
      measures: [],
      topPhrases: [],
      summary: null,
      milestones: [],
      examples: { personal: [], work: [], email: [], other: [] },
      passage: "",
    })),
    voiceProfileReset: vi.fn(() => ({
      sessions: 0,
      totalWords: 0,
      measures: [],
      topPhrases: [],
      summary: null,
      milestones: [],
      examples: { personal: [], work: [], email: [], other: [] },
      passage: "",
    })),
    writingSamplesList: vi.fn(() => []),
    writingSamplesSave: vi.fn(() => ({
      ok: false as const,
      reason: "full" as const,
      message: "Full",
    })),
    writingSamplesDelete: vi.fn(),
  });
  return {
    getSetupStatus,
    downloadSpeechModel,
    getSettings,
    updateSettings,
    setShortcut,
    captureShortcut,
    handle,
    getAppInfo,
    getHelperStatus,
    getPermissions,
    requestPermission,
    openPermissionSettings,
    permissionsInfo,
  };
}

describe("createIpcHandler", () => {
  it("returns app info to the app page", () => {
    const { handle } = setup();
    expect(handle(IPC_CHANNELS.getAppInfo, { senderFrame: { url: entryUrl } }, [])).toEqual(info);
  });

  it("returns the helper status to the app page", () => {
    const { handle } = setup();
    expect(handle(IPC_CHANNELS.getHelperStatus, { senderFrame: { url: entryUrl } }, [])).toEqual(
      helperStatus,
    );
  });

  it("rejects arguments on the helper status call and untrusted senders", () => {
    const { handle, getHelperStatus } = setup();
    expect(() =>
      handle(IPC_CHANNELS.getHelperStatus, { senderFrame: { url: entryUrl } }, ["x"]),
    ).toThrow(/invalid-args/);
    expect(() =>
      handle(IPC_CHANNELS.getHelperStatus, { senderFrame: { url: "https://example.com/" } }, []),
    ).toThrow(/untrusted sender/);
    expect(getHelperStatus).not.toHaveBeenCalled();
  });

  it("refuses meetings, notes' meetings, questions, briefs and tasks while locked, and keeps the rest and Stop working", () => {
    const { handle } = setup();
    const call = (channel: string, args: unknown[] = []) =>
      handle(channel, { senderFrame: { url: entryUrl } }, args);
    lockedNow = true;
    try {
      for (const channel of [
        IPC_CHANNELS.meetingsList,
        IPC_CHANNELS.meetingDetail,
        IPC_CHANNELS.askThreads,
        IPC_CHANNELS.briefOverview,
      ])
        expect(
          () => call(channel, channel === IPC_CHANNELS.meetingDetail ? ["m1"] : []),
          channel,
        ).toThrow(/locked/);
      // A recording in progress can still be stopped, and the lock screen itself can talk.
      expect(() => call(IPC_CHANNELS.meetingStop)).not.toThrow();
      expect(() => call(IPC_CHANNELS.teamUnlock, ["pw"])).not.toThrow();
      expect(() => call(IPC_CHANNELS.getAppInfo)).not.toThrow();
    } finally {
      lockedNow = false;
    }
    expect(() => call(IPC_CHANNELS.meetingsList)).not.toThrow();
  });

  it("rejects an unknown channel", () => {
    const { handle } = setup();
    expect(() => handle("app:nope", { senderFrame: { url: entryUrl } }, [])).toThrow(
      /unknown-channel/,
    );
  });

  it("rejects invalid arguments without running the implementation", () => {
    const { handle, getAppInfo } = setup();
    expect(() =>
      handle(IPC_CHANNELS.getAppInfo, { senderFrame: { url: entryUrl } }, ["extra"]),
    ).toThrow(/invalid-args/);
    expect(getAppInfo).not.toHaveBeenCalled();
  });

  it("rejects a sender that is not the app page", () => {
    const { handle, getAppInfo } = setup();
    expect(() =>
      handle(IPC_CHANNELS.getAppInfo, { senderFrame: { url: "https://example.com/" } }, []),
    ).toThrow(/untrusted sender/);
    expect(() => handle(IPC_CHANNELS.getAppInfo, {}, [])).toThrow(/untrusted sender/);
    expect(() => handle(IPC_CHANNELS.getAppInfo, { senderFrame: null }, [])).toThrow(
      /untrusted sender/,
    );
    expect(getAppInfo).not.toHaveBeenCalled();
  });
});

describe("permission channels", () => {
  const sender = { senderFrame: { url: entryUrl } };

  it("getPermissions returns the service result", async () => {
    const { handle, getPermissions, permissionsInfo } = setup();
    await expect(handle(IPC_CHANNELS.getPermissions, sender, [])).resolves.toEqual(permissionsInfo);
    expect(getPermissions).toHaveBeenCalledOnce();
  });

  it("requestPermission passes a requestable kind through", async () => {
    const { handle, requestPermission } = setup();
    await handle(IPC_CHANNELS.requestPermission, sender, ["accessibility"]);
    expect(requestPermission).toHaveBeenCalledExactlyOnceWith("accessibility");
  });

  it("requestPermission refuses Screen Recording and unknown kinds", () => {
    const { handle, requestPermission } = setup();
    for (const args of [["screenRecording"], ["camera"], [], [{}], ["microphone", "x"]]) {
      expect(() => handle(IPC_CHANNELS.requestPermission, sender, args)).toThrow(/invalid-args/);
    }
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("permission calls from an untrusted sender do nothing", () => {
    const { handle, getPermissions, requestPermission, openPermissionSettings } = setup();
    const evil = { senderFrame: { url: "https://example.com/" } };
    expect(() => handle(IPC_CHANNELS.getPermissions, evil, [])).toThrow(/untrusted sender/);
    expect(() => handle(IPC_CHANNELS.requestPermission, evil, ["microphone"])).toThrow(
      /untrusted sender/,
    );
    expect(() => handle(IPC_CHANNELS.openPermissionSettings, evil, ["microphone"])).toThrow(
      /untrusted sender/,
    );
    expect(getPermissions).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(openPermissionSettings).not.toHaveBeenCalled();
  });

  it("openPermissionSettings takes a permission kind, never a URL", async () => {
    const { handle, openPermissionSettings } = setup();
    await handle(IPC_CHANNELS.openPermissionSettings, sender, ["screenRecording"]);
    expect(openPermissionSettings).toHaveBeenCalledExactlyOnceWith("screenRecording");
    for (const arg of ["x-apple.systempreferences:com.apple.preference.security", "https://a.b"]) {
      expect(() => handle(IPC_CHANNELS.openPermissionSettings, sender, [arg])).toThrow(
        /invalid-args/,
      );
    }
    expect(openPermissionSettings).toHaveBeenCalledOnce();
  });
});

describe("settings IPC", () => {
  const sender = { senderFrame: { url: entryUrl } };

  it("reads, updates and sets shortcuts", async () => {
    const context = setup();
    await context.handle(IPC_CHANNELS.getSettings, sender, []);
    await context.handle(IPC_CHANNELS.updateSettings, sender, [{ languages: ["hi", "en"] }]);
    await context.handle(IPC_CHANNELS.setShortcut, sender, [
      "handsFree",
      { code: "KeyD", modifiers: ["control"] },
    ]);
    await context.handle(IPC_CHANNELS.setShortcut, sender, ["handsFree", null]);
    context.handle(IPC_CHANNELS.captureShortcut, sender, [true]);
    expect(context.updateSettings).toHaveBeenCalledWith({ languages: ["hi", "en"] });
    expect(context.setShortcut).toHaveBeenCalledWith("handsFree", {
      code: "KeyD",
      modifiers: ["control"],
    });
    expect(context.setShortcut).toHaveBeenCalledWith("handsFree", null);
    expect(context.captureShortcut).toHaveBeenCalledWith(true);
  });

  it("serves the setup status and starts the model download", async () => {
    const context = setup();
    expect(await context.handle(IPC_CHANNELS.getSetupStatus, sender, [])).toEqual(SAMPLE_SETUP);
    expect(await context.handle(IPC_CHANNELS.downloadSpeechModel, sender, [])).toEqual(
      SAMPLE_SETUP,
    );
    expect(context.downloadSpeechModel).toHaveBeenCalledOnce();
    expect(() => context.handle(IPC_CHANNELS.downloadSpeechModel, sender, ["x"])).toThrow(
      "invalid-args",
    );
  });

  it("refuses bad settings before they reach main", () => {
    const context = setup();
    expect(() =>
      context.handle(IPC_CHANNELS.updateSettings, sender, [{ languages: ["xx"] }]),
    ).toThrow("invalid-args");
    expect(() =>
      context.handle(IPC_CHANNELS.updateSettings, sender, [{ holdShortcut: {} }]),
    ).toThrow("invalid-args");
    expect(() =>
      context.handle(IPC_CHANNELS.setShortcut, sender, ["volume", { code: "KeyD", modifiers: [] }]),
    ).toThrow("invalid-args");
    expect(context.updateSettings).not.toHaveBeenCalled();
  });
});
