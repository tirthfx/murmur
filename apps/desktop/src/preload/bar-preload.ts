import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  BAR_IPC_CHANNELS,
  BAR_PUSH_CHANNELS,
  type BarView,
  type MurmurBarApi,
} from "@murmur/shared";

// The Bar page gets only these calls. ipcRenderer itself is never exposed.
function subscribe<T>(channel: string, handler: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T) => handler(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: MurmurBarApi = {
  ready: () => ipcRenderer.invoke(BAR_IPC_CHANNELS.ready) as Promise<BarView>,
  onView: (handler) => subscribe(BAR_PUSH_CHANNELS.view, handler),
  onLevel: (handler) => subscribe(BAR_PUSH_CHANNELS.level, handler),
  dragStart: () => ipcRenderer.send(BAR_IPC_CHANNELS.dragStart),
  drag: (dx, dy) => ipcRenderer.send(BAR_IPC_CHANNELS.drag, Math.round(dx), Math.round(dy)),
  dragEnd: () => ipcRenderer.send(BAR_IPC_CHANNELS.dragEnd),
  click: () => ipcRenderer.send(BAR_IPC_CHANNELS.click),
};

contextBridge.exposeInMainWorld("murmurBar", api);
