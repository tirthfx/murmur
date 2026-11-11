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
  type StylesView,
  type StyleUpdate,
  type AppCategoryOverride,
  type MemoryInput,
  type MemoryItem,
  type MemorySaveResult,
  type ImportPreview,
  type ImportRequest,
  type ImportResult,
  type VoiceProfileView,
  type WritingSample,
  type WritingSampleInput,
  type WritingSampleSaveResult,
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
  dictionaryKeep: (id: string) => void;
  snippetsList: () => Snippet[];
  snippetsSave: (input: SnippetInput) => SnippetSaveResult;
  snippetsDelete: (id: string) => void;
  stylesView: () => StylesView;
  stylesUpdate: (update: StyleUpdate) => StylesView;
  stylesSetOverride: (override: AppCategoryOverride) => StylesView;
  stylesClearOverride: (bundleId: string) => StylesView;
  memoryList: () => MemoryItem[];
  memorySave: (input: MemoryInput) => MemorySaveResult;
  memoryDelete: (id: string) => void;
  importPreview: (request: ImportRequest) => ImportPreview;
  importApply: (request: ImportRequest) => ImportResult;
  voiceProfileView: () => VoiceProfileView;
  voiceProfileReset: () => VoiceProfileView;
  writingSamplesList: () => WritingSample[];
  writingSamplesSave: (input: WritingSampleInput) => WritingSampleSaveResult;
  writingSamplesDelete: (id: string) => void;
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
      case IPC_CHANNELS.dictionaryKeep:
        return deps.dictionaryKeep(request.args[0] as string);
      case IPC_CHANNELS.snippetsList:
        return deps.snippetsList();
      case IPC_CHANNELS.snippetsSave:
        return deps.snippetsSave(request.args[0] as SnippetInput);
      case IPC_CHANNELS.snippetsDelete:
        return deps.snippetsDelete(request.args[0] as string);
      case IPC_CHANNELS.stylesView:
        return deps.stylesView();
      case IPC_CHANNELS.stylesUpdate:
        return deps.stylesUpdate(request.args[0] as StyleUpdate);
      case IPC_CHANNELS.stylesSetOverride:
        return deps.stylesSetOverride(request.args[0] as AppCategoryOverride);
      case IPC_CHANNELS.stylesClearOverride:
        return deps.stylesClearOverride(request.args[0] as string);
      case IPC_CHANNELS.memoryList:
        return deps.memoryList();
      case IPC_CHANNELS.memorySave:
        return deps.memorySave(request.args[0] as MemoryInput);
      case IPC_CHANNELS.memoryDelete:
        return deps.memoryDelete(request.args[0] as string);
      case IPC_CHANNELS.writingSamplesList:
        return deps.writingSamplesList();
      case IPC_CHANNELS.writingSamplesSave:
        return deps.writingSamplesSave(request.args[0] as WritingSampleInput);
      case IPC_CHANNELS.writingSamplesDelete:
        return deps.writingSamplesDelete(request.args[0] as string);
      case IPC_CHANNELS.importPreview:
        return deps.importPreview(request.args[0] as ImportRequest);
      case IPC_CHANNELS.importApply:
        return deps.importApply(request.args[0] as ImportRequest);
      case IPC_CHANNELS.voiceProfileView:
        return deps.voiceProfileView();
      case IPC_CHANNELS.voiceProfileReset:
        return deps.voiceProfileReset();
      default:
        throw new Error("IPC rejected: unknown-channel");
    }
  };
}
