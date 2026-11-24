import { z } from "zod";
import {
  correctionSchema,
  meetingLanguageSchema,
  type Correction,
  type CorrectionResult,
  type LivePartial,
  type MeetingDetail,
  type MeetingDoc,
  type MeetingFindTasksResult,
  type MeetingLanguageInput,
  type MeetingListItem,
  type MeetingRecapResult,
  type MeetingSummarizeResult,
  type RecordingState,
  type RerunResult,
  type RevertResult,
  type SegmentHistoryItem,
  type SpeakerClipResult,
  type SpeakerRenameResult,
} from "./meetings";
import type { MeetingRetentionDue } from "./meeting-retention";
import {
  transcriptImportConfirmSchema,
  type TranscriptImportConfirmInput,
  type TranscriptImportConfirmResult,
  type TranscriptImportPreviewResult,
} from "./transcript-import";
import type { ConnectorActionResult, ConnectorsView } from "./connectors";
import type { ConnectorDataStatus, ConnectorOptionsResult } from "./connector-data";
import type { RecordingsResult } from "./connector-import";
import type { AskActionResult } from "./ask-actions";
import { askActionRequestSchema, type AskActionRequest } from "./ask-actions";
import type { ExtensionsView } from "./extensions";
import type { PolicyView } from "./policy";
import type { SharedFolder, SharedNote, TeamPerson } from "./team-content";
import {
  teamConnectSchema,
  teamFolderCreateSchema,
  teamNoteReadSchema,
  teamPasswordChangeSchema,
  teamProposeSchema,
  teamRedeemSchema,
  teamSetupSchema,
  teamShareMeetingSchema,
  teamSignInSchema,
  teamSkillAddSchema,
  type TeamContentResult,
  type TeamFolderCreateInput,
  type TeamNoteReadInput,
  type TeamPasswordChangeInput,
  type TeamProposeInput,
  type TeamShareMeetingInput,
  type TeamSkillAddInput,
  type TeamProposeResult,
  type TeamRedeemResult,
  type TeamResult,
  type TeamView,
} from "./team";
import {
  slackPostSourceSchema,
  slackPrepareInputSchema,
  slackSendInputSchema,
  type SlackPostSource,
  type SlackPrepareInput,
  type SlackPrepareResult,
  type SlackSendInput,
  type SlackSendResult,
  type SlackStartResult,
} from "./slack-post";
import type { BriefOverview, BriefResult, MeetingBrief } from "./brief";
import {
  calendarEventInputSchema,
  calendarEventSourceSchema,
  type CalendarEventInput,
  type CalendarEventProposalResult,
  type CalendarEventRecord,
  type CalendarEventResult,
  type CalendarEventSource,
  type CalendarEventState,
} from "./calendar";
import {
  emailDraftInputSchema,
  emailDraftSourceSchema,
  type EmailAutomationRecord,
  type EmailDraftInput,
  type EmailDraftSource,
  type EmailDraftProposalResult,
  type EmailDraftResult,
  type EmailDraftState,
} from "./gmail";
import type {
  McpActionResult,
  McpAuditEntry,
  McpClientKind,
  McpClientsView,
  McpConfigPreviewResult,
  McpStatus,
} from "./mcp";
import {
  folderPatchSchema,
  meetingExportOptionsSchema,
  type FolderPatch,
  type FolderResult,
  type MeetingExportOptions,
  type MeetingExportResult,
  type MeetingFolder,
} from "./folders";
import {
  askSendSchema,
  type AskSendInput,
  type AskSendResult,
  type AskThread,
  type AskThreadItem,
} from "./ask";
import {
  TASK_ACTIONS,
  taskDraftSchema,
  taskFilterSchema,
  type TaskAction,
  type TaskDraft,
  type TaskFilter,
  type TaskResult,
  type TasksView,
} from "./tasks";
import {
  skillDraftSchema,
  summaryFeedbackSchema,
  type Skill,
  type SkillDraft,
  type SkillExportResult,
  type SkillImportResult,
  type SkillResult,
  type SkillVersion,
  type SummaryFeedback,
} from "./skills";
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
  noteCreateSchema,
  noteSaveResultSchema,
  noteSaveSchema,
  noteSchema,
  noteSummarySchema,
  notePinResultSchema,
  noteImageAddSchema,
  noteRewriteChoiceSchema,
  noteRewriteRunSchema,
  noteRewriteResultSchema,
  noteRewriteRecordSchema,
  noteExportSchema,
  noteImportSchema,
  type NoteRewriteChoice,
  type NoteRewriteRun,
  type NoteRewriteResult,
  type NoteRewriteRecord,
  type NoteExport,
  type NoteImport,
  noteImageResultSchema,
  type NoteImageAdd,
  type NoteImageResult,
  noteVersionSaveSchema,
  noteVersionSchema,
  noteVersionTextSchema,
  type Note,
  type NotePinResult,
  type NoteVersion,
  type NoteVersionSave,
  type NoteVersionText,
  type NoteCreate,
  type NoteSave,
  type NoteSaveResult,
  type NoteSummary,
} from "./notes";
import { planActionSchema, planViewSchema, type PlanAction, type PlanView } from "./plans";
import {
  axInspectResultSchema,
  TESTING_TOOLS,
  testingToolResultSchema,
  type AxInspectResult,
  type TestingTool,
  type TestingToolResult,
} from "./testing";
import {
  dataCountsSchema,
  DELETE_CATEGORIES,
  deleteResultSchema,
  exportRequestSchema,
  exportResultSchema,
  resetRequestSchema,
  type DataCounts,
  type DeleteCategory,
  type DeleteResult,
  type ExportRequest,
  type ExportResult,
  type ResetRequest,
} from "./data";
import {
  retentionViewSchema,
  storageViewSchema,
  type RetentionView,
  type StorageView,
} from "./privacy";
import {
  DICTATION_STATES,
  historyRetryResultSchema,
  homeViewSchema,
  type DictationState,
  type HistoryRetryResult,
  type HomeView,
} from "./home";
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
  homeView: "home:view",
  storageView: "privacy:storage",
  dataExport: "data:export",
  planView: "plan:view",
  testingTool: "testing:tool",
  reportProblem: "help:report-problem",
  axInspect: "testing:ax-inspect",
  planAct: "plan:act",
  dataCounts: "data:counts",
  dataDelete: "data:delete",
  dataReset: "data:reset",
  dataRetryFailed: "data:retry-failed",
  storageOpen: "privacy:storage-open",
  retentionView: "privacy:retention",
  retentionRun: "privacy:retention-run",
  notesList: "notes:list",
  noteGet: "notes:get",
  noteCreate: "notes:create",
  noteSave: "notes:save",
  noteDelete: "notes:delete",
  noteVersions: "notes:versions",
  noteVersionSave: "notes:version-save",
  noteVersionText: "notes:version-text",
  noteVersionRestore: "notes:version-restore",
  notePin: "notes:pin",
  noteImageAdd: "notes:image-add",
  noteRewrites: "notes:rewrites",
  noteRewriteRun: "notes:rewrite-run",
  noteRewriteRecord: "notes:rewrite-record",
  noteExport: "notes:export",
  noteImport: "notes:import",
  noteImageData: "notes:image-data",
  notePinMove: "notes:pin-move",
  scratchpadOpen: "scratchpad:open",
  historyRetry: "history:retry",
  dictationState: "dictation:state",
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
  meetingsList: "meetings:list",
  meetingDetail: "meetings:detail",
  meetingRecording: "meetings:recording",
  meetingStart: "meetings:start",
  meetingStop: "meetings:stop",
  meetingRename: "meetings:rename",
  meetingDelete: "meetings:delete",
  meetingNotesSave: "meetings:notes-save",
  meetingDocAddLink: "meetings:doc-add-link",
  meetingDocAddFile: "meetings:doc-add-file",
  meetingDocOpen: "meetings:doc-open",
  meetingDocRemove: "meetings:doc-remove",
  meetingSummarize: "meetings:summarize",
  meetingSummaryFeedback: "meetings:summary-feedback",
  skillsList: "skills:list",
  skillSave: "skills:save",
  skillDuplicate: "skills:duplicate",
  skillDelete: "skills:delete",
  skillVersions: "skills:versions",
  skillRestore: "skills:restore",
  skillExport: "skills:export",
  skillImport: "skills:import",
  tasksList: "tasks:list",
  taskAdd: "tasks:add",
  taskUpdate: "tasks:update",
  taskAction: "tasks:action",
  taskReorder: "tasks:reorder",
  tasksUndo: "tasks:undo",
  meetingFindTasks: "meetings:find-tasks",
  askThreads: "ask:threads",
  askThread: "ask:thread",
  askSend: "ask:send",
  askDelete: "ask:delete",
  meetingSpeakerRename: "meetings:speaker-rename",
  meetingSpeakerClip: "meetings:speaker-clip",
  meetingCorrect: "meetings:correct",
  meetingSetLanguage: "meetings:set-language",
  foldersList: "folders:list",
  folderCreate: "folders:create",
  folderRename: "folders:rename",
  folderDelete: "folders:delete",
  folderUpdate: "folders:update",
  folderChooseExport: "folders:choose-export",
  folderClearExport: "folders:clear-export",
  connectorsView: "connectors:view",
  connectorConnect: "connectors:connect",
  connectorCancel: "connectors:cancel",
  connectorDisconnect: "connectors:disconnect",
  connectorSetEnabled: "connectors:set-enabled",
  connectorSetClientId: "connectors:set-client-id",
  connectorSetClientSecret: "connectors:set-client-secret",
  connectorSync: "connectors:sync",
  connectorOptions: "connectors:options",
  connectorConnectKey: "connectors:connect-key",
  connectorRecordings: "connectors:recordings",
  connectorImportPrepare: "connectors:import-prepare",
  connectorDataStatus: "connectors:data-status",
  extensionsView: "extensions:view",
  policyView: "policy:view",
  teamView: "team:view",
  teamConnect: "team:connect",
  teamSetup: "team:setup",
  teamSignIn: "team:sign-in",
  teamSignOut: "team:sign-out",
  teamLock: "team:lock",
  teamUnlock: "team:unlock",
  teamRedeem: "team:redeem",
  teamSyncNow: "team:sync-now",
  teamSetIdleLock: "team:set-idle-lock",
  teamDisconnect: "team:disconnect",
  teamNoticesSeen: "team:notices-seen",
  teamOpenAdmin: "team:open-admin",
  teamPropose: "team:propose",
  teamPeople: "team:people",
  teamChangePassword: "team:change-password",
  teamFolderCreate: "team:folder-create",
  teamNoteRead: "team:note-read",
  teamSkillAdd: "team:skill-add",
  teamShareMeeting: "team:share-meeting",
  askActionPropose: "ask:action-propose",
  slackPostState: "slack-post:state",
  slackPostStart: "slack-post:start",
  slackPostPrepare: "slack-post:prepare",
  slackPostSend: "slack-post:send",
  briefOverview: "brief:overview",
  briefGet: "brief:get",
  briefBuild: "brief:build",
  briefForMeeting: "brief:for-meeting",
  briefOpen: "brief:open",
  briefTarget: "brief:target",
  emailDraftState: "email-draft:state",
  emailDraftPropose: "email-draft:propose",
  emailDraftCreate: "email-draft:create",
  emailDraftList: "email-draft:list",
  emailDraftOpen: "email-draft:open",
  calendarEventState: "calendar-event:state",
  calendarEventPropose: "calendar-event:propose",
  calendarEventCreate: "calendar-event:create",
  calendarEventList: "calendar-event:list",
  calendarEventOpen: "calendar-event:open",
  mcpStatus: "mcp:status",
  mcpClients: "mcp:clients",
  mcpIssue: "mcp:issue",
  mcpRotate: "mcp:rotate",
  mcpRevoke: "mcp:revoke",
  mcpCopyToken: "mcp:copy-token",
  mcpConfigPreview: "mcp:config-preview",
  mcpConfigWrite: "mcp:config-write",
  mcpAudit: "mcp:audit",
  mcpAuditClear: "mcp:audit-clear",
  meetingMove: "meetings:move",
  meetingFolderDismiss: "meetings:folder-dismiss",
  meetingExport: "meetings:export",
  meetingRetentionDue: "meetings:retention-due",
  meetingImportPreview: "meetings:import-preview",
  meetingRecap: "meetings:recap",
  meetingImportConfirm: "meetings:import-confirm",
  meetingImportCancel: "meetings:import-cancel",
  meetingRerun: "meetings:rerun",
  meetingVersionRestore: "meetings:version-restore",
  meetingSegmentHistory: "meetings:segment-history",
  meetingCorrectionRevert: "meetings:correction-revert",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const appInfoSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.string().min(1),
});

