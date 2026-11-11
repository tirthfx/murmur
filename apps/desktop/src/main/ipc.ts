import {
  IPC_CHANNELS,
  parseIpcRequest,
  type AppInfo,
  type CapturedKey,
  type HelperStatus,
  type SettingsPatch,
  type SettingsView,
  type SetupStatus,
  type MicCheckResult,
  type MicCheckStartResult,
  type MediaPlayback,
  type DictionaryEntry,
  type DictionaryInput,
  type DictionarySaveResult,
  type Snippet,
  type SnippetInput,
  type SnippetSaveResult,
  type ShortcutResult,
  type ShortcutSlot,
  type PermissionKind,
  type PermissionsInfo,
  type RequestablePermissionKind,
} from "@murmur/shared";
import { isTrustedIpcSender } from "../security/guards";

export interface IpcDeps {
  entryUrl: string;
  getAppInfo: () => AppInfo;
  getHelperStatus: () => HelperStatus;
  /** Re-checks every permission now. */
  getPermissions: () => Promise<PermissionsInfo>;
  /** Only called with a requestable kind; the schema has already refused everything else. */
  requestPermission: (kind: RequestablePermissionKind) => Promise<PermissionsInfo>;
  /** Opens the System Settings pane for a known permission. */
  openPermissionSettings: (kind: PermissionKind) => Promise<void>;
  getSettings: () => Promise<SettingsView>;
  updateSettings: (patch: SettingsPatch) => Promise<SettingsView>;
  setShortcut: (slot: ShortcutSlot, key: CapturedKey | null) => Promise<ShortcutResult>;
  captureShortcut: (active: boolean) => void;
  getSetupStatus: () => Promise<SetupStatus>;
  downloadSpeechModel: () => Promise<SetupStatus>;
  micCheckStart: () => Promise<MicCheckStartResult>;
  micCheckStop: () => Promise<MicCheckResult | null>;
  getMediaPlayback: () => Promise<MediaPlayback | null>;
  dictionaryList: () => DictionaryEntry[];
  dictionarySave: (input: DictionaryInput) => DictionarySaveResult;
  dictionaryDelete: (id: string) => void;
  snippetsList: () => Snippet[];
  snippetsSave: (input: SnippetInput) => SnippetSaveResult;
  snippetsDelete: (id: string) => void;
}

export interface IpcEventLike {
  senderFrame?: { url: string } | null;
}

/**
 * Builds the handler for one channel. It checks the sender, validates the
 * arguments, then runs the implementation. Failures throw an error with no
 * payload content.
 */
export function createIpcHandler(deps: IpcDeps) {
  return (channel: string, event: IpcEventLike, args: readonly unknown[]): unknown => {
    if (!isTrustedIpcSender(event.senderFrame?.url, deps.entryUrl)) {
      throw new Error("IPC rejected: untrusted sender");
    }
    const request = parseIpcRequest(channel, args);
    if (!request.ok) {
      throw new Error(`IPC rejected: ${request.reason}`);
    }
    switch (channel) {
      case IPC_CHANNELS.getAppInfo:
        return deps.getAppInfo();
      case IPC_CHANNELS.getHelperStatus:
        return deps.getHelperStatus();
      case IPC_CHANNELS.getPermissions:
        return deps.getPermissions();
      case IPC_CHANNELS.requestPermission:
        return deps.requestPermission(request.args[0] as RequestablePermissionKind);
      case IPC_CHANNELS.openPermissionSettings:
        return deps.openPermissionSettings(request.args[0] as PermissionKind);
      case IPC_CHANNELS.getSettings:
        return deps.getSettings();
      case IPC_CHANNELS.updateSettings:
        return deps.updateSettings(request.args[0] as SettingsPatch);
      case IPC_CHANNELS.setShortcut:
        return deps.setShortcut(
          request.args[0] as ShortcutSlot,
          request.args[1] as CapturedKey | null,
        );
      case IPC_CHANNELS.captureShortcut:
        return deps.captureShortcut(request.args[0] as boolean);
      case IPC_CHANNELS.getSetupStatus:
        return deps.getSetupStatus();
      case IPC_CHANNELS.downloadSpeechModel:
        return deps.downloadSpeechModel();
      case IPC_CHANNELS.micCheckStart:
        return deps.micCheckStart();
      case IPC_CHANNELS.micCheckStop:
        return deps.micCheckStop();
      case IPC_CHANNELS.getMediaPlayback:
        return deps.getMediaPlayback();
      case IPC_CHANNELS.dictionaryList:
        return deps.dictionaryList();
      case IPC_CHANNELS.dictionarySave:
        return deps.dictionarySave(request.args[0] as DictionaryInput);
      case IPC_CHANNELS.dictionaryDelete:
        return deps.dictionaryDelete(request.args[0] as string);
      case IPC_CHANNELS.snippetsList:
        return deps.snippetsList();
      case IPC_CHANNELS.snippetsSave:
        return deps.snippetsSave(request.args[0] as SnippetInput);
      case IPC_CHANNELS.snippetsDelete:
        return deps.snippetsDelete(request.args[0] as string);
      default:
        throw new Error("IPC rejected: unknown-channel");
    }
  };
}
