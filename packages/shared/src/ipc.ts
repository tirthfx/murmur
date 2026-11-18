import { z } from "zod";
import {
  historyDeleteResultSchema,
  historyFeedbackSchema,
  historyIdsSchema,
  historyPageSchema,
  historyQuerySchema,
  type HistoryDeleteResult,
  type HistoryFeedback,
  type HistoryPage,
  type HistoryQuery,
} from "./history";
import {
  insightsExportResultSchema,
  insightsRangeSchema,
  insightsViewSchema,
  type InsightsExportResult,
  type InsightsRange,
  type InsightsView,
} from "./insights";
import { milestoneSchema, progressCardBytesSchema, type Milestone } from "./milestones";
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
  focusAddResultSchema,
  focusAppInputSchema,
  focusDurationSchema,
  focusRuleSchema,
  focusSiteInputSchema,
  focusSitesViewSchema,
  focusStateSchema,
  installedAppSchema,
  type FocusAddResult,
  type FocusAppInput,
  type FocusDuration,
  type FocusRule,
  type FocusSiteInput,
  type FocusSitesView,
  type FocusState,
  type InstalledApp,
} from "./focus";
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
  dictionaryClipResultSchema,
  type DictionaryClipResult,
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
import { voiceProfileViewSchema, type VoiceProfileView } from "./voice-profile";
import {
  rewriteInputSchema,
  rewriteSaveResultSchema,
  rewriteSchema,
  rewriteShortcutResultSchema,
  rewriteAutoApplySchema,
  type Rewrite,
  type RewriteAutoApply,
  type RewriteInput,
  type RewriteSaveResult,
  type RewriteShortcutResult,
} from "./rewrites";
import {
  instructModelStatusSchema,
  instructThreadSchema,
  instructThreadSummarySchema,
  type InstructModelStatus,
  type InstructThread,
  type InstructThreadSummary,
} from "./instruct";
import {
  writingSampleInputSchema,
  writingSampleSaveResultSchema,
  writingSampleSchema,
  type WritingSample,
  type WritingSampleInput,
  type WritingSampleSaveResult,
} from "./email";

/**
 * Renderer-to-main IPC contract. Channel names, payload schemas and the API the
 * preload exposes all live here so main, preload and renderer cannot drift.
 */

/** Launch at login (HB-17). `available` is false outside a packaged app. */
export const loginItemSchema = z.strictObject({ available: z.boolean(), enabled: z.boolean() });
export type LoginItem = z.infer<typeof loginItemSchema>;

