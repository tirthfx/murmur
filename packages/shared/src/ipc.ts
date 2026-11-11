import { z } from "zod";
import {
  permissionKindSchema,
  permissionsInfoSchema,
  requestablePermissionKindSchema,
  type PermissionKind,
  type PermissionsInfo,
  type RequestablePermissionKind,
} from "./permissions";
import { helperStatusSchema, type HelperStatus } from "./platform-helper";
import {
  capturedKeySchema,
  settingsPatchSchema,
  settingsViewSchema,
  shortcutResultSchema,
  type CapturedKey,
  type SettingsPatch,
  type SettingsView,
  type ShortcutResult,
  type ShortcutSlot,
} from "./settings";
import { setupStatusSchema, type SetupStatus } from "./setup";
import { mediaPlaybackResultSchema, type MediaPlayback } from "./media";
import {
  micCheckResultSchema,
  micCheckStartResultSchema,
  type MicCheckResult,
  type MicCheckStartResult,
} from "./mic-check";
import {
  dictionaryEntrySchema,
  dictionaryInputSchema,
  dictionarySaveResultSchema,
  type DictionaryEntry,
  type DictionaryInput,
  type DictionarySaveResult,
} from "./dictionary";
import {
  snippetInputSchema,
  snippetSaveResultSchema,
  snippetSchema,
  type Snippet,
  type SnippetInput,
  type SnippetSaveResult,
} from "./snippets";
import {
  appCategoryOverrideSchema,
  styleUpdateSchema,
  stylesViewSchema,
  type AppCategoryOverride,
  type StylesView,
  type StyleUpdate,
} from "./styles";
import {
  memoryInputSchema,
  memoryItemSchema,
  memorySaveResultSchema,
  type MemoryInput,
  type MemoryItem,
  type MemorySaveResult,
} from "./memory";
import {
  importPreviewSchema,
  importRequestSchema,
  importResultSchema,
  type ImportPreview,
  type ImportRequest,
  type ImportResult,
} from "./imports";

/**
 * Renderer-to-main IPC contract. Channel names, payload schemas and the API the
 * preload exposes all live here so main, preload and renderer cannot drift.
 */

export const IPC_CHANNELS = {
  getAppInfo: "app:get-info",
  getHelperStatus: "helper:get-status",
  getPermissions: "permissions:get",
  requestPermission: "permissions:request",
  openPermissionSettings: "permissions:open-settings",
  getSettings: "settings:get",
  updateSettings: "settings:update",
  setShortcut: "settings:set-shortcut",
  captureShortcut: "settings:capture-shortcut",
  getSetupStatus: "setup:get-status",
  downloadSpeechModel: "setup:download-speech-model",
  micCheckStart: "mic-check:start",
  micCheckStop: "mic-check:stop",
  getMediaPlayback: "experimental:media-playback",
  dictionaryList: "dictionary:list",
  dictionarySave: "dictionary:save",
  dictionaryDelete: "dictionary:delete",
  dictionaryKeep: "dictionary:keep",
  snippetsList: "snippets:list",
  snippetsSave: "snippets:save",
  snippetsDelete: "snippets:delete",
  stylesView: "styles:view",
  stylesUpdate: "styles:update",
  stylesSetOverride: "styles:set-override",
  stylesClearOverride: "styles:clear-override",
  memoryList: "memory:list",
  memorySave: "memory:save",
  memoryDelete: "memory:delete",
  importPreview: "import:preview",
  importApply: "import:apply",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const appInfoSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.string().min(1),
});

export type AppInfo = z.infer<typeof appInfoSchema>;

