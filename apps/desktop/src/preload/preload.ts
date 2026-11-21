import { contextBridge, ipcRenderer } from "electron";
import {
  DICTATION_STATES,
  IPC_CHANNELS,
  IPC_EVENTS,
  type DictationState,
  type LivePartial,
  type MurmurApi,
} from "@murmur/shared";

// Only this narrow, typed surface reaches the renderer. ipcRenderer itself is never exposed.
const api: MurmurApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  reportProblem: () => ipcRenderer.invoke(IPC_CHANNELS.reportProblem),
  testingTool: (tool) => ipcRenderer.invoke(IPC_CHANNELS.testingTool, tool),
  axInspect: (showValues) => ipcRenderer.invoke(IPC_CHANNELS.axInspect, showValues),
  planView: () => ipcRenderer.invoke(IPC_CHANNELS.planView),
  planAct: (action) => ipcRenderer.invoke(IPC_CHANNELS.planAct, action),
  dataExport: (request) => ipcRenderer.invoke(IPC_CHANNELS.dataExport, request),
  dataCounts: () => ipcRenderer.invoke(IPC_CHANNELS.dataCounts),
  dataDelete: (category) => ipcRenderer.invoke(IPC_CHANNELS.dataDelete, category),
  dataReset: (request) => ipcRenderer.invoke(IPC_CHANNELS.dataReset, request),
  dataRetryFailed: () => ipcRenderer.invoke(IPC_CHANNELS.dataRetryFailed),
  storageView: () => ipcRenderer.invoke(IPC_CHANNELS.storageView),
  storageOpen: () => ipcRenderer.invoke(IPC_CHANNELS.storageOpen),
  retentionView: () => ipcRenderer.invoke(IPC_CHANNELS.retentionView),
  retentionRun: () => ipcRenderer.invoke(IPC_CHANNELS.retentionRun),
  notesList: (query) => ipcRenderer.invoke(IPC_CHANNELS.notesList, query),
  noteGet: (id) => ipcRenderer.invoke(IPC_CHANNELS.noteGet, id),
  noteCreate: (input) => ipcRenderer.invoke(IPC_CHANNELS.noteCreate, input),
  noteSave: (input) => ipcRenderer.invoke(IPC_CHANNELS.noteSave, input),
  noteDelete: (id) => ipcRenderer.invoke(IPC_CHANNELS.noteDelete, id),
  noteVersions: (noteId) => ipcRenderer.invoke(IPC_CHANNELS.noteVersions, noteId),
  noteVersionSave: (input) => ipcRenderer.invoke(IPC_CHANNELS.noteVersionSave, input),
  noteVersionText: (id) => ipcRenderer.invoke(IPC_CHANNELS.noteVersionText, id),
  noteVersionRestore: (id) => ipcRenderer.invoke(IPC_CHANNELS.noteVersionRestore, id),
  notePin: (noteId, pinned) => ipcRenderer.invoke(IPC_CHANNELS.notePin, noteId, pinned),
  notePinMove: (noteId, step) => ipcRenderer.invoke(IPC_CHANNELS.notePinMove, noteId, step),
  noteRewrites: () => ipcRenderer.invoke(IPC_CHANNELS.noteRewrites),
  noteRewriteRun: (input) => ipcRenderer.invoke(IPC_CHANNELS.noteRewriteRun, input),
  noteRewriteRecord: (input) => ipcRenderer.invoke(IPC_CHANNELS.noteRewriteRecord, input),
  noteExport: (input) => ipcRenderer.invoke(IPC_CHANNELS.noteExport, input),
  noteImport: (input) => ipcRenderer.invoke(IPC_CHANNELS.noteImport, input),
  noteImageAdd: (input) => ipcRenderer.invoke(IPC_CHANNELS.noteImageAdd, input),
  noteImageData: (id) => ipcRenderer.invoke(IPC_CHANNELS.noteImageData, id),
  scratchpadOpen: (noteId) => ipcRenderer.invoke(IPC_CHANNELS.scratchpadOpen, noteId),
  onScratchpadOpenNote: (handler) => {
    const listener = (_event: unknown, noteId: unknown) => {
      if (typeof noteId === "string" && /^[\w-]{1,64}$/.test(noteId)) handler(noteId);
    };
    ipcRenderer.on(IPC_EVENTS.scratchpadOpenNote, listener);
    return () => ipcRenderer.removeListener(IPC_EVENTS.scratchpadOpenNote, listener);
  },
  homeView: () => ipcRenderer.invoke(IPC_CHANNELS.homeView),
  historyRetry: (id) => ipcRenderer.invoke(IPC_CHANNELS.historyRetry, id),
  dictationState: () => ipcRenderer.invoke(IPC_CHANNELS.dictationState),
  onDictationState: (handler) => {
    const listener = (_event: unknown, state: unknown) => {
      if (typeof state === "string" && (DICTATION_STATES as readonly string[]).includes(state)) {
        handler(state as DictationState);
      }
    };
    ipcRenderer.on(IPC_EVENTS.dictationState, listener);
    return () => ipcRenderer.removeListener(IPC_EVENTS.dictationState, listener);
  },
  milestonesList: () => ipcRenderer.invoke(IPC_CHANNELS.milestonesList),
  milestonesSeen: () => ipcRenderer.invoke(IPC_CHANNELS.milestonesSeen),
  progressCardSave: (png) => ipcRenderer.invoke(IPC_CHANNELS.progressCardSave, png),
  progressCardCopy: (png) => ipcRenderer.invoke(IPC_CHANNELS.progressCardCopy, png),
  insightsView: (range) => ipcRenderer.invoke(IPC_CHANNELS.insightsView, range),
  insightsExport: (range) => ipcRenderer.invoke(IPC_CHANNELS.insightsExport, range),
  historyPage: (query) => ipcRenderer.invoke(IPC_CHANNELS.historyPage, query),
  historyArchive: (ids, archived) => ipcRenderer.invoke(IPC_CHANNELS.historyArchive, ids, archived),
  historyFeedback: (input) => ipcRenderer.invoke(IPC_CHANNELS.historyFeedback, input),
  historyDelete: (ids) => ipcRenderer.invoke(IPC_CHANNELS.historyDelete, ids),
  loginItemGet: () => ipcRenderer.invoke(IPC_CHANNELS.loginItemGet),
  loginItemSet: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.loginItemSet, enabled),
  hubSetPage: (pageId) => ipcRenderer.invoke(IPC_CHANNELS.hubSetPage, pageId),
  getHelperStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getHelperStatus),
  getPermissions: () => ipcRenderer.invoke(IPC_CHANNELS.getPermissions),
  requestPermission: (kind) => ipcRenderer.invoke(IPC_CHANNELS.requestPermission, kind),
  openPermissionSettings: (kind) => ipcRenderer.invoke(IPC_CHANNELS.openPermissionSettings, kind),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, patch),
  setShortcut: (slot, key) => ipcRenderer.invoke(IPC_CHANNELS.setShortcut, slot, key),
  captureShortcut: (active) => ipcRenderer.invoke(IPC_CHANNELS.captureShortcut, active),
  getSetupStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getSetupStatus),
  downloadSpeechModel: () => ipcRenderer.invoke(IPC_CHANNELS.downloadSpeechModel),
  micCheckStart: () => ipcRenderer.invoke(IPC_CHANNELS.micCheckStart),
  micCheckStop: () => ipcRenderer.invoke(IPC_CHANNELS.micCheckStop),
  getMediaPlayback: () => ipcRenderer.invoke(IPC_CHANNELS.getMediaPlayback),
  dictionaryList: () => ipcRenderer.invoke(IPC_CHANNELS.dictionaryList),
  dictionarySave: (input) => ipcRenderer.invoke(IPC_CHANNELS.dictionarySave, input),
  dictionaryDelete: (id) => ipcRenderer.invoke(IPC_CHANNELS.dictionaryDelete, id),
  dictionaryKeep: (id) => ipcRenderer.invoke(IPC_CHANNELS.dictionaryKeep, id),
  dictionaryClipStart: (id) => ipcRenderer.invoke(IPC_CHANNELS.dictionaryClipStart, id),
  dictionaryClipStop: () => ipcRenderer.invoke(IPC_CHANNELS.dictionaryClipStop),
  dictionaryClipPlay: (id) => ipcRenderer.invoke(IPC_CHANNELS.dictionaryClipPlay, id),
  dictionaryClipDelete: (id) => ipcRenderer.invoke(IPC_CHANNELS.dictionaryClipDelete, id),
  snippetsList: () => ipcRenderer.invoke(IPC_CHANNELS.snippetsList),
  snippetsSave: (input) => ipcRenderer.invoke(IPC_CHANNELS.snippetsSave, input),
  snippetsDelete: (id) => ipcRenderer.invoke(IPC_CHANNELS.snippetsDelete, id),
  stylesView: () => ipcRenderer.invoke(IPC_CHANNELS.stylesView),
  stylesUpdate: (update) => ipcRenderer.invoke(IPC_CHANNELS.stylesUpdate, update),
  stylesSetOverride: (override) => ipcRenderer.invoke(IPC_CHANNELS.stylesSetOverride, override),
  stylesClearOverride: (bundleId) => ipcRenderer.invoke(IPC_CHANNELS.stylesClearOverride, bundleId),
  memoryList: () => ipcRenderer.invoke(IPC_CHANNELS.memoryList),
  memorySave: (input) => ipcRenderer.invoke(IPC_CHANNELS.memorySave, input),
  memoryDelete: (id) => ipcRenderer.invoke(IPC_CHANNELS.memoryDelete, id),
  rewritesList: () => ipcRenderer.invoke(IPC_CHANNELS.rewritesList),
  rewritesSave: (input) => ipcRenderer.invoke(IPC_CHANNELS.rewritesSave, input),
  rewritesSetEnabled: (id, enabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.rewritesSetEnabled, id, enabled),
  rewritesMove: (id, step) => ipcRenderer.invoke(IPC_CHANNELS.rewritesMove, id, step),
  rewritesDuplicate: (id) => ipcRenderer.invoke(IPC_CHANNELS.rewritesDuplicate, id),
  rewritesDelete: (id) => ipcRenderer.invoke(IPC_CHANNELS.rewritesDelete, id),
  rewritesSetShortcut: (id, key) => ipcRenderer.invoke(IPC_CHANNELS.rewritesSetShortcut, id, key),
  rewritesSetAutoApply: (id, settings) =>
    ipcRenderer.invoke(IPC_CHANNELS.rewritesSetAutoApply, id, settings),
  instructThreads: (query) => ipcRenderer.invoke(IPC_CHANNELS.instructThreads, query),
  instructThread: (id) => ipcRenderer.invoke(IPC_CHANNELS.instructThread, id),
  instructDelete: (id) => ipcRenderer.invoke(IPC_CHANNELS.instructDelete, id),
  instructDeleteAll: () => ipcRenderer.invoke(IPC_CHANNELS.instructDeleteAll),
  instructReuse: (id) => ipcRenderer.invoke(IPC_CHANNELS.instructReuse, id),
  instructModelStatus: () => ipcRenderer.invoke(IPC_CHANNELS.instructModelStatus),
  instructModelDownload: () => ipcRenderer.invoke(IPC_CHANNELS.instructModelDownload),
  instructModelRemove: () => ipcRenderer.invoke(IPC_CHANNELS.instructModelRemove),
  focusState: () => ipcRenderer.invoke(IPC_CHANNELS.focusState),
  focusStart: (duration) => ipcRenderer.invoke(IPC_CHANNELS.focusStart, duration),
  focusStop: () => ipcRenderer.invoke(IPC_CHANNELS.focusStop),
  focusApps: () => ipcRenderer.invoke(IPC_CHANNELS.focusApps),
  focusAddApp: (input) => ipcRenderer.invoke(IPC_CHANNELS.focusAddApp, input),
  focusRemoveApp: (id) => ipcRenderer.invoke(IPC_CHANNELS.focusRemoveApp, id),
  focusInstalledApps: () => ipcRenderer.invoke(IPC_CHANNELS.focusInstalledApps),
  focusSites: () => ipcRenderer.invoke(IPC_CHANNELS.focusSites),
  focusAddSite: (input) => ipcRenderer.invoke(IPC_CHANNELS.focusAddSite, input),
  rewritesSetApplyDirectly: (id, applyDirectly) =>
    ipcRenderer.invoke(IPC_CHANNELS.rewritesSetApplyDirectly, id, applyDirectly),
  importPreview: (request) => ipcRenderer.invoke(IPC_CHANNELS.importPreview, request),
  importApply: (request) => ipcRenderer.invoke(IPC_CHANNELS.importApply, request),
  voiceProfileView: () => ipcRenderer.invoke(IPC_CHANNELS.voiceProfileView),
  voiceProfileReset: () => ipcRenderer.invoke(IPC_CHANNELS.voiceProfileReset),
  writingSamplesList: () => ipcRenderer.invoke(IPC_CHANNELS.writingSamplesList),
  writingSamplesSave: (input) => ipcRenderer.invoke(IPC_CHANNELS.writingSamplesSave, input),
  writingSamplesDelete: (id) => ipcRenderer.invoke(IPC_CHANNELS.writingSamplesDelete, id),
  meetingsList: () => ipcRenderer.invoke(IPC_CHANNELS.meetingsList),
  meetingDetail: (id) => ipcRenderer.invoke(IPC_CHANNELS.meetingDetail, id),
  meetingRecording: () => ipcRenderer.invoke(IPC_CHANNELS.meetingRecording),
  meetingStart: () => ipcRenderer.invoke(IPC_CHANNELS.meetingStart),
  meetingStop: () => ipcRenderer.invoke(IPC_CHANNELS.meetingStop),
  meetingRename: (id, title) => ipcRenderer.invoke(IPC_CHANNELS.meetingRename, id, title),
  meetingDelete: (id) => ipcRenderer.invoke(IPC_CHANNELS.meetingDelete, id),
  meetingNotesSave: (id, body) => ipcRenderer.invoke(IPC_CHANNELS.meetingNotesSave, id, body),
  meetingDocAddLink: (id, url, title) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetingDocAddLink, id, url, title),
  meetingDocAddFile: (id) => ipcRenderer.invoke(IPC_CHANNELS.meetingDocAddFile, id),
  meetingDocOpen: (docId) => ipcRenderer.invoke(IPC_CHANNELS.meetingDocOpen, docId),
  meetingDocRemove: (docId) => ipcRenderer.invoke(IPC_CHANNELS.meetingDocRemove, docId),
  onMeetingsChanged: (handler) => {
    const listener = (_event: unknown, meetingId: unknown) => {
      if (meetingId === null || (typeof meetingId === "string" && meetingId.length <= 64)) {
        handler(meetingId);
      }
    };
    ipcRenderer.on(IPC_EVENTS.meetingsChanged, listener);
    return () => ipcRenderer.removeListener(IPC_EVENTS.meetingsChanged, listener);
  },
  onMeetingLive: (handler) => {
    const listener = (_event: unknown, partial: unknown) => {
      if (partial && typeof partial === "object") handler(partial as LivePartial);
    };
    ipcRenderer.on(IPC_EVENTS.meetingLive, listener);
    return () => ipcRenderer.removeListener(IPC_EVENTS.meetingLive, listener);
  },
  onOpenPage: (handler) => {
    const listener = (_event: unknown, pageId: unknown) => {
      if (typeof pageId === "string" && /^[a-z-]{1,40}$/.test(pageId)) handler(pageId);
    };
    ipcRenderer.on(IPC_EVENTS.openPage, listener);
    return () => ipcRenderer.removeListener(IPC_EVENTS.openPage, listener);
  },
  onMicCheckLevel: (handler) => {
    // Only a number crosses over; the event object stays in the preload.
    const listener = (_event: unknown, rmsDb: unknown) => {
      if (typeof rmsDb === "number") handler(rmsDb);
    };
    ipcRenderer.on(IPC_EVENTS.micCheckLevel, listener);
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.micCheckLevel, listener);
    };
  },
};

contextBridge.exposeInMainWorld("murmur", api);