export const IPC_CHANNELS = {
  getAppInfo: "app:get-info",
  hubSetPage: "hub:set-page",
  historyPage: "history:page",
  insightsView: "insights:view",
  milestonesList: "milestones:list",
  milestonesSeen: "milestones:seen",
  progressCardSave: "progress-card:save",
  progressCardCopy: "progress-card:copy",
  insightsExport: "insights:export",
  historyArchive: "history:archive",
  historyFeedback: "history:feedback",
  historyDelete: "history:delete",
  loginItemGet: "app:login-item-get",
  loginItemSet: "app:login-item-set",
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
  dictionaryClipStart: "dictionary:clip-start",
  dictionaryClipStop: "dictionary:clip-stop",
  dictionaryClipPlay: "dictionary:clip-play",
  dictionaryClipDelete: "dictionary:clip-delete",
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
  voiceProfileView: "voice-profile:view",
  voiceProfileReset: "voice-profile:reset",
  writingSamplesList: "writing-samples:list",
  writingSamplesSave: "writing-samples:save",
  writingSamplesDelete: "writing-samples:delete",
  rewritesList: "rewrites:list",
  rewritesSave: "rewrites:save",
  rewritesSetEnabled: "rewrites:set-enabled",
  rewritesMove: "rewrites:move",
  rewritesDuplicate: "rewrites:duplicate",
  rewritesDelete: "rewrites:delete",
  rewritesSetShortcut: "rewrites:set-shortcut",
  rewritesSetApplyDirectly: "rewrites:set-apply-directly",
  rewritesSetAutoApply: "rewrites:set-auto-apply",
  instructThreads: "instruct:threads",
  instructThread: "instruct:thread",
  instructDelete: "instruct:delete",
  instructDeleteAll: "instruct:delete-all",
  instructReuse: "instruct:reuse",
  instructModelStatus: "instruct:model-status",
  instructModelDownload: "instruct:model-download",
  instructModelRemove: "instruct:model-remove",
  focusState: "focus:state",
  focusStart: "focus:start",
  focusStop: "focus:stop",
  focusApps: "focus:apps",
  focusAddApp: "focus:add-app",
  focusRemoveApp: "focus:remove-app",
  focusInstalledApps: "focus:installed-apps",
  focusSites: "focus:sites",
  focusAddSite: "focus:add-site",
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
  // Pronunciation clips (PZ-06): recorded by main, played from a data URL in the Hub.
  [IPC_CHANNELS.dictionaryClipStart]: {
    args: z.tuple([z.string().min(1)]),
    result: dictionaryClipResultSchema,
  },
  [IPC_CHANNELS.dictionaryClipStop]: {
    args: z.tuple([]),
    result: dictionaryClipResultSchema,
  },
  [IPC_CHANNELS.dictionaryClipPlay]: {
    args: z.tuple([z.string().min(1)]),
    result: z.string().nullable(),
  },
  [IPC_CHANNELS.dictionaryClipDelete]: {
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
  [IPC_CHANNELS.writingSamplesList]: {
    args: z.tuple([]),
    result: z.array(writingSampleSchema),
  },
  [IPC_CHANNELS.writingSamplesSave]: {
    args: z.tuple([writingSampleInputSchema]),
    result: writingSampleSaveResultSchema,
  },
  [IPC_CHANNELS.writingSamplesDelete]: {
    args: z.tuple([z.string().min(1)]),
    result: z.void(),
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
  [IPC_CHANNELS.voiceProfileView]: {
    args: z.tuple([]),
    result: voiceProfileViewSchema,
  },
  // Clears every count and sample row.
  [IPC_CHANNELS.voiceProfileReset]: {
    args: z.tuple([]),
    result: voiceProfileViewSchema,
  },
  [IPC_CHANNELS.rewritesList]: {
    args: z.tuple([]),
    result: z.array(rewriteSchema),
  },
  [IPC_CHANNELS.rewritesSave]: {
    args: z.tuple([rewriteInputSchema]),
    result: rewriteSaveResultSchema,
  },
  [IPC_CHANNELS.rewritesSetEnabled]: {
    args: z.tuple([z.string().min(1), z.boolean()]),
    result: z.void(),
  },
  [IPC_CHANNELS.rewritesMove]: {
    args: z.tuple([z.string().min(1), z.union([z.literal(-1), z.literal(1)])]),
    result: z.void(),
  },
  [IPC_CHANNELS.rewritesDuplicate]: {
    args: z.tuple([z.string().min(1)]),
    result: rewriteSaveResultSchema,
  },
  // Null when deleted; a refusal for built-ins.
  [IPC_CHANNELS.rewritesDelete]: {
    args: z.tuple([z.string().min(1)]),
    result: rewriteSaveResultSchema.nullable(),
  },
  // A captured key, or null to remove the shortcut (RW-04).
  [IPC_CHANNELS.rewritesSetShortcut]: {
    args: z.tuple([z.string().min(1), capturedKeySchema.nullable()]),
    result: rewriteShortcutResultSchema,
  },
  [IPC_CHANNELS.rewritesSetApplyDirectly]: {
    args: z.tuple([z.string().min(1), z.boolean()]),
    result: z.void(),
  },
  [IPC_CHANNELS.rewritesSetAutoApply]: {
    args: z.tuple([z.string().min(1), rewriteAutoApplySchema]),
    result: z.void(),
  },
  // Instruct threads (RW-14): listed with a search, read, deleted, or reused as a new thread.
  [IPC_CHANNELS.instructThreads]: {
    args: z.tuple([z.string().max(200)]),
    result: z.array(instructThreadSummarySchema),
  },
  [IPC_CHANNELS.instructThread]: {
    args: z.tuple([z.string().min(1)]),
    result: instructThreadSchema.nullable(),
  },
  [IPC_CHANNELS.instructDelete]: {
    args: z.tuple([z.string().min(1)]),
    result: z.void(),
  },
  [IPC_CHANNELS.instructDeleteAll]: {
    args: z.tuple([]),
    result: z.void(),
  },
  [IPC_CHANNELS.instructReuse]: {
    args: z.tuple([z.string().min(1)]),
    result: z.boolean(),
  },
  // The Quality model (RW-15): downloaded only when the owner asks, from Settings.
  [IPC_CHANNELS.instructModelStatus]: { args: z.tuple([]), result: instructModelStatusSchema },
  [IPC_CHANNELS.instructModelDownload]: { args: z.tuple([]), result: instructModelStatusSchema },
  [IPC_CHANNELS.instructModelRemove]: { args: z.tuple([]), result: instructModelStatusSchema },
  // Focus Mode (RW-18, RW-19).
  [IPC_CHANNELS.focusState]: { args: z.tuple([]), result: focusStateSchema },
  [IPC_CHANNELS.focusStart]: { args: z.tuple([focusDurationSchema]), result: focusStateSchema },
  [IPC_CHANNELS.focusStop]: { args: z.tuple([]), result: focusStateSchema },
  [IPC_CHANNELS.focusApps]: { args: z.tuple([]), result: z.array(focusRuleSchema) },
  [IPC_CHANNELS.focusAddApp]: {
    args: z.tuple([focusAppInputSchema]),
    result: focusAddResultSchema,
  },
  [IPC_CHANNELS.focusRemoveApp]: { args: z.tuple([z.string().min(1)]), result: z.void() },
  // HB-41, HB-44.
  [IPC_CHANNELS.milestonesList]: { args: z.tuple([]), result: z.array(milestoneSchema) },
  [IPC_CHANNELS.milestonesSeen]: { args: z.tuple([]), result: z.void() },
  [IPC_CHANNELS.progressCardSave]: {
    args: z.tuple([progressCardBytesSchema]),
    result: z.strictObject({ saved: z.boolean() }),
  },
  [IPC_CHANNELS.progressCardCopy]: { args: z.tuple([progressCardBytesSchema]), result: z.void() },
  // HB-11, HB-36 to HB-39, HB-45.
  [IPC_CHANNELS.insightsView]: { args: z.tuple([insightsRangeSchema]), result: insightsViewSchema },
  [IPC_CHANNELS.insightsExport]: {
    args: z.tuple([insightsRangeSchema]),
    result: insightsExportResultSchema,
  },
  // HB-35.
  [IPC_CHANNELS.historyPage]: { args: z.tuple([historyQuerySchema]), result: historyPageSchema },
  [IPC_CHANNELS.historyArchive]: {
    args: z.tuple([historyIdsSchema, z.boolean()]),
    result: z.number(),
  },
  [IPC_CHANNELS.historyFeedback]: { args: z.tuple([historyFeedbackSchema]), result: z.void() },
  [IPC_CHANNELS.historyDelete]: {
    args: z.tuple([historyIdsSchema]),
    result: historyDeleteResultSchema,
  },
  // HB-17.
  [IPC_CHANNELS.loginItemGet]: { args: z.tuple([]), result: loginItemSchema },
  [IPC_CHANNELS.loginItemSet]: { args: z.tuple([z.boolean()]), result: loginItemSchema },
  // HB-01.
  [IPC_CHANNELS.hubSetPage]: {
    args: z.tuple([z.string().regex(/^[a-z-]{1,40}$/)]),
    result: z.void(),
  },
  [IPC_CHANNELS.focusInstalledApps]: { args: z.tuple([]), result: z.array(installedAppSchema) },
  // RW-20.
  [IPC_CHANNELS.focusSites]: { args: z.tuple([]), result: focusSitesViewSchema },
  [IPC_CHANNELS.focusAddSite]: {
    args: z.tuple([focusSiteInputSchema]),
    result: focusAddResultSchema,
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
  /** Pronunciation clips (PZ-06): recording stops by itself after 3 s. */
  dictionaryClipStart(id: string): Promise<DictionaryClipResult>;
  dictionaryClipStop(): Promise<DictionaryClipResult>;
  /** A data URL of the clip, or null. */
  dictionaryClipPlay(id: string): Promise<string | null>;
  dictionaryClipDelete(id: string): Promise<void>;
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
  voiceProfileView(): Promise<VoiceProfileView>;
  voiceProfileReset(): Promise<VoiceProfileView>;
  /** Writing samples for Rewrites (PZ-20), oldest first. */
  writingSamplesList(): Promise<WritingSample[]>;
  writingSamplesSave(input: WritingSampleInput): Promise<WritingSampleSaveResult>;
  writingSamplesDelete(id: string): Promise<void>;
  /** Every Rewrite in order, built-ins included (RW-02, RW-03). */
  rewritesList(): Promise<Rewrite[]>;
  /** Creates or edits a custom Rewrite. */
  rewritesSave(input: RewriteInput): Promise<RewriteSaveResult>;
  rewritesSetEnabled(id: string, enabled: boolean): Promise<void>;
  rewritesMove(id: string, step: -1 | 1): Promise<void>;
  rewritesDuplicate(id: string): Promise<RewriteSaveResult>;
  rewritesDelete(id: string): Promise<RewriteSaveResult | null>;
  /** A Rewrite's own shortcut, checked against every other one; null removes it. */
  rewritesSetShortcut(id: string, key: CapturedKey | null): Promise<RewriteShortcutResult>;
  rewritesSetApplyDirectly(id: string, applyDirectly: boolean): Promise<void>;
  /** Auto-apply after cleanup (RW-05). Only the first auto-apply Rewrite in order runs. */
  rewritesSetAutoApply(id: string, settings: RewriteAutoApply): Promise<void>;
  /** Saved Instruct threads, newest first, whose text contains the query (RW-14). */
  instructThreads(query: string): Promise<InstructThreadSummary[]>;
  instructThread(id: string): Promise<InstructThread | null>;
  instructDelete(id: string): Promise<void>;
  instructDeleteAll(): Promise<void>;
  /** Opens the Instruct panel with this thread's last draft as a new thread. False if gone. */
  instructReuse(id: string): Promise<boolean>;
  /** The Quality model's state; poll it while it downloads. */
  instructModelStatus(): Promise<InstructModelStatus>;
  /** Starts the Quality model download (5 GB) and returns at once. */
  instructModelDownload(): Promise<InstructModelStatus>;
  /** Deletes the Quality model's files; Instruct goes back to Fast. */
  instructModelRemove(): Promise<InstructModelStatus>;
  /** Focus Mode now (RW-18). */
  focusState(): Promise<FocusState>;
  /** Turns Focus on for this long; the duration is remembered for the shortcut. */
  focusStart(duration: FocusDuration): Promise<FocusState>;
  focusStop(): Promise<FocusState>;
  /** Blocked apps (RW-19), by name. */
  focusApps(): Promise<FocusRule[]>;
  focusAddApp(input: FocusAppInput): Promise<FocusAddResult>;
  /** Removes a blocked app or site. */
  focusRemoveApp(id: string): Promise<void>;
  /** Blocked sites (RW-20), and browsers seen whose page cannot be read. */
  focusSites(): Promise<FocusSitesView>;
  focusAddSite(input: FocusSiteInput): Promise<FocusAddResult>;
  /** Installed apps to choose from; empty when the helper cannot list them. */
  focusInstalledApps(): Promise<InstalledApp[]>;
  /** Milestones (HB-41), reached or not; checks for new ones first. */
  milestonesList(): Promise<Milestone[]>;
  /** The Insights page has shown the new milestones. */
  milestonesSeen(): Promise<void>;
  /** Saves a progress card PNG (HB-44) where the user picks. */
  progressCardSave(png: Uint8Array): Promise<{ saved: boolean }>;
  progressCardCopy(png: Uint8Array): Promise<void>;
  /** Insights (HB-11) for a range, worked out from daily counts. */
  insightsView(range: InsightsRange): Promise<InsightsView>;
  /** Saves the range's daily counts as CSV where the user picks (HB-45). */
  insightsExport(range: InsightsRange): Promise<InsightsExportResult>;
  /** History (HB-35): one page of dictations for a search and filters. */
  historyPage(query: HistoryQuery): Promise<HistoryPage>;
  /** Archives rows, or brings them back; returns rows changed. */
  historyArchive(ids: string[], archived: boolean): Promise<number>;
  historyFeedback(input: HistoryFeedback): Promise<void>;
  /** Deletes rows and their audio files. */
  historyDelete(ids: string[]): Promise<HistoryDeleteResult>;
  /** Launch at login (HB-17): only in a packaged app. */
  loginItemGet(): Promise<LoginItem>;
  loginItemSet(enabled: boolean): Promise<LoginItem>;
  /** The page now shown, remembered for the next start (HB-01). */
  hubSetPage(pageId: string): Promise<void>;
  /** Main asks the Hub to show a page (for example after a Bar prompt). */
  onOpenPage(handler: (pageId: string) => void): () => void;
  /** Input levels during a microphone check, about 20 a second. Returns an unsubscribe. */
  onMicCheckLevel(handler: (rmsDb: number) => void): () => void;
}

/** Main-to-Hub messages (no reply). */
export const IPC_EVENTS = {
  micCheckLevel: "mic-check:level",
  openPage: "hub:open-page",
} as const;