/** Per-channel schema for the arguments a renderer may send, and for the reply main returns. */
export const IPC_CONTRACT = {
  [IPC_CHANNELS.getAppInfo]: {
    args: z.tuple([]),
    result: appInfoSchema,
  },
  [IPC_CHANNELS.getHelperStatus]: {
    args: z.tuple([]),
    result: helperStatusSchema,
  },
  [IPC_CHANNELS.getPermissions]: {
    args: z.tuple([]),
    result: permissionsInfoSchema,
  },
  // Screen Recording and unknown kinds fail validation here, so they never reach main's logic.
  [IPC_CHANNELS.requestPermission]: {
    args: z.tuple([requestablePermissionKindSchema]),
    result: permissionsInfoSchema,
  },
  // The renderer names the permission only. Main decides which URL to open.
  [IPC_CHANNELS.openPermissionSettings]: {
    args: z.tuple([permissionKindSchema]),
    result: z.void(),
  },
  [IPC_CHANNELS.getSettings]: {
    args: z.tuple([]),
    result: settingsViewSchema,
  },
  [IPC_CHANNELS.updateSettings]: {
    args: z.tuple([settingsPatchSchema]),
    result: settingsViewSchema,
  },
  // A null key clears the slot (only hands-free can be cleared).
  [IPC_CHANNELS.setShortcut]: {
    args: z.tuple([z.enum(["hold", "handsFree"]), capturedKeySchema.nullable()]),
    result: shortcutResultSchema,
  },
  // Pauses the dictation key while the Hub records a new shortcut.
  [IPC_CHANNELS.captureShortcut]: {
    args: z.tuple([z.boolean()]),
    result: z.void(),
  },
  [IPC_CHANNELS.getSetupStatus]: {
    args: z.tuple([]),
    result: setupStatusSchema,
  },
  // Starts the download if none is running. Progress is read with getSetupStatus.
  [IPC_CHANNELS.downloadSpeechModel]: {
    args: z.tuple([]),
    result: setupStatusSchema,
  },
  [IPC_CHANNELS.micCheckStart]: {
    args: z.tuple([]),
    result: micCheckStartResultSchema,
  },
  // Null when no check was running.
  // Null when the helper is not running.
  [IPC_CHANNELS.getMediaPlayback]: {
    args: z.tuple([]),
    result: mediaPlaybackResultSchema.nullable(),
  },
  [IPC_CHANNELS.micCheckStop]: {
    args: z.tuple([]),
    result: micCheckResultSchema.nullable(),
  },
  [IPC_CHANNELS.dictionaryList]: {
    args: z.tuple([]),
    result: z.array(dictionaryEntrySchema),
  },
  // Adds an entry (no id) or changes one; refusals say why.
  [IPC_CHANNELS.dictionarySave]: {
    args: z.tuple([dictionaryInputSchema]),
    result: dictionarySaveResultSchema,
  },
  [IPC_CHANNELS.dictionaryDelete]: {
    args: z.tuple([z.string().min(1)]),
    result: z.void(),
  },
  // Keeps a learned entry: it is no longer marked for review.
  [IPC_CHANNELS.dictionaryKeep]: {
    args: z.tuple([z.string().min(1)]),
    result: z.void(),
  },
  [IPC_CHANNELS.snippetsList]: {
    args: z.tuple([]),
    result: z.array(snippetSchema),
  },
  [IPC_CHANNELS.snippetsSave]: {
    args: z.tuple([snippetInputSchema]),
    result: snippetSaveResultSchema,
  },
  [IPC_CHANNELS.snippetsDelete]: {
    args: z.tuple([z.string().min(1)]),
    result: z.void(),
  },
  [IPC_CHANNELS.stylesView]: {
    args: z.tuple([]),
    result: stylesViewSchema,
  },
  [IPC_CHANNELS.stylesUpdate]: {
    args: z.tuple([styleUpdateSchema]),
    result: stylesViewSchema,
  },
  [IPC_CHANNELS.stylesSetOverride]: {
    args: z.tuple([appCategoryOverrideSchema]),
    result: stylesViewSchema,
  },
  [IPC_CHANNELS.stylesClearOverride]: {
    args: z.tuple([z.string().min(1).max(255)]),
    result: stylesViewSchema,
  },
  [IPC_CHANNELS.memoryList]: {
    args: z.tuple([]),
    result: z.array(memoryItemSchema),
  },
  [IPC_CHANNELS.memorySave]: {
    args: z.tuple([memoryInputSchema]),
    result: memorySaveResultSchema,
  },
  [IPC_CHANNELS.memoryDelete]: {
    args: z.tuple([z.string().min(1)]),
    result: z.void(),
  },
  // Bulk import (PZ-07, PZ-10): the Hub sends the file's text; nothing is written by preview.
  [IPC_CHANNELS.importPreview]: {
    args: z.tuple([importRequestSchema]),
    result: importPreviewSchema,
  },
  [IPC_CHANNELS.importApply]: {
    args: z.tuple([importRequestSchema]),
    result: importResultSchema,
  },
} as const satisfies Record<IpcChannel, { args: z.ZodType; result: z.ZodType }>;

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === "string" && Object.values<string>(IPC_CHANNELS).includes(value);
}