export type AppInfo = z.infer<typeof appInfoSchema>;

/** Meeting and doc ids are UUIDs. */
const meetingIdArg = z.string().min(1).max(64);

export const meetingStartResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), meetingId: z.string() }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type MeetingStartResult = z.infer<typeof meetingStartResultSchema>;

/** Adding a link or file to a meeting; `canceled` when the file dialog was closed. */
export type MeetingDocResult =
  { ok: true; doc: MeetingDoc } | { ok: false; message: string; canceled?: boolean };

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
  // HB-08.
  [IPC_CHANNELS.reportProblem]: { args: z.tuple([]), result: testingToolResultSchema },
  // HB-55, HB-56.
  [IPC_CHANNELS.testingTool]: {
    args: z.tuple([z.enum(TESTING_TOOLS)]),
    result: testingToolResultSchema,
  },
  [IPC_CHANNELS.axInspect]: {
    args: z.tuple([z.boolean()]),
    result: axInspectResultSchema.nullable(),
  },
  // HB-19.
  [IPC_CHANNELS.planView]: { args: z.tuple([]), result: planViewSchema },
  [IPC_CHANNELS.planAct]: { args: z.tuple([planActionSchema]), result: planViewSchema },
  // HB-46, HB-47.
  [IPC_CHANNELS.dataExport]: { args: z.tuple([exportRequestSchema]), result: exportResultSchema },
  [IPC_CHANNELS.dataCounts]: { args: z.tuple([]), result: dataCountsSchema },
  [IPC_CHANNELS.dataDelete]: {
    args: z.tuple([z.enum(DELETE_CATEGORIES)]),
    result: deleteResultSchema,
  },
  [IPC_CHANNELS.dataReset]: { args: z.tuple([resetRequestSchema]), result: deleteResultSchema },
  [IPC_CHANNELS.dataRetryFailed]: { args: z.tuple([]), result: z.number() },
  // HB-49, HB-50.
  [IPC_CHANNELS.storageView]: { args: z.tuple([]), result: storageViewSchema },
  [IPC_CHANNELS.storageOpen]: { args: z.tuple([]), result: z.void() },
  [IPC_CHANNELS.retentionView]: { args: z.tuple([]), result: retentionViewSchema },
  [IPC_CHANNELS.retentionRun]: { args: z.tuple([]), result: retentionViewSchema },
  // HB-26, HB-31.
  [IPC_CHANNELS.notesList]: {
    args: z.tuple([z.string().max(200)]),
    result: z.array(noteSummarySchema),
  },
  [IPC_CHANNELS.noteGet]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: noteSchema.nullable(),
  },
  [IPC_CHANNELS.noteCreate]: {
    args: z.tuple([noteCreateSchema]),
    result: z.discriminatedUnion("ok", [
      z.strictObject({ ok: z.literal(true), note: noteSchema }),
      z.strictObject({ ok: z.literal(false), message: z.string() }),
    ]),
  },
  [IPC_CHANNELS.noteSave]: { args: z.tuple([noteSaveSchema]), result: noteSaveResultSchema },
  [IPC_CHANNELS.noteDelete]: { args: z.tuple([z.string().min(1).max(64)]), result: z.void() },
  [IPC_CHANNELS.scratchpadOpen]: {
    args: z.tuple([z.string().min(1).max(64).nullable()]),
    result: z.void(),
  },
  // HB-28, HB-29.
  [IPC_CHANNELS.noteVersions]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.array(noteVersionSchema),
  },
  [IPC_CHANNELS.noteVersionSave]: {
    args: z.tuple([noteVersionSaveSchema]),
    result: noteVersionSchema.nullable(),
  },
  [IPC_CHANNELS.noteVersionText]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: noteVersionTextSchema.nullable(),
  },
  [IPC_CHANNELS.noteVersionRestore]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: noteSchema.nullable(),
  },
  [IPC_CHANNELS.notePin]: {
    args: z.tuple([z.string().min(1).max(64), z.boolean()]),
    result: notePinResultSchema,
  },
  [IPC_CHANNELS.notePinMove]: {
    args: z.tuple([z.string().min(1).max(64), z.union([z.literal(-1), z.literal(1)])]),
    result: z.void(),
  },
  // HB-32, HB-27, HB-33.
  [IPC_CHANNELS.noteRewrites]: { args: z.tuple([]), result: z.array(noteRewriteChoiceSchema) },
  [IPC_CHANNELS.noteRewriteRun]: {
    args: z.tuple([noteRewriteRunSchema]),
    result: noteRewriteResultSchema,
  },
  [IPC_CHANNELS.noteRewriteRecord]: { args: z.tuple([noteRewriteRecordSchema]), result: z.void() },
  [IPC_CHANNELS.noteExport]: {
    args: z.tuple([noteExportSchema]),
    result: z.strictObject({ saved: z.boolean() }),
  },
  [IPC_CHANNELS.noteImport]: {
    args: z.tuple([noteImportSchema]),
    result: z.discriminatedUnion("ok", [
      z.strictObject({ ok: z.literal(true), note: noteSchema }),
      z.strictObject({ ok: z.literal(false), message: z.string() }),
    ]),
  },
  // HB-30.
  [IPC_CHANNELS.noteImageAdd]: {
    args: z.tuple([noteImageAddSchema]),
    result: noteImageResultSchema,
  },
  [IPC_CHANNELS.noteImageData]: {
    args: z.tuple([z.string().regex(/^[\w-]{1,64}$/)]),
    result: z.string().nullable(),
  },
  // HB-02, HB-03.
  [IPC_CHANNELS.homeView]: { args: z.tuple([]), result: homeViewSchema },
  [IPC_CHANNELS.historyRetry]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: historyRetryResultSchema,
  },
  [IPC_CHANNELS.dictationState]: { args: z.tuple([]), result: z.enum(DICTATION_STATES) },
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
  // M5 Notetaker (NT-06, NT-10). View results are built in main and not checked again.
  [IPC_CHANNELS.meetingsList]: { args: z.tuple([]), result: z.custom<MeetingListItem[]>() },
  [IPC_CHANNELS.meetingDetail]: {
    args: z.tuple([meetingIdArg]),
    result: z.custom<MeetingDetail | null>(),
  },
  [IPC_CHANNELS.meetingRecording]: { args: z.tuple([]), result: z.custom<RecordingState>() },
  [IPC_CHANNELS.meetingStart]: { args: z.tuple([]), result: meetingStartResultSchema },
  [IPC_CHANNELS.meetingStop]: { args: z.tuple([]), result: z.void() },
  [IPC_CHANNELS.meetingRename]: {
    args: z.tuple([meetingIdArg, z.string().max(200)]),
    result: z.void(),
  },
  [IPC_CHANNELS.meetingDelete]: { args: z.tuple([meetingIdArg]), result: z.void() },
  [IPC_CHANNELS.meetingSummarize]: {
    args: z.tuple([
      meetingIdArg,
      z.strictObject({ skillId: z.string().max(64).optional(), quick: z.boolean().optional() }),
    ]),
    result: z.custom<MeetingSummarizeResult>(),
  },
  [IPC_CHANNELS.meetingSummaryFeedback]: {
    args: z.tuple([z.string().min(1).max(64), summaryFeedbackSchema.nullable()]),
    result: z.void(),
  },
  [IPC_CHANNELS.skillsList]: { args: z.tuple([]), result: z.custom<Skill[]>() },
  [IPC_CHANNELS.skillSave]: {
    args: z.tuple([z.string().min(1).max(64).nullable(), skillDraftSchema]),
    result: z.custom<SkillResult>(),
  },
  [IPC_CHANNELS.skillDuplicate]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<SkillResult>(),
  },
  [IPC_CHANNELS.skillDelete]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<{ ok: true } | { ok: false; message: string }>(),
  },
  [IPC_CHANNELS.skillVersions]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<SkillVersion[]>(),
  },
  [IPC_CHANNELS.skillRestore]: {
    args: z.tuple([z.string().min(1).max(64), z.number().int().min(1)]),
    result: z.custom<SkillResult>(),
  },
  [IPC_CHANNELS.skillExport]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<SkillExportResult>(),
  },
  [IPC_CHANNELS.skillImport]: { args: z.tuple([]), result: z.custom<SkillImportResult>() },
  [IPC_CHANNELS.tasksList]: {
    args: z.tuple([taskFilterSchema]),
    result: z.custom<TasksView>(),
  },
  [IPC_CHANNELS.taskAdd]: { args: z.tuple([taskDraftSchema]), result: z.custom<TaskResult>() },
  [IPC_CHANNELS.taskUpdate]: {
    args: z.tuple([z.string().min(1).max(64), taskDraftSchema]),
    result: z.custom<TaskResult>(),
  },
  [IPC_CHANNELS.taskAction]: {
    args: z.tuple([z.string().min(1).max(64), z.enum(TASK_ACTIONS)]),
    result: z.custom<TaskResult>(),
  },
  [IPC_CHANNELS.taskReorder]: {
    args: z.tuple([z.string().min(1).max(64), z.string().min(1).max(64).nullable()]),
    result: z.custom<TaskResult>(),
  },
  [IPC_CHANNELS.tasksUndo]: {
    args: z.tuple([]),
    result: z.custom<{ ok: true; label: string } | { ok: false }>(),
  },
  [IPC_CHANNELS.meetingSpeakerRename]: {
    args: z.tuple([z.string().min(1).max(64), z.string().min(1).max(128), z.string().max(200)]),
    result: z.custom<SpeakerRenameResult>(),
  },
  [IPC_CHANNELS.meetingSpeakerClip]: {
    args: z.tuple([z.string().min(1).max(64), z.string().min(1).max(128)]),
    result: z.custom<SpeakerClipResult>(),
  },
  [IPC_CHANNELS.meetingCorrect]: {
    args: z.tuple([z.string().min(1).max(64), correctionSchema]),
    result: z.custom<CorrectionResult>(),
  },
  [IPC_CHANNELS.foldersList]: { args: z.tuple([]), result: z.custom<MeetingFolder[]>() },
  [IPC_CHANNELS.folderCreate]: {
    args: z.tuple([z.string().max(200)]),
    result: z.custom<FolderResult>(),
  },
  [IPC_CHANNELS.folderRename]: {
    args: z.tuple([z.string().min(1).max(64), z.string().max(200)]),
    result: z.custom<FolderResult>(),
  },
  [IPC_CHANNELS.folderDelete]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<FolderResult>(),
  },
  [IPC_CHANNELS.folderUpdate]: {
    args: z.tuple([z.string().min(1).max(64), folderPatchSchema]),
    result: z.custom<FolderResult>(),
  },
  [IPC_CHANNELS.folderChooseExport]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<FolderResult>(),
  },
  [IPC_CHANNELS.folderClearExport]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<FolderResult>(),
  },
  [IPC_CHANNELS.connectorsView]: { args: z.tuple([]), result: z.custom<ConnectorsView>() },
  [IPC_CHANNELS.connectorConnect]: {
    args: z.tuple([z.string().min(1).max(64), z.string().max(320).optional()]),
    result: z.custom<ConnectorActionResult>(),
  },
  [IPC_CHANNELS.connectorCancel]: { args: z.tuple([z.string().min(1).max(64)]), result: z.void() },
  [IPC_CHANNELS.connectorDisconnect]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<ConnectorActionResult>(),
  },
  [IPC_CHANNELS.connectorSetEnabled]: {
    args: z.tuple([z.string().min(1).max(64), z.boolean()]),
    result: z.void(),
  },
  [IPC_CHANNELS.connectorSetClientId]: {
    args: z.tuple([z.string().min(1).max(64), z.string().max(300).nullable()]),
    result: z.custom<ConnectorActionResult>(),
  },
  [IPC_CHANNELS.connectorSetClientSecret]: {
    args: z.tuple([z.string().min(1).max(64), z.string().max(300).nullable()]),
    result: z.custom<ConnectorActionResult>(),
  },
  [IPC_CHANNELS.connectorSync]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<ConnectorActionResult>(),
  },
  [IPC_CHANNELS.connectorConnectKey]: {
    args: z.tuple([z.string().min(1).max(64), z.string().max(400)]),
    result: z.custom<ConnectorActionResult>(),
  },
  [IPC_CHANNELS.connectorRecordings]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<RecordingsResult>(),
  },
  [IPC_CHANNELS.connectorImportPrepare]: {
    args: z.tuple([z.string().min(1).max(64), z.string().min(1).max(400)]),
    result: z.custom<TranscriptImportPreviewResult>(),
  },
  [IPC_CHANNELS.connectorOptions]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<ConnectorOptionsResult>(),
  },
  [IPC_CHANNELS.connectorDataStatus]: {
    args: z.tuple([]),
    result: z.custom<ConnectorDataStatus[]>(),
  },
  [IPC_CHANNELS.askActionPropose]: {
    args: z.tuple([askActionRequestSchema]),
    result: z.custom<AskActionResult>(),
  },
  [IPC_CHANNELS.slackPostState]: { args: z.tuple([]), result: z.custom<EmailDraftState>() },
  [IPC_CHANNELS.slackPostStart]: {
    args: z.tuple([slackPostSourceSchema]),
    result: z.custom<SlackStartResult>(),
  },
  [IPC_CHANNELS.slackPostPrepare]: {
    args: z.tuple([slackPrepareInputSchema]),
    result: z.custom<SlackPrepareResult>(),
  },
  [IPC_CHANNELS.slackPostSend]: {
    args: z.tuple([slackSendInputSchema]),
    result: z.custom<SlackSendResult>(),
  },
  [IPC_CHANNELS.extensionsView]: { args: z.tuple([]), result: z.custom<ExtensionsView>() },
  [IPC_CHANNELS.policyView]: { args: z.tuple([]), result: z.custom<PolicyView>() },
  [IPC_CHANNELS.teamView]: { args: z.tuple([]), result: z.custom<TeamView>() },
  [IPC_CHANNELS.teamConnect]: {
    args: z.tuple([teamConnectSchema]),
    result: z.custom<TeamResult>(),
  },
  [IPC_CHANNELS.teamSetup]: { args: z.tuple([teamSetupSchema]), result: z.custom<TeamResult>() },
  [IPC_CHANNELS.teamSignIn]: { args: z.tuple([teamSignInSchema]), result: z.custom<TeamResult>() },
  [IPC_CHANNELS.teamSignOut]: { args: z.tuple([]), result: z.custom<TeamResult>() },
  [IPC_CHANNELS.teamLock]: { args: z.tuple([]), result: z.custom<TeamResult>() },
  [IPC_CHANNELS.teamUnlock]: {
    args: z.tuple([z.string().min(1).max(200)]),
    result: z.custom<TeamResult>(),
  },
  [IPC_CHANNELS.teamRedeem]: {
    args: z.tuple([teamRedeemSchema]),
    result: z.custom<TeamRedeemResult>(),
  },
  [IPC_CHANNELS.teamSyncNow]: { args: z.tuple([]), result: z.custom<TeamResult>() },
  [IPC_CHANNELS.teamSetIdleLock]: {
    args: z.tuple([z.number().int().min(1).max(240)]),
    result: z.custom<TeamResult>(),
  },
  [IPC_CHANNELS.teamDisconnect]: { args: z.tuple([]), result: z.custom<TeamResult>() },
  [IPC_CHANNELS.teamNoticesSeen]: { args: z.tuple([]), result: z.custom<TeamResult>() },
  [IPC_CHANNELS.teamPropose]: {
    args: z.tuple([teamProposeSchema]),
    result: z.custom<TeamProposeResult>(),
  },
  [IPC_CHANNELS.teamChangePassword]: {
    args: z.tuple([teamPasswordChangeSchema]),
    result: z.custom<TeamContentResult<null>>(),
  },
  [IPC_CHANNELS.teamPeople]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<TeamContentResult<TeamPerson[]>>(),
  },
  [IPC_CHANNELS.teamFolderCreate]: {
    args: z.tuple([teamFolderCreateSchema]),
    result: z.custom<TeamContentResult<SharedFolder>>(),
  },
  [IPC_CHANNELS.teamNoteRead]: {
    args: z.tuple([teamNoteReadSchema]),
    result: z.custom<TeamContentResult<SharedNote>>(),
  },
  [IPC_CHANNELS.teamSkillAdd]: {
    args: z.tuple([teamSkillAddSchema]),
    result: z.custom<SkillImportResult>(),
  },
  [IPC_CHANNELS.teamShareMeeting]: {
    args: z.tuple([teamShareMeetingSchema]),
    result: z.custom<TeamContentResult<{ id: string }>>(),
  },
  [IPC_CHANNELS.teamOpenAdmin]: {
    args: z.tuple([]),
    result: z.custom<{ ok: boolean; message?: string }>(),
  },
  [IPC_CHANNELS.briefOverview]: { args: z.tuple([]), result: z.custom<BriefOverview>() },
  [IPC_CHANNELS.briefGet]: {
    args: z.tuple([z.string().min(1).max(300)]),
    result: z.custom<MeetingBrief | null>(),
  },
  [IPC_CHANNELS.briefForMeeting]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<MeetingBrief | null>(),
  },
  [IPC_CHANNELS.briefBuild]: {
    args: z.tuple([z.string().min(1).max(300)]),
    result: z.custom<BriefResult>(),
  },
  [IPC_CHANNELS.briefOpen]: {
    args: z.tuple([z.string().min(1).max(600)]),
    result: z.custom<{ ok: boolean }>(),
  },
  [IPC_CHANNELS.briefTarget]: { args: z.tuple([]), result: z.custom<string | null>() },
  [IPC_CHANNELS.emailDraftState]: { args: z.tuple([]), result: z.custom<EmailDraftState>() },
  [IPC_CHANNELS.emailDraftPropose]: {
    args: z.tuple([emailDraftSourceSchema]),
    result: z.custom<EmailDraftProposalResult>(),
  },
  [IPC_CHANNELS.emailDraftCreate]: {
    args: z.tuple([emailDraftInputSchema]),
    result: z.custom<EmailDraftResult>(),
  },
  [IPC_CHANNELS.emailDraftList]: {
    args: z.tuple([emailDraftSourceSchema]),
    result: z.custom<EmailAutomationRecord[]>(),
  },
  [IPC_CHANNELS.emailDraftOpen]: {
    args: z.tuple([z.string().min(1).max(600)]),
    result: z.custom<{ ok: boolean }>(),
  },
  [IPC_CHANNELS.calendarEventState]: { args: z.tuple([]), result: z.custom<CalendarEventState>() },
  [IPC_CHANNELS.calendarEventPropose]: {
    args: z.tuple([calendarEventSourceSchema]),
    result: z.custom<CalendarEventProposalResult>(),
  },
  [IPC_CHANNELS.calendarEventCreate]: {
    args: z.tuple([calendarEventInputSchema]),
    result: z.custom<CalendarEventResult>(),
  },
  [IPC_CHANNELS.calendarEventList]: {
    args: z.tuple([calendarEventSourceSchema]),
    result: z.custom<CalendarEventRecord[]>(),
  },
  [IPC_CHANNELS.calendarEventOpen]: {
    args: z.tuple([z.string().min(1).max(600)]),
    result: z.custom<{ ok: boolean }>(),
  },
  [IPC_CHANNELS.mcpStatus]: { args: z.tuple([]), result: z.custom<McpStatus>() },
  [IPC_CHANNELS.mcpClients]: { args: z.tuple([]), result: z.custom<McpClientsView>() },
  [IPC_CHANNELS.mcpIssue]: {
    args: z.tuple([z.string().max(200), z.enum(["claude-desktop", "cursor", "other"])]),
    result: z.custom<McpActionResult>(),
  },
  [IPC_CHANNELS.mcpRotate]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<McpActionResult>(),
  },
  [IPC_CHANNELS.mcpRevoke]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<McpActionResult>(),
  },
  [IPC_CHANNELS.mcpCopyToken]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<McpActionResult>(),
  },
  [IPC_CHANNELS.mcpConfigPreview]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<McpConfigPreviewResult>(),
  },
  [IPC_CHANNELS.mcpConfigWrite]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<McpActionResult>(),
  },
  [IPC_CHANNELS.mcpAudit]: { args: z.tuple([]), result: z.custom<McpAuditEntry[]>() },
  [IPC_CHANNELS.mcpAuditClear]: { args: z.tuple([]), result: z.void() },
  [IPC_CHANNELS.meetingMove]: {
    args: z.tuple([z.string().min(1).max(64), z.string().min(1).max(64).nullable()]),
    result: z.custom<FolderResult>(),
  },
  [IPC_CHANNELS.meetingFolderDismiss]: {
    args: z.tuple([z.string().min(1).max(64), z.string().min(1).max(64)]),
    result: z.void(),
  },
  [IPC_CHANNELS.meetingRecap]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<MeetingRecapResult>(),
  },
  [IPC_CHANNELS.meetingImportPreview]: {
    args: z.tuple([]),
    result: z.custom<TranscriptImportPreviewResult>(),
  },
  [IPC_CHANNELS.meetingImportConfirm]: {
    args: z.tuple([transcriptImportConfirmSchema]),
    result: z.custom<TranscriptImportConfirmResult>(),
  },
  [IPC_CHANNELS.meetingImportCancel]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.void(),
  },
  [IPC_CHANNELS.meetingRetentionDue]: {
    args: z.tuple([]),
    result: z.custom<MeetingRetentionDue>(),
  },
  [IPC_CHANNELS.meetingExport]: {
    args: z.tuple([z.string().min(1).max(64), meetingExportOptionsSchema]),
    result: z.custom<MeetingExportResult>(),
  },
  [IPC_CHANNELS.meetingSetLanguage]: {
    args: z.tuple([z.string().min(1).max(64), meetingLanguageSchema]),
    result: z.custom<RerunResult>(),
  },
  [IPC_CHANNELS.meetingRerun]: {
    args: z.tuple([z.string().min(1).max(64), meetingLanguageSchema]),
    result: z.custom<RerunResult>(),
  },
  [IPC_CHANNELS.meetingVersionRestore]: {
    args: z.tuple([z.string().min(1).max(64), z.number().int().min(1)]),
    result: z.custom<RerunResult>(),
  },
  [IPC_CHANNELS.meetingSegmentHistory]: {
    args: z.tuple([z.string().min(1).max(64), z.string().min(1).max(200)]),
    result: z.custom<SegmentHistoryItem[]>(),
  },
  [IPC_CHANNELS.meetingCorrectionRevert]: {
    args: z.tuple([z.string().min(1).max(64), z.number().int().min(1)]),
    result: z.custom<RevertResult>(),
  },
  [IPC_CHANNELS.askThreads]: { args: z.tuple([]), result: z.custom<AskThreadItem[]>() },
  [IPC_CHANNELS.askThread]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<AskThread | null>(),
  },
  [IPC_CHANNELS.askSend]: { args: z.tuple([askSendSchema]), result: z.custom<AskSendResult>() },
  [IPC_CHANNELS.askDelete]: { args: z.tuple([z.string().min(1).max(64)]), result: z.void() },
  [IPC_CHANNELS.meetingFindTasks]: {
    args: z.tuple([z.string().min(1).max(64)]),
    result: z.custom<MeetingFindTasksResult>(),
  },
  [IPC_CHANNELS.meetingNotesSave]: {
    args: z.tuple([meetingIdArg, z.string().max(200_000)]),
    result: z.boolean(),
  },
  [IPC_CHANNELS.meetingDocAddLink]: {
    args: z.tuple([meetingIdArg, z.string().max(2048), z.string().max(200)]),
    result: z.custom<MeetingDocResult>(),
  },
  [IPC_CHANNELS.meetingDocAddFile]: {
    args: z.tuple([meetingIdArg]),
    result: z.custom<MeetingDocResult>(),
  },
  [IPC_CHANNELS.meetingDocOpen]: { args: z.tuple([meetingIdArg]), result: z.void() },
  [IPC_CHANNELS.meetingDocRemove]: { args: z.tuple([meetingIdArg]), result: z.void() },
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
  /** Help, Report a problem (HB-08): a local diagnostics bundle, sent nowhere. */
  reportProblem(): Promise<TestingToolResult>;
  /** A Testing page tool (HB-55); developer mode only. */
  testingTool(tool: TestingTool): Promise<TestingToolResult>;
  /** The accessibility inspector (HB-56): the app in front now; null when it cannot. */
  axInspect(showValues: boolean): Promise<AxInspectResult | null>;
  /** The Plans page (HB-19): tier, this week's words against the limit, trial and log. */
  planView(): Promise<PlanView>;
  /** Starts, extends or ends the trial, or sets the student label. */
  planAct(action: PlanAction): Promise<PlanView>;
  /** Exports the chosen categories to a folder the user picks (HB-46). */
  dataExport(request: ExportRequest): Promise<ExportResult>;
  /** Counts and sizes of each category that can be deleted (HB-47). */
  dataCounts(): Promise<DataCounts>;
  /** Deletes one category for good. */
  dataDelete(category: DeleteCategory): Promise<DeleteResult>;
  /** Deletes every category and the settings, then restarts at first run. */
  dataReset(request: ResetRequest): Promise<DeleteResult>;
  /** Tries again to remove files a delete could not; returns how many are left. */
  dataRetryFailed(): Promise<number>;
  /** The data folder and the size of each part (HB-49). */
  storageView(): Promise<StorageView>;
  /** Shows the data folder in Finder. */
  storageOpen(): Promise<void>;
  /** The retention job's last run and what it removed (HB-50). */
  retentionView(): Promise<RetentionView>;
  /** Runs the retention job now. */
  retentionRun(): Promise<RetentionView>;
  /** Scratchpad notes (HB-26, HB-31): pinned and newest first, or matching a search. */
  notesList(query: string): Promise<NoteSummary[]>;
  noteGet(id: string): Promise<Note | null>;
  noteCreate(input: NoteCreate): Promise<{ ok: true; note: Note } | { ok: false; message: string }>;
  noteSave(input: NoteSave): Promise<NoteSaveResult>;
  noteDelete(id: string): Promise<void>;
  /** Note versions (HB-28), newest first. */
  noteVersions(noteId: string): Promise<NoteVersion[]>;
  /** Saves a version now; null when nothing changed (or too soon, for `auto`). */
  noteVersionSave(input: NoteVersionSave): Promise<NoteVersion | null>;
  noteVersionText(id: string): Promise<NoteVersionText | null>;
  /** Puts a version back, as a new version; returns the note. */
  noteVersionRestore(id: string): Promise<Note | null>;
  /** Pins or unpins a note (HB-29). */
  notePin(noteId: string, pinned: boolean): Promise<NotePinResult>;
  notePinMove(noteId: string, step: -1 | 1): Promise<void>;
  /** Adds an image to a note (HB-30): scaled, re-encoded without metadata, stored locally. */
  noteImageAdd(input: NoteImageAdd): Promise<NoteImageResult>;
  /** A stored image as a data URL, or null. */
  noteImageData(id: string): Promise<string | null>;
  /** Rewrites offered inside a note (HB-32), Clarify, Tighten and Structure first. */
  noteRewrites(): Promise<NoteRewriteChoice[]>;
  /** Runs a Rewrite on text from a note; the note itself is not changed. */
  noteRewriteRun(input: NoteRewriteRun): Promise<NoteRewriteResult>;
  /** What became of a Rewrite result; Replace also saves a version. */
  noteRewriteRecord(input: NoteRewriteRecord): Promise<void>;
  /** Saves a note as Markdown (images in a folder beside it) or HTML, where the user picks. */
  noteExport(input: NoteExport): Promise<{ saved: boolean }>;
  /** Makes a note from a Markdown file's text (HB-27). */
  noteImport(input: NoteImport): Promise<{ ok: true; note: Note } | { ok: false; message: string }>;
  /** Opens the Scratchpad window, on a note when given. */
  scratchpadOpen(noteId: string | null): Promise<void>;
  /** The Scratchpad window is asked to show a note. Returns an unsubscribe. */
  onScratchpadOpenNote(handler: (noteId: string) => void): () => void;
  /** Home (HB-02): today's counts and the last dictation. */
  homeView(): Promise<HomeView>;
  /** Transcribes a failed dictation's recording again and updates its row (HB-03). */
  historyRetry(id: string): Promise<HistoryRetryResult>;
  /** The dictation state now, as the Bar shows it. */
  dictationState(): Promise<DictationState>;
  /** The dictation state as it changes. Returns an unsubscribe. */
  onDictationState(handler: (state: DictationState) => void): () => void;
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
  /** Notetaker (M5): meetings newest first, with transcription progress. */
  meetingsList(): Promise<MeetingListItem[]>;
  meetingDetail(id: string): Promise<MeetingDetail | null>;
  meetingRecording(): Promise<RecordingState>;
  meetingStart(): Promise<MeetingStartResult>;
  meetingStop(): Promise<void>;
  /** A rename by the owner; a later summary will not change it (NT-03). */
  meetingRename(id: string, title: string): Promise<void>;
  /** Deletes the meeting, its transcript, notes, docs and audio. */
  meetingDelete(id: string): Promise<void>;
  /**
   * NT-09: writes a summary now, as a new version (the Skill defaults to the setting). `quick`
   * summarises what is transcribed so far, during a meeting. Resolves when it is stored.
   */
  meetingSummarize(
    id: string,
    options: { skillId?: string; quick?: boolean },
  ): Promise<MeetingSummarizeResult>;
  meetingSummaryFeedback(summaryId: string, feedback: SummaryFeedback | null): Promise<void>;
  /** NT-15: the built-in Skills, then the owner's copies. */
  skillsList(): Promise<Skill[]>;
  /** NT-16: makes a custom Skill (`id` null) or edits one into its next version. */
  skillSave(id: string | null, draft: SkillDraft): Promise<SkillResult>;
  skillDuplicate(id: string): Promise<SkillResult>;
  skillDelete(id: string): Promise<{ ok: true } | { ok: false; message: string }>;
  /** The versions a custom Skill had before the current one, newest first. */
  skillVersions(id: string): Promise<SkillVersion[]>;
  skillRestore(id: string, version: number): Promise<SkillResult>;
  /** Asks where to save the Skill's `.md` file. */
  skillExport(id: string): Promise<SkillExportResult>;
  /** Asks for a `.md` file and makes a custom Skill of it; a bad file names the line. */
  skillImport(): Promise<SkillImportResult>;
  /** NT-26: tasks across meetings, in the owner's order, and what Undo would take back. */
  tasksList(filter: TaskFilter): Promise<TasksView>;
  taskAdd(draft: TaskDraft): Promise<TaskResult>;
  taskUpdate(id: string, draft: TaskDraft): Promise<TaskResult>;
  taskAction(id: string, action: TaskAction): Promise<TaskResult>;
  /** Puts a task before another, or last when `beforeId` is null. */
  taskReorder(id: string, beforeId: string | null): Promise<TaskResult>;
  /** Takes back the last of up to 20 actions. */
  tasksUndo(): Promise<{ ok: true; label: string } | { ok: false }>;
  /** Looks for tasks in a meeting now (the job runs behind the summary and the model). */
  meetingFindTasks(meetingId: string): Promise<MeetingFindTasksResult>;
  /** NT-14: the saved conversations of Ask, newest first. */
  askThreads(): Promise<AskThreadItem[]>;
  askThread(id: string): Promise<AskThread | null>;
  /** Answers a question from the meetings in its scope (a few seconds to a minute). */
  askSend(input: AskSendInput): Promise<AskSendResult>;
  askDelete(id: string): Promise<void>;
  /** NT-07: gives a speaker a name for the whole meeting (every line of theirs, at once). */
  meetingSpeakerRename(
    meetingId: string,
    speakerId: string,
    name: string,
  ): Promise<SpeakerRenameResult>;
  /** NT-08: a sample of a speaker from the stored audio; not available once it is deleted. */
  meetingSpeakerClip(meetingId: string, speakerId: string): Promise<SpeakerClipResult>;
  /** NT-24: edits a line's text or speaker, splits it, or merges it with the next one. */
  meetingCorrect(meetingId: string, correction: Correction): Promise<CorrectionResult>;
  /** NT-20: how a meeting still being recorded is transcribed from now on. */
  meetingSetLanguage(meetingId: string, input: MeetingLanguageInput): Promise<RerunResult>;
  /** NT-17: the personal folders, with how many meetings each has. The Inbox is not listed. */
  foldersList(): Promise<MeetingFolder[]>;
  folderCreate(name: string): Promise<FolderResult>;
  folderRename(id: string, name: string): Promise<FolderResult>;
  /** The meetings in it go to the Inbox. */
  folderDelete(id: string): Promise<FolderResult>;
  folderUpdate(id: string, patch: FolderPatch): Promise<FolderResult>;
  /** Asks for a folder on disk where a file is written after each meeting of this folder. */
  folderChooseExport(id: string): Promise<FolderResult>;
  folderClearExport(id: string): Promise<FolderResult>;
  /** CN-15: every connector with its accounts and state. No token is ever in it. */
  connectorsView(): Promise<ConnectorsView>;
  /** Opens the provider's sign-in in the system browser and resolves when it ends. */
  connectorConnect(id: string, loginHint?: string): Promise<ConnectorActionResult>;
  /** Stops a sign-in that is waiting for the browser. */
  connectorCancel(id: string): Promise<void>;
  /** Revokes the sign-in at the provider, deletes the Keychain item and the cache. */
  connectorDisconnect(accountId: string): Promise<ConnectorActionResult>;
  connectorSetEnabled(accountId: string, enabled: boolean): Promise<void>;
  /** The OAuth client id of the owner's own app; null removes it. */
  connectorSetClientId(id: string, clientId: string | null): Promise<ConnectorActionResult>;
  /** The client secret goes to the Keychain and is never sent back; null removes it. */
  connectorSetClientSecret(id: string, secret: string | null): Promise<ConnectorActionResult>;
  /** CN-02, CN-03: reads a calendar account's events now. */
  connectorSync(accountId: string): Promise<ConnectorActionResult>;
  /** CN-10: signs in with a personal key (Fireflies). The key goes to the Keychain and is never sent back. */
  connectorConnectKey(id: string, key: string): Promise<ConnectorActionResult>;
  /** CN-09, CN-10: the meetings of a Zoom or Fireflies account that could be imported. Downloads nothing. */
  connectorRecordings(accountId: string): Promise<RecordingsResult>;
  /** CN-09, CN-10: fetches one meeting and describes it like a transcript file; confirm it with `meetingImportConfirm`. */
  connectorImportPrepare(
    accountId: string,
    remoteId: string,
  ): Promise<TranscriptImportPreviewResult>;
  /** CN-05, CN-07: the channels or teams an account offers for the owner to select. */
  connectorOptions(accountId: string): Promise<ConnectorOptionsResult>;
  /** CN-05 to CN-08: how many items each Slack, Notion, Linear and GitHub account has kept, and when it was read. */
  connectorDataStatus(): Promise<ConnectorDataStatus[]>;
  /** CN-13: a connector action proposed from a request typed in Ask, or none. Behind the experimental option; sends and creates nothing. */
  askActionPropose(request: AskActionRequest): Promise<AskActionResult>;
  /** CN-05: whether "Send to Slack" works now, and why not. */
  slackPostState(): Promise<EmailDraftState>;
  /** CN-05: a starting message for a task or a summary and the channels to send to. Sends nothing. */
  slackPostStart(source: SlackPostSource): Promise<SlackStartResult>;
  /** CN-05, CN-14: the preview of a message: the exact text, the channel and every tag. Sends nothing. */
  slackPostPrepare(input: SlackPrepareInput): Promise<SlackPrepareResult>;
  /** CN-05: posts the message of a preview. This is the click that confirms it. */
  slackPostSend(input: SlackSendInput): Promise<SlackSendResult>;
  /** CN-12: the built-in actions connected apps can do, with their state. They are switched in settings. */
  extensionsView(): Promise<ExtensionsView>;
  /** Team mode (TM-01, TM-06). */
  /** TM-13 to TM-16, TM-21: what the managed file and the team policy set (shown, not changed). */
  policyView(): Promise<PolicyView>;
  teamView(): Promise<TeamView>;
  teamConnect(input: { serverUrl: string; projectKey?: string }): Promise<TeamResult>;
  teamSetup(input: { name: string; email: string; password: string }): Promise<TeamResult>;
  teamSignIn(input: { email: string; password: string }): Promise<TeamResult>;
  teamSignOut(): Promise<TeamResult>;
  teamLock(): Promise<TeamResult>;
  teamUnlock(password: string): Promise<TeamResult>;
  teamRedeem(input: {
    code: string;
    name?: string;
    email?: string;
    password?: string;
  }): Promise<TeamRedeemResult>;
  teamSyncNow(): Promise<TeamResult>;
  teamSetIdleLock(minutes: number): Promise<TeamResult>;
  teamDisconnect(): Promise<TeamResult>;
  teamNoticesSeen(): Promise<TeamResult>;
  /** TM-11: opens the team server's admin console in the browser (for admins; the server decides). */
  teamOpenAdmin(): Promise<{ ok: boolean; message?: string }>;
  /** TM-06, TM-07: proposes a dictionary entry or snippet to the person's team. */
  teamPropose(input: TeamProposeInput): Promise<TeamProposeResult>;
  /** Changes the signed-in person's own password on the team backend. */
  teamChangePassword(input: TeamPasswordChangeInput): Promise<TeamContentResult<null>>;
  /** NT-17: the people in a team, to choose who is in a shared folder. */
  teamPeople(teamId: string): Promise<TeamContentResult<TeamPerson[]>>;
  /** NT-17: makes a shared folder for named people. */
  teamFolderCreate(input: TeamFolderCreateInput): Promise<TeamContentResult<SharedFolder>>;
  /** NT-17: one shared note, with its text. */
  teamNoteRead(input: TeamNoteReadInput): Promise<TeamContentResult<SharedNote>>;
  /** NT-16: copies a team's Skill into the person's own Skills. */
  teamSkillAdd(input: TeamSkillAddInput): Promise<SkillImportResult>;
  /** NT-17: shares a meeting's summary and tasks (text, never audio) into a team folder. */
  teamShareMeeting(input: TeamShareMeetingInput): Promise<TeamContentResult<{ id: string }>>;
  /** The team state changed: locked, signed in or out, or a sync finished. */
  onTeamChanged(handler: (view: TeamView) => void): () => void;
  onPolicyChanged(handler: (view: PolicyView) => void): () => void;
  /** NT-11: the meetings that are coming, whether each has a brief, and each source's state. */
  briefOverview(): Promise<BriefOverview>;
  /** NT-11: the brief last built for a meeting, or null. */
  briefGet(eventKey: string): Promise<MeetingBrief | null>;
  /** NT-11: the brief of the calendar event a recorded meeting was started from, or null. */
  briefForMeeting(meetingId: string): Promise<MeetingBrief | null>;
  /** NT-11: builds the brief of a meeting now. */
  briefBuild(eventKey: string): Promise<BriefResult>;
  /** NT-11: opens a source of a brief in the browser. Only addresses of the connected services are opened. */
  briefOpen(url: string): Promise<{ ok: boolean }>;
  /** NT-11: the meeting the menu bar asked the Brief tab to show, once; null when none. */
  briefTarget(): Promise<string | null>;
  /** NT-27: whether "Draft email" works now, and why not when it does not. */
  emailDraftState(): Promise<EmailDraftState>;
  /** NT-27: the words and the people for a draft, from a task or a meeting's summary. Creates nothing. */
  emailDraftPropose(source: EmailDraftSource): Promise<EmailDraftProposalResult>;
  /** NT-27: creates the draft the owner confirmed in Gmail's Drafts folder. Mail is never sent. */
  emailDraftCreate(input: EmailDraftInput): Promise<EmailDraftResult>;
  /** NT-27: the drafts already made from a task or a meeting. */
  emailDraftList(source: EmailDraftSource): Promise<EmailAutomationRecord[]>;
  /** NT-27: opens a draft in the browser. Only an address in Gmail is opened. */
  emailDraftOpen(url: string): Promise<{ ok: boolean }>;
  /** NT-28: whether "Create event" works now, and why not when it does not. */
  calendarEventState(): Promise<CalendarEventState>;
  /** NT-28: a starting form for an event from a task or a meeting. Creates nothing. */
  calendarEventPropose(source: CalendarEventSource): Promise<CalendarEventProposalResult>;
  /** NT-28: creates the event the owner confirmed. People are told only when the setting and the confirmation both say so. */
  calendarEventCreate(input: CalendarEventInput): Promise<CalendarEventResult>;
  /** NT-28: the events already made from a task or a meeting. */
  calendarEventList(source: CalendarEventSource): Promise<CalendarEventRecord[]>;
  /** NT-28: opens an event in the calendar. Only the calendar services' own addresses are opened. */
  calendarEventOpen(url: string): Promise<{ ok: boolean }>;
  /** CN-11: whether the local MCP server is listening, and where, once a change of setting has been applied. Its switches are in settings. */
  mcpStatus(): Promise<McpStatus>;
  /** The apps the owner approved. Tokens are never in it. */
  mcpClients(): Promise<McpClientsView>;
  /** Approves an app: makes its token and keeps it in the Keychain. */
  mcpIssue(name: string, kind: McpClientKind): Promise<McpActionResult>;
  /** A new token; the old one stops working at once. */
  mcpRotate(id: string): Promise<McpActionResult>;
  /** The app can no longer use Murmur, at once. */
  mcpRevoke(id: string): Promise<McpActionResult>;
  /** Puts the app's token on the clipboard, which is cleared after a minute. The window never sees it. */
  mcpCopyToken(id: string): Promise<McpActionResult>;
  /** What writing the app's config file would change, for the owner to approve. Writes nothing. */
  mcpConfigPreview(id: string): Promise<McpConfigPreviewResult>;
  /** Writes the file a preview showed, if it has not changed since. */
  mcpConfigWrite(previewId: string): Promise<McpActionResult>;
  /** The last calls apps made: names and sizes, never contents. */
  mcpAudit(): Promise<McpAuditEntry[]>;
  mcpAuditClear(): Promise<void>;
  /** Puts a meeting in a folder, or in the Inbox (null). */
  meetingMove(meetingId: string, folderId: string | null): Promise<FolderResult>;
  /** Stops offering this folder for meetings like this one. */
  meetingFolderDismiss(meetingId: string, folderId: string): Promise<void>;
  /** NT-18: asks where to save a shareable HTML file of the meeting and writes it. */
  meetingExport(meetingId: string, options: MeetingExportOptions): Promise<MeetingExportResult>;
  /** NT-22: how many recordings and transcripts the next 24 hours will delete. */
  meetingRetentionDue(): Promise<MeetingRetentionDue>;
  /** NT-21: asks for a transcript file and says what is in it, without creating anything. */
  meetingImportPreview(): Promise<TranscriptImportPreviewResult>;
  /** NT-13: writes a short recap of the last minutes of a meeting (a few seconds). */
  meetingRecap(meetingId: string): Promise<MeetingRecapResult>;
  /** Makes the meeting from the file just previewed. */
  meetingImportConfirm(input: TranscriptImportConfirmInput): Promise<TranscriptImportConfirmResult>;
  meetingImportCancel(token: string): Promise<void>;
  /** NT-23: transcribes a finished meeting again from its saved audio, as a new version. */
  meetingRerun(meetingId: string, input: MeetingLanguageInput): Promise<RerunResult>;
  /** NT-23: puts a transcript a rerun replaced back. */
  meetingVersionRestore(meetingId: string, versionId: number): Promise<RerunResult>;
  /** The corrections a line has been through, newest first. */
  meetingSegmentHistory(meetingId: string, segmentId: string): Promise<SegmentHistoryItem[]>;
  /** Takes back one correction, the newest of its lines. */
  meetingCorrectionRevert(meetingId: string, correctionId: number): Promise<RevertResult>;
  /** NT-10: saves My notes; false when they are too long. */
  meetingNotesSave(id: string, body: string): Promise<boolean>;
  meetingDocAddLink(id: string, url: string, title: string): Promise<MeetingDocResult>;
  /** Asks for a file and copies it into the meeting. */
  meetingDocAddFile(id: string): Promise<MeetingDocResult>;
  meetingDocOpen(docId: string): Promise<void>;
  meetingDocRemove(docId: string): Promise<void>;
  /** A meeting changed: its status, transcript, or the recording. `null` for the list. */
  onMeetingsChanged(handler: (meetingId: string | null) => void): () => void;
  /** NT-06: new grey text for the chunk being recorded. */
  onMeetingLive(handler: (partial: LivePartial) => void): () => void;
}

/** Main-to-Hub messages (no reply). */
export const IPC_EVENTS = {
  micCheckLevel: "mic-check:level",
  dictationState: "dictation:state-changed",
  scratchpadOpenNote: "scratchpad:open-note",
  openPage: "hub:open-page",
  meetingsChanged: "meetings:changed",
  meetingLive: "meetings:live",
  teamChanged: "team:changed",
  policyChanged: "policy:changed",
} as const;
