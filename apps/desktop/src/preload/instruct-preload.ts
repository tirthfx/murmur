import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  INSTRUCT_PANEL_CHANNELS,
  INSTRUCT_PANEL_PUSH,
  type InstructPanelState,
  type MurmurInstructApi,
} from "@murmur/shared";

// The Instruct panel gets only these calls. ipcRenderer itself is never exposed.
const api: MurmurInstructApi = {
  ready: () => ipcRenderer.invoke(INSTRUCT_PANEL_CHANNELS.ready) as Promise<InstructPanelState>,
  onState: (handler) => {
    const listener = (_event: IpcRendererEvent, state: InstructPanelState) => handler(state);
    ipcRenderer.on(INSTRUCT_PANEL_PUSH.state, listener);
    return () => ipcRenderer.removeListener(INSTRUCT_PANEL_PUSH.state, listener);
  },
  insert: () => ipcRenderer.invoke(INSTRUCT_PANEL_CHANNELS.insert),
  copy: () => ipcRenderer.invoke(INSTRUCT_PANEL_CHANNELS.copy),
  regenerate: () => ipcRenderer.invoke(INSTRUCT_PANEL_CHANNELS.regenerate),
  toggleSource: (source) => ipcRenderer.invoke(INSTRUCT_PANEL_CHANNELS.toggleSource, source),
  followUp: (text) => ipcRenderer.invoke(INSTRUCT_PANEL_CHANNELS.followUp, text),
  newThread: () => ipcRenderer.invoke(INSTRUCT_PANEL_CHANNELS.newThread),
  close: () => ipcRenderer.invoke(INSTRUCT_PANEL_CHANNELS.close),
};

contextBridge.exposeInMainWorld("murmurInstruct", api);
