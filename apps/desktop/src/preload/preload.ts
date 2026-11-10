import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type MurmurApi } from "@murmur/shared";

// Only this narrow, typed surface reaches the renderer. ipcRenderer itself is never exposed.
const api: MurmurApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
};

contextBridge.exposeInMainWorld("murmur", api);