export type IpcRequestResult =
  { ok: true; args: unknown[] } | { ok: false; reason: "unknown-channel" | "invalid-args" };

/**
 * Validates the arguments of an inbound IPC call. The failure reason never
 * includes the payload, so callers can log it without leaking content.
 */
export function parseIpcRequest(channel: unknown, args: readonly unknown[]): IpcRequestResult {
  if (!isIpcChannel(channel)) {
    return { ok: false, reason: "unknown-channel" };
  }
  const parsed = IPC_CONTRACT[channel].args.safeParse(args);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-args" };
  }
  return { ok: true, args: parsed.data as unknown[] };
}

/** The API the preload script exposes to the renderer as `window.murmur`. */
export interface MurmurApi {
  getAppInfo(): Promise<AppInfo>;
  getHelperStatus(): Promise<HelperStatus>;
  /** Re-checks every permission now and returns the result. */
  getPermissions(): Promise<PermissionsInfo>;
  /** Asks for one permission (may show a system prompt), then returns the fresh status. */
  requestPermission(kind: RequestablePermissionKind): Promise<PermissionsInfo>;
  /** Opens the System Settings pane for this permission. */
  openPermissionSettings(kind: PermissionKind): Promise<void>;
  getSettings(): Promise<SettingsView>;
  updateSettings(patch: SettingsPatch): Promise<SettingsView>;
  /** Checks and saves a captured shortcut; the result names the conflict when refused. */
  setShortcut(slot: ShortcutSlot, key: CapturedKey | null): Promise<ShortcutResult>;
  /** True while the Hub listens for a new shortcut, so the old one does not start dictation. */
  captureShortcut(active: boolean): Promise<void>;
  /** The speech model's state and whatever still blocks dictation. */
  getSetupStatus(): Promise<SetupStatus>;
  /** Starts the speech model download (once); poll getSetupStatus for progress. */
  downloadSpeechModel(): Promise<SetupStatus>;
  /** Starts a microphone check: nothing is recorded to disk. */
  micCheckStart(): Promise<MicCheckStartResult>;
  micCheckStop(): Promise<MicCheckResult | null>;
  /** Whether Murmur can see what is playing, for "Pause media while dictating". */
  getMediaPlayback(): Promise<MediaPlayback | null>;
  /** Every dictionary entry, starred first. */
  dictionaryList(): Promise<DictionaryEntry[]>;
  dictionarySave(input: DictionaryInput): Promise<DictionarySaveResult>;
  dictionaryDelete(id: string): Promise<void>;
  dictionaryKeep(id: string): Promise<void>;
  /** Every snippet, by trigger. */
  snippetsList(): Promise<Snippet[]>;
  snippetsSave(input: SnippetInput): Promise<SnippetSaveResult>;
  snippetsDelete(id: string): Promise<void>;
  /** The four styles, the owner's app categories and recently used apps. */
  stylesView(): Promise<StylesView>;
  stylesUpdate(update: StyleUpdate): Promise<StylesView>;
  stylesSetOverride(override: AppCategoryOverride): Promise<StylesView>;
  stylesClearOverride(bundleId: string): Promise<StylesView>;
  /** Saved facts, newest first. */
  memoryList(): Promise<MemoryItem[]>;
  memorySave(input: MemoryInput): Promise<MemorySaveResult>;
  memoryDelete(id: string): Promise<void>;
  importPreview(request: ImportRequest): Promise<ImportPreview>;
  importApply(request: ImportRequest): Promise<ImportResult>;
  /** Input levels during a microphone check, about 20 a second. Returns an unsubscribe. */
  onMicCheckLevel(handler: (rmsDb: number) => void): () => void;
}

/** Main-to-Hub messages (no reply). */
export const IPC_EVENTS = {
  micCheckLevel: "mic-check:level",
} as const;
