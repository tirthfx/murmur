import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  REWRITE_PANEL_CHANNELS,
  REWRITE_PANEL_PUSH,
  type MurmurRewriteApi,
  type RewritePanelState,
} from "@murmur/shared";

// The Rewrite panel gets only these calls. ipcRenderer itself is never exposed.
const api: MurmurRewriteApi = {
  ready: () => ipcRenderer.invoke(REWRITE_PANEL_CHANNELS.ready) as Promise<RewritePanelState>,
  onState: (handler) => {
    const listener = (_event: IpcRendererEvent, state: RewritePanelState) => handler(state);
    ipcRenderer.on(REWRITE_PANEL_PUSH.state, listener);
    return () => ipcRenderer.removeListener(REWRITE_PANEL_PUSH.state, listener);
  },
  choose: (rewriteId) => ipcRenderer.invoke(REWRITE_PANEL_CHANNELS.choose, rewriteId),
  regenerate: () => ipcRenderer.invoke(REWRITE_PANEL_CHANNELS.regenerate),
  back: () => ipcRenderer.invoke(REWRITE_PANEL_CHANNELS.back),
  replace: () => ipcRenderer.invoke(REWRITE_PANEL_CHANNELS.replace),
  copy: () => ipcRenderer.invoke(REWRITE_PANEL_CHANNELS.copy),
  close: () => ipcRenderer.invoke(REWRITE_PANEL_CHANNELS.close),
};

contextBridge.exposeInMainWorld("murmurRewrite", api);
