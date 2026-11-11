import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type MurmurApi } from "@murmur/shared";

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
};

contextBridge.exposeInMainWorld("murmur", api);
