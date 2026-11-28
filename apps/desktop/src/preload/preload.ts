import { contextBridge, ipcRenderer } from "electron";
import {
  DICTATION_STATES,
  IPC_CHANNELS,
  IPC_EVENTS,
  type DictationState,
  type LivePartial,
  type MurmurApi,
  type CaptureLevel,
} from "@murmur/shared";

// Only this narrow, typed surface reaches the renderer. ipcRenderer itself is never exposed.
const api: MurmurApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  helperRetry: () => ipcRenderer.invoke(IPC_CHANNELS.helperRetry),
  openGuide: () => ipcRenderer.invoke(IPC_CHANNELS.openGuide),
  reportProblem: () => ipcRenderer.invoke(IPC_CHANNELS.reportProblem),
  testingTool: (tool) => ipcRenderer.invoke(IPC_CHANNELS.testingTool, tool),
  axInspect: (showValues) => ipcRenderer.invoke(IPC_CHANNELS.axInspect, showValues),
  planView: () => ipcRenderer.invoke(IPC_CHANNELS.planView),
  planAct: (action) => ipcRenderer.invoke(IPC_CHANNELS.planAct, action),
  dataExport: (request) => ipcRenderer.invoke(IPC_CHANNELS.dataExport, request),
  dataExportStatus: () => ipcRenderer.invoke(IPC_CHANNELS.dataExportStatus),
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
  historyCopyAudioPath: (id) => ipcRenderer.invoke(IPC_CHANNELS.historyCopyAudioPath, id),
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
  resetSettings: (keys) => ipcRenderer.invoke(IPC_CHANNELS.resetSettings, keys),
  resetShortcuts: (slot) => ipcRenderer.invoke(IPC_CHANNELS.resetShortcuts, slot),
  captureShortcut: (active) => ipcRenderer.invoke(IPC_CHANNELS.captureShortcut, active),
  getSetupStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getSetupStatus),
  modelsList: () => ipcRenderer.invoke(IPC_CHANNELS.modelsList),
  modelDownload: (id) => ipcRenderer.invoke(IPC_CHANNELS.modelDownload, id),
  modelCancel: (id) => ipcRenderer.invoke(IPC_CHANNELS.modelCancel, id),
  modelRemove: (id) => ipcRenderer.invoke(IPC_CHANNELS.modelRemove, id),
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
  meetingSummarize: (id, options) => ipcRenderer.invoke(IPC_CHANNELS.meetingSummarize, id, options),
  meetingSummaryFeedback: (summaryId, feedback) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetingSummaryFeedback, summaryId, feedback),
  skillsList: () => ipcRenderer.invoke(IPC_CHANNELS.skillsList),
  skillSave: (id, draft) => ipcRenderer.invoke(IPC_CHANNELS.skillSave, id, draft),
  skillDuplicate: (id) => ipcRenderer.invoke(IPC_CHANNELS.skillDuplicate, id),
  skillDelete: (id) => ipcRenderer.invoke(IPC_CHANNELS.skillDelete, id),
  skillVersions: (id) => ipcRenderer.invoke(IPC_CHANNELS.skillVersions, id),
  skillRestore: (id, version) => ipcRenderer.invoke(IPC_CHANNELS.skillRestore, id, version),
  skillExport: (id) => ipcRenderer.invoke(IPC_CHANNELS.skillExport, id),
  skillImport: () => ipcRenderer.invoke(IPC_CHANNELS.skillImport),
  skillImportFolder: () => ipcRenderer.invoke(IPC_CHANNELS.skillImportFolder),
  tasksList: (filter) => ipcRenderer.invoke(IPC_CHANNELS.tasksList, filter),
  taskAdd: (draft) => ipcRenderer.invoke(IPC_CHANNELS.taskAdd, draft),
  taskUpdate: (id, draft) => ipcRenderer.invoke(IPC_CHANNELS.taskUpdate, id, draft),
  taskAction: (id, action) => ipcRenderer.invoke(IPC_CHANNELS.taskAction, id, action),
  taskReorder: (id, beforeId) => ipcRenderer.invoke(IPC_CHANNELS.taskReorder, id, beforeId),
  tasksUndo: () => ipcRenderer.invoke(IPC_CHANNELS.tasksUndo),
  meetingFindTasks: (meetingId) => ipcRenderer.invoke(IPC_CHANNELS.meetingFindTasks, meetingId),
  askThreads: () => ipcRenderer.invoke(IPC_CHANNELS.askThreads),
  askThread: (id) => ipcRenderer.invoke(IPC_CHANNELS.askThread, id),
  askSend: (input) => ipcRenderer.invoke(IPC_CHANNELS.askSend, input),
  contactsList: (query) => ipcRenderer.invoke(IPC_CHANNELS.contactsList, query),
  contactSave: (id, draft) => ipcRenderer.invoke(IPC_CHANNELS.contactSave, id, draft),
  contactDelete: (id) => ipcRenderer.invoke(IPC_CHANNELS.contactDelete, id),
  contactCard: (id) => ipcRenderer.invoke(IPC_CHANNELS.contactCard, id),
  askDelete: (id) => ipcRenderer.invoke(IPC_CHANNELS.askDelete, id),
  meetingSpeakerRename: (meetingId, speakerId, name) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetingSpeakerRename, meetingId, speakerId, name),
  meetingSpeakerClip: (meetingId, speakerId) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetingSpeakerClip, meetingId, speakerId),
  meetingCorrect: (meetingId, correction) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetingCorrect, meetingId, correction),
  foldersList: () => ipcRenderer.invoke(IPC_CHANNELS.foldersList),
  folderCreate: (name) => ipcRenderer.invoke(IPC_CHANNELS.folderCreate, name),
  folderRename: (id, name) => ipcRenderer.invoke(IPC_CHANNELS.folderRename, id, name),
  folderDelete: (id) => ipcRenderer.invoke(IPC_CHANNELS.folderDelete, id),
  folderUpdate: (id, patch) => ipcRenderer.invoke(IPC_CHANNELS.folderUpdate, id, patch),
  folderChooseExport: (id) => ipcRenderer.invoke(IPC_CHANNELS.folderChooseExport, id),
  folderClearExport: (id) => ipcRenderer.invoke(IPC_CHANNELS.folderClearExport, id),
  connectorsView: () => ipcRenderer.invoke(IPC_CHANNELS.connectorsView),
  connectorSync: (accountId) => ipcRenderer.invoke(IPC_CHANNELS.connectorSync, accountId),
  connectorOptions: (accountId) => ipcRenderer.invoke(IPC_CHANNELS.connectorOptions, accountId),
  connectorConnectKey: (id, key) => ipcRenderer.invoke(IPC_CHANNELS.connectorConnectKey, id, key),
  connectorRecordings: (accountId) =>
    ipcRenderer.invoke(IPC_CHANNELS.connectorRecordings, accountId),
  connectorImportPrepare: (accountId, remoteId) =>
    ipcRenderer.invoke(IPC_CHANNELS.connectorImportPrepare, accountId, remoteId),
  connectorDataStatus: () => ipcRenderer.invoke(IPC_CHANNELS.connectorDataStatus),
  askActionPropose: (request) => ipcRenderer.invoke(IPC_CHANNELS.askActionPropose, request),
  slackPostState: () => ipcRenderer.invoke(IPC_CHANNELS.slackPostState),
  slackPostStart: (source) => ipcRenderer.invoke(IPC_CHANNELS.slackPostStart, source),
  slackPostPrepare: (input) => ipcRenderer.invoke(IPC_CHANNELS.slackPostPrepare, input),
  slackPostSend: (input) => ipcRenderer.invoke(IPC_CHANNELS.slackPostSend, input),
  extensionsView: () => ipcRenderer.invoke(IPC_CHANNELS.extensionsView),
  briefOverview: () => ipcRenderer.invoke(IPC_CHANNELS.briefOverview),
  briefGet: (eventKey) => ipcRenderer.invoke(IPC_CHANNELS.briefGet, eventKey),
  briefBuild: (eventKey) => ipcRenderer.invoke(IPC_CHANNELS.briefBuild, eventKey),
  briefForMeeting: (meetingId) => ipcRenderer.invoke(IPC_CHANNELS.briefForMeeting, meetingId),
  briefOpen: (url) => ipcRenderer.invoke(IPC_CHANNELS.briefOpen, url),
  briefTarget: () => ipcRenderer.invoke(IPC_CHANNELS.briefTarget),
  emailDraftState: () => ipcRenderer.invoke(IPC_CHANNELS.emailDraftState),
  emailDraftPropose: (source) => ipcRenderer.invoke(IPC_CHANNELS.emailDraftPropose, source),
  emailDraftCreate: (input) => ipcRenderer.invoke(IPC_CHANNELS.emailDraftCreate, input),
  emailDraftList: (source) => ipcRenderer.invoke(IPC_CHANNELS.emailDraftList, source),
  emailDraftOpen: (url) => ipcRenderer.invoke(IPC_CHANNELS.emailDraftOpen, url),
  calendarEventState: () => ipcRenderer.invoke(IPC_CHANNELS.calendarEventState),
  calendarEventPropose: (source) => ipcRenderer.invoke(IPC_CHANNELS.calendarEventPropose, source),
  calendarEventCreate: (input) => ipcRenderer.invoke(IPC_CHANNELS.calendarEventCreate, input),
  calendarEventList: (source) => ipcRenderer.invoke(IPC_CHANNELS.calendarEventList, source),
  calendarEventOpen: (url) => ipcRenderer.invoke(IPC_CHANNELS.calendarEventOpen, url),
  mcpStatus: () => ipcRenderer.invoke(IPC_CHANNELS.mcpStatus),
  mcpClients: () => ipcRenderer.invoke(IPC_CHANNELS.mcpClients),
  mcpIssue: (name, kind) => ipcRenderer.invoke(IPC_CHANNELS.mcpIssue, name, kind),
  mcpRotate: (id) => ipcRenderer.invoke(IPC_CHANNELS.mcpRotate, id),
  mcpRevoke: (id) => ipcRenderer.invoke(IPC_CHANNELS.mcpRevoke, id),
  mcpCopyToken: (id) => ipcRenderer.invoke(IPC_CHANNELS.mcpCopyToken, id),
  mcpConfigPreview: (id) => ipcRenderer.invoke(IPC_CHANNELS.mcpConfigPreview, id),
  mcpConfigWrite: (previewId) => ipcRenderer.invoke(IPC_CHANNELS.mcpConfigWrite, previewId),
  mcpAudit: () => ipcRenderer.invoke(IPC_CHANNELS.mcpAudit),
  mcpAuditClear: () => ipcRenderer.invoke(IPC_CHANNELS.mcpAuditClear),
  connectorConnect: (id, loginHint) =>
    ipcRenderer.invoke(IPC_CHANNELS.connectorConnect, id, loginHint),
  connectorCancel: (id) => ipcRenderer.invoke(IPC_CHANNELS.connectorCancel, id),
  connectorDisconnect: (accountId) =>
    ipcRenderer.invoke(IPC_CHANNELS.connectorDisconnect, accountId),
  connectorSetEnabled: (accountId, enabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.connectorSetEnabled, accountId, enabled),
  connectorSetClientId: (id, clientId) =>
    ipcRenderer.invoke(IPC_CHANNELS.connectorSetClientId, id, clientId),
  connectorSetClientSecret: (id, secret) =>
    ipcRenderer.invoke(IPC_CHANNELS.connectorSetClientSecret, id, secret),
  meetingMove: (meetingId, folderId) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetingMove, meetingId, folderId),
  meetingFolderDismiss: (meetingId, folderId) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetingFolderDismiss, meetingId, folderId),
  meetingRecap: (meetingId) => ipcRenderer.invoke(IPC_CHANNELS.meetingRecap, meetingId),
  meetingImportPreview: () => ipcRenderer.invoke(IPC_CHANNELS.meetingImportPreview),
  meetingImportConfirm: (input) => ipcRenderer.invoke(IPC_CHANNELS.meetingImportConfirm, input),
  meetingImportCancel: (token) => ipcRenderer.invoke(IPC_CHANNELS.meetingImportCancel, token),
  meetingRetentionDue: () => ipcRenderer.invoke(IPC_CHANNELS.meetingRetentionDue),
  meetingRetentionLog: () => ipcRenderer.invoke(IPC_CHANNELS.meetingRetentionLog),
  meetingExport: (meetingId, options) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetingExport, meetingId, options),
  meetingSetLanguage: (meetingId, input) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetingSetLanguage, meetingId, input),
  meetingRerun: (meetingId, input) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetingRerun, meetingId, input),
  meetingVersionRestore: (meetingId, versionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetingVersionRestore, meetingId, versionId),
  meetingSegmentHistory: (meetingId, segmentId) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetingSegmentHistory, meetingId, segmentId),
  meetingCorrectionRevert: (meetingId, correctionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.meetingCorrectionRevert, meetingId, correctionId),
  meetingDelete: (id) => ipcRenderer.invoke(IPC_CHANNELS.meetingDelete, id),
  meetingNotesSave: (id, body) => ipcRenderer.invoke(IPC_CHANNELS.meetingNotesSave, id, body),
  notionPages: () => ipcRenderer.invoke(IPC_CHANNELS.notionPages),
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
  onMeetingLevel: (handler) => {
    const listener = (_event: unknown, level: CaptureLevel) => handler(level);
    ipcRenderer.on(IPC_EVENTS.meetingLevel, listener);
    return () => ipcRenderer.removeListener(IPC_EVENTS.meetingLevel, listener);
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
