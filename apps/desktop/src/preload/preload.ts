import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, IPC_EVENTS, type MurmurApi } from "@murmur/shared";

// Only this narrow, typed surface reaches the renderer. ipcRenderer itself is never exposed.
const api: MurmurApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
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
  rewritesSetApplyDirectly: (id, applyDirectly) =>
    ipcRenderer.invoke(IPC_CHANNELS.rewritesSetApplyDirectly, id, applyDirectly),
  importPreview: (request) => ipcRenderer.invoke(IPC_CHANNELS.importPreview, request),
  importApply: (request) => ipcRenderer.invoke(IPC_CHANNELS.importApply, request),
  voiceProfileView: () => ipcRenderer.invoke(IPC_CHANNELS.voiceProfileView),
  voiceProfileReset: () => ipcRenderer.invoke(IPC_CHANNELS.voiceProfileReset),
  writingSamplesList: () => ipcRenderer.invoke(IPC_CHANNELS.writingSamplesList),
  writingSamplesSave: (input) => ipcRenderer.invoke(IPC_CHANNELS.writingSamplesSave, input),
  writingSamplesDelete: (id) => ipcRenderer.invoke(IPC_CHANNELS.writingSamplesDelete, id),
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
