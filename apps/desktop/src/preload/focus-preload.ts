import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  FOCUS_OVERLAY_CHANNELS,
  FOCUS_OVERLAY_PUSH,
  type FocusOverlayState,
  type MurmurFocusApi,
} from "@murmur/shared";

// The Focus overlay gets only these calls. ipcRenderer itself is never exposed.
const api: MurmurFocusApi = {
  ready: () => ipcRenderer.invoke(FOCUS_OVERLAY_CHANNELS.ready) as Promise<FocusOverlayState>,
  onState: (handler) => {
    const listener = (_event: IpcRendererEvent, state: FocusOverlayState) => handler(state);
    ipcRenderer.on(FOCUS_OVERLAY_PUSH.state, listener);
    return () => ipcRenderer.removeListener(FOCUS_OVERLAY_PUSH.state, listener);
  },
  goBack: () => ipcRenderer.invoke(FOCUS_OVERLAY_CHANNELS.goBack),
  pause: () => ipcRenderer.invoke(FOCUS_OVERLAY_CHANNELS.pause),
  turnOff: () => ipcRenderer.invoke(FOCUS_OVERLAY_CHANNELS.turnOff),
};

contextBridge.exposeInMainWorld("murmurFocus", api);
