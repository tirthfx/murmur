import {
  IPC_CHANNELS,
  parseIpcRequest,
  type MeetingDetail,
  type MeetingSummarizeResult,
  type Skill,
  type SkillDraft,
  type SkillExportResult,
  type SkillImportResult,
  type SkillResult,
  type SkillVersion,
  type AskSendInput,
  type AskSendResult,
  type AskThread,
  type AskThreadItem,
  type FolderPatch,
  type FolderResult,
  type MeetingExportOptions,
  type MeetingExportResult,
  type MeetingFolder,
  type MeetingRecapResult,
  type MeetingRetentionDue,
  type TranscriptImportConfirmInput,
  type TranscriptImportConfirmResult,
  type TranscriptImportPreviewResult,
  type MeetingFindTasksResult,
  type MeetingLanguageInput,
  type RerunResult,
  type Correction,
  type CorrectionResult,
  type RevertResult,
  type SegmentHistoryItem,
  type SpeakerClipResult,
  type SpeakerRenameResult,
  type TaskAction,
  type TaskDraft,
  type TaskFilter,
  type TaskResult,
  type TasksView,
  type SummaryFeedback,
  type MeetingDocResult,
  type MeetingListItem,
  type MeetingStartResult,
  type RecordingState,
  type AppInfo,
  type LoginItem,
  type HistoryDeleteResult,
  type HistoryFeedback,
  type HistoryPage,
  type HistoryQuery,
  type InsightsExportResult,
  type InsightsRange,
  type InsightsView,
  type Milestone,
  type DictationState,
  type HistoryRetryResult,
  type HomeView,
  type RetentionView,
  type DataCounts,
  type PlanAction,
  type TestingTool,
  type TestingToolResult,
  type AxInspectResult,
  type PlanView,
  type DeleteCategory,
  type DeleteResult,
  type ExportRequest,
  type ExportResult,
  type ResetRequest,
  type StorageView,
  type Note,
  type NoteCreate,
  type NoteSave,
  type NoteSaveResult,
  type NoteSummary,
  type NotePinResult,
  type NoteImageAdd,
  type NoteRewriteChoice,
  type NoteRewriteRun,
  type NoteRewriteResult,
  type NoteRewriteRecord,
  type NoteExport,
  type NoteImport,
  type NoteImageResult,
  type NoteVersion,
  type NoteVersionSave,
  type NoteVersionText,
  type CapturedKey,
  type InstructModelStatus,
  type FocusAddResult,
  type FocusAppInput,
  type FocusDuration,
  type FocusRule,
  type FocusSiteInput,
  type FocusSitesView,
  type FocusState,
  type InstalledApp,
  type InstructThread,
  type InstructThreadSummary,
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
  type Rewrite,
  type RewriteInput,
  type RewriteSaveResult,
  type RewriteShortcutResult,
  type RewriteAutoApply,
  type ImportPreview,
  type ImportRequest,
  type ImportResult,
  type VoiceProfileView,
  type DictionaryClipResult,
  type WritingSample,
  type WritingSampleInput,
  type WritingSampleSaveResult,
  type ShortcutResult,
  type ShortcutSlot,
  type PermissionKind,
  type PermissionsInfo,
  type RequestablePermissionKind,
  type BriefOverview,
  type BriefResult,
  type CalendarEventInput,
  type CalendarEventProposalResult,
  type CalendarEventRecord,
  type CalendarEventResult,
  type CalendarEventSource,
  type CalendarEventState,
  type ConnectorActionResult,
  type RecordingsResult,
  type ConnectorDataStatus,
  type ConnectorOptionsResult,
  type AskActionRequest,
  type AskActionResult,
  type EmailAutomationRecord,
  type SlackPostSource,
  type SlackPrepareInput,
  type SlackPrepareResult,
  type SlackSendInput,
  type SlackSendResult,
  type SlackStartResult,
  type ExtensionsView,
  type TeamConnectInput,
  type TeamRedeemInput,
  type TeamRedeemResult,
  type TeamResult,
  type TeamSetupInput,
  type TeamSignInInput,
  type PolicyView,
  type TeamProposeInput,
  type TeamProposeResult,
  type TeamView,
  isLockedChannel,
  type MeetingBrief,
  type EmailDraftInput,
  type EmailDraftProposalResult,
  type EmailDraftResult,
  type EmailDraftSource,
  type EmailDraftState,
  type ConnectorsView,
  type McpActionResult,
  type McpAuditEntry,
  type McpClientKind,
  type McpClientsView,
  type McpConfigPreviewResult,
  type McpStatus,
} from "@murmur/shared";
import { isTrustedIpcSender } from "../security/guards";

export interface IpcDeps {
  meetingsList: () => MeetingListItem[];
  meetingDetail: (id: string) => MeetingDetail | null;
  meetingRecording: () => RecordingState;
  meetingStart: () => Promise<MeetingStartResult>;
  meetingStop: () => Promise<void>;
  meetingRename: (id: string, title: string) => void;
  meetingSummarize: (
    id: string,
    options: { skillId?: string; quick?: boolean },
  ) => Promise<MeetingSummarizeResult>;
  meetingSummaryFeedback: (summaryId: string, feedback: SummaryFeedback | null) => void;
  skillsList: () => Skill[];
  skillSave: (id: string | null, draft: SkillDraft) => SkillResult;
  skillDuplicate: (id: string) => SkillResult;
  skillDelete: (id: string) => { ok: true } | { ok: false; message: string };
  skillVersions: (id: string) => SkillVersion[];
  skillRestore: (id: string, version: number) => SkillResult;
  skillExport: (id: string) => Promise<SkillExportResult>;
  skillImport: () => Promise<SkillImportResult>;
  tasksList: (filter: TaskFilter) => TasksView;
  taskAdd: (draft: TaskDraft) => TaskResult;
  taskUpdate: (id: string, draft: TaskDraft) => TaskResult;
  taskAction: (id: string, action: TaskAction) => TaskResult;
  taskReorder: (id: string, beforeId: string | null) => TaskResult;
  tasksUndo: () => { ok: true; label: string } | { ok: false };
  meetingFindTasks: (meetingId: string) => MeetingFindTasksResult;
  askThreads: () => AskThreadItem[];
  askThread: (id: string) => AskThread | null;
  askSend: (input: AskSendInput) => Promise<AskSendResult>;
  askDelete: (id: string) => void;
  meetingSpeakerRename: (meetingId: string, speakerId: string, name: string) => SpeakerRenameResult;
  meetingSpeakerClip: (meetingId: string, speakerId: string) => SpeakerClipResult;
  meetingCorrect: (meetingId: string, correction: Correction) => CorrectionResult;
  meetingSetLanguage: (meetingId: string, input: MeetingLanguageInput) => RerunResult;
  foldersList: () => MeetingFolder[];
  folderCreate: (name: string) => FolderResult;
  folderRename: (id: string, name: string) => FolderResult;
  folderDelete: (id: string) => FolderResult;
  folderUpdate: (id: string, patch: FolderPatch) => FolderResult;
  folderChooseExport: (id: string) => Promise<FolderResult>;
  folderClearExport: (id: string) => FolderResult;
  connectorsView: () => Promise<ConnectorsView>;
  mcpStatus: () => Promise<McpStatus>;
  mcpClients: () => McpClientsView;
  mcpIssue: (name: string, kind: McpClientKind) => Promise<McpActionResult>;
  mcpRotate: (id: string) => Promise<McpActionResult>;
  mcpRevoke: (id: string) => Promise<McpActionResult>;
  mcpCopyToken: (id: string) => Promise<McpActionResult>;
  mcpConfigPreview: (id: string) => Promise<McpConfigPreviewResult>;
  mcpConfigWrite: (previewId: string) => Promise<McpActionResult>;
  mcpAudit: () => McpAuditEntry[];
  mcpAuditClear: () => void;
  connectorConnect: (id: string, loginHint?: string) => Promise<ConnectorActionResult>;
  connectorCancel: (id: string) => void;
  connectorDisconnect: (accountId: string) => Promise<ConnectorActionResult>;
  connectorSetEnabled: (accountId: string, enabled: boolean) => void;
  connectorSync: (accountId: string) => Promise<ConnectorActionResult>;
  connectorOptions: (accountId: string) => Promise<ConnectorOptionsResult>;
  connectorConnectKey: (id: string, key: string) => Promise<ConnectorActionResult>;
  connectorRecordings: (accountId: string) => Promise<RecordingsResult>;
  connectorImportPrepare: (
    accountId: string,
    remoteId: string,
  ) => Promise<TranscriptImportPreviewResult>;
  connectorDataStatus: () => ConnectorDataStatus[];
  askActionPropose: (request: AskActionRequest) => Promise<AskActionResult>;
  slackPostState: () => EmailDraftState;
  slackPostStart: (source: SlackPostSource) => Promise<SlackStartResult>;
  slackPostPrepare: (input: SlackPrepareInput) => Promise<SlackPrepareResult>;
  slackPostSend: (input: SlackSendInput) => Promise<SlackSendResult>;
  extensionsView: () => ExtensionsView;
  policyView: () => PolicyView;
  teamView: () => TeamView;
  teamConnect: (input: TeamConnectInput) => Promise<TeamResult>;
  teamSetup: (input: TeamSetupInput) => Promise<TeamResult>;
  teamSignIn: (input: TeamSignInInput) => Promise<TeamResult>;
  teamSignOut: () => Promise<TeamResult>;
  teamLock: () => TeamResult;
  teamUnlock: (password: string) => Promise<TeamResult>;
  teamRedeem: (input: TeamRedeemInput) => Promise<TeamRedeemResult>;
  teamSyncNow: () => Promise<TeamResult>;
  teamSetIdleLock: (minutes: number) => TeamResult;
  teamDisconnect: () => Promise<TeamResult>;
  teamNoticesSeen: () => Promise<TeamResult>;
  teamOpenAdmin: () => Promise<{ ok: boolean; message?: string }>;
  teamPropose: (input: TeamProposeInput) => Promise<TeamProposeResult>;
  /** Whether Murmur is locked (team mode): meetings, notes and questions are refused. */
  isLocked?: () => boolean;
  briefOverview: () => BriefOverview;
  briefGet: (eventKey: string) => MeetingBrief | null;
  briefBuild: (eventKey: string) => Promise<BriefResult>;
  briefForMeeting: (meetingId: string) => MeetingBrief | null;
  briefOpen: (url: string) => Promise<{ ok: boolean }>;
  briefTarget: () => string | null;
  emailDraftState: () => EmailDraftState;
  emailDraftPropose: (source: EmailDraftSource) => Promise<EmailDraftProposalResult>;
  emailDraftCreate: (input: EmailDraftInput) => Promise<EmailDraftResult>;
  emailDraftList: (source: EmailDraftSource) => EmailAutomationRecord[];
  emailDraftOpen: (url: string) => Promise<{ ok: boolean }>;
  calendarEventState: () => CalendarEventState;
  calendarEventPropose: (source: CalendarEventSource) => Promise<CalendarEventProposalResult>;
  calendarEventCreate: (input: CalendarEventInput) => Promise<CalendarEventResult>;
  calendarEventList: (source: CalendarEventSource) => CalendarEventRecord[];
  calendarEventOpen: (url: string) => Promise<{ ok: boolean }>;
  connectorSetClientId: (id: string, clientId: string | null) => Promise<ConnectorActionResult>;
  connectorSetClientSecret: (id: string, secret: string | null) => Promise<ConnectorActionResult>;
  meetingMove: (meetingId: string, folderId: string | null) => FolderResult;
  meetingFolderDismiss: (meetingId: string, folderId: string) => void;
  meetingExport: (meetingId: string, options: MeetingExportOptions) => Promise<MeetingExportResult>;
  meetingRetentionDue: () => MeetingRetentionDue;
  meetingImportPreview: () => Promise<TranscriptImportPreviewResult>;
  meetingRecap: (meetingId: string) => Promise<MeetingRecapResult>;
  meetingImportConfirm: (input: TranscriptImportConfirmInput) => TranscriptImportConfirmResult;
  meetingImportCancel: (token: string) => void;
  meetingRerun: (meetingId: string, input: MeetingLanguageInput) => RerunResult;
  meetingVersionRestore: (meetingId: string, versionId: number) => RerunResult;
  meetingSegmentHistory: (meetingId: string, segmentId: string) => SegmentHistoryItem[];
  meetingCorrectionRevert: (meetingId: string, correctionId: number) => RevertResult;
  meetingDelete: (id: string) => void;
  meetingNotesSave: (id: string, body: string) => boolean;
  meetingDocAddLink: (id: string, url: string, title: string) => MeetingDocResult;
  meetingDocAddFile: (id: string) => Promise<MeetingDocResult>;
  meetingDocOpen: (docId: string) => Promise<void>;
  meetingDocRemove: (docId: string) => void;
  entryUrl: string;
  getAppInfo: () => AppInfo;
  reportProblem: () => Promise<TestingToolResult>;
  testingTool: (tool: TestingTool) => Promise<TestingToolResult>;
  axInspect: (showValues: boolean) => Promise<AxInspectResult | null>;
  planView: () => PlanView;
  planAct: (action: PlanAction) => PlanView;
  dataExport: (request: ExportRequest) => Promise<ExportResult>;
  dataCounts: () => DataCounts;
  dataDelete: (category: DeleteCategory) => DeleteResult;
  dataReset: (request: ResetRequest) => Promise<DeleteResult>;
  dataRetryFailed: () => number;
  storageView: () => StorageView;
  storageOpen: () => void;
  retentionView: () => RetentionView;
  retentionRun: () => RetentionView;
  notesList: (query: string) => NoteSummary[];
  noteGet: (id: string) => Note | null;
  noteCreate: (input: NoteCreate) => { ok: true; note: Note } | { ok: false; message: string };
  noteSave: (input: NoteSave) => NoteSaveResult;
  noteDelete: (id: string) => void;
  scratchpadOpen: (noteId: string | null) => void;
  noteVersions: (noteId: string) => NoteVersion[];
  noteVersionSave: (input: NoteVersionSave) => NoteVersion | null;
  noteVersionText: (id: string) => NoteVersionText | null;
  noteVersionRestore: (id: string) => Note | null;
  notePin: (noteId: string, pinned: boolean) => NotePinResult;
  notePinMove: (noteId: string, step: -1 | 1) => void;
  noteImageAdd: (input: NoteImageAdd) => Promise<NoteImageResult>;
  noteRewrites: () => NoteRewriteChoice[];
  noteRewriteRun: (input: NoteRewriteRun) => Promise<NoteRewriteResult>;
  noteRewriteRecord: (input: NoteRewriteRecord) => void;
  noteExport: (input: NoteExport) => Promise<{ saved: boolean }>;
  noteImport: (input: NoteImport) => { ok: true; note: Note } | { ok: false; message: string };
  noteImageData: (id: string) => string | null;
  homeView: () => HomeView;
  historyRetry: (id: string) => Promise<HistoryRetryResult>;
  dictationState: () => DictationState;
  milestonesList: () => Milestone[];
  milestonesSeen: () => void;
  progressCardSave: (png: Uint8Array) => Promise<{ saved: boolean }>;
  progressCardCopy: (png: Uint8Array) => Promise<void>;
  insightsView: (range: InsightsRange) => InsightsView;
  insightsExport: (range: InsightsRange) => Promise<InsightsExportResult>;
  historyPage: (query: HistoryQuery) => HistoryPage;
  historyArchive: (ids: string[], archived: boolean) => number;
  historyFeedback: (input: HistoryFeedback) => void;
  historyDelete: (ids: string[]) => HistoryDeleteResult;
  loginItemGet: () => LoginItem;
  loginItemSet: (enabled: boolean) => LoginItem;
  /** The Hub page now shown (HB-01). */
  hubSetPage: (pageId: string) => void;
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
  dictionaryDelete: (id: string) => void | Promise<void>;
  dictionaryClipStart: (id: string) => Promise<DictionaryClipResult>;
  dictionaryClipStop: () => Promise<DictionaryClipResult>;
  dictionaryClipPlay: (id: string) => Promise<string | null>;
  dictionaryClipDelete: (id: string) => Promise<void>;
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
  rewritesList: () => Rewrite[];
  rewritesSave: (input: RewriteInput) => RewriteSaveResult;
  rewritesSetEnabled: (id: string, enabled: boolean) => void;
  rewritesMove: (id: string, step: -1 | 1) => void;
  rewritesDuplicate: (id: string) => RewriteSaveResult;
  rewritesDelete: (id: string) => RewriteSaveResult | null;
  rewritesSetShortcut: (id: string, key: CapturedKey | null) => RewriteShortcutResult;
  rewritesSetApplyDirectly: (id: string, applyDirectly: boolean) => void;
  rewritesSetAutoApply: (id: string, settings: RewriteAutoApply) => void;
  instructThreads: (query: string) => InstructThreadSummary[];
  instructThread: (id: string) => InstructThread | null;
  instructDelete: (id: string) => void;
  instructDeleteAll: () => void;
  instructReuse: (id: string) => boolean | Promise<boolean>;
  instructModelStatus: () => InstructModelStatus | Promise<InstructModelStatus>;
  instructModelDownload: () => InstructModelStatus | Promise<InstructModelStatus>;
  instructModelRemove: () => InstructModelStatus | Promise<InstructModelStatus>;
  focusState: () => FocusState;
  focusStart: (duration: FocusDuration) => FocusState;
  focusStop: () => FocusState;
  focusApps: () => FocusRule[];
  focusAddApp: (input: FocusAppInput) => FocusAddResult;
  focusRemoveApp: (id: string) => void;
  focusInstalledApps: () => Promise<InstalledApp[]>;
  focusSites: () => FocusSitesView;
  focusAddSite: (input: FocusSiteInput) => FocusAddResult;
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
    // Locked: nothing that shows a meeting, a note, a question or a task is answered.
    if (deps.isLocked?.() && isLockedChannel(channel)) {
      throw new Error("IPC rejected: locked");
    }
    switch (channel) {
      case IPC_CHANNELS.getAppInfo:
        return deps.getAppInfo();
      case IPC_CHANNELS.reportProblem:
        return deps.reportProblem();
      case IPC_CHANNELS.testingTool:
        return deps.testingTool(request.args[0] as TestingTool);
      case IPC_CHANNELS.axInspect:
        return deps.axInspect(request.args[0] as boolean);
      case IPC_CHANNELS.planView:
        return deps.planView();
      case IPC_CHANNELS.planAct:
        return deps.planAct(request.args[0] as PlanAction);
      case IPC_CHANNELS.dataExport:
        return deps.dataExport(request.args[0] as ExportRequest);
      case IPC_CHANNELS.dataCounts:
        return deps.dataCounts();
      case IPC_CHANNELS.dataDelete:
        return deps.dataDelete(request.args[0] as DeleteCategory);
      case IPC_CHANNELS.dataReset:
        return deps.dataReset(request.args[0] as ResetRequest);
      case IPC_CHANNELS.dataRetryFailed:
        return deps.dataRetryFailed();
      case IPC_CHANNELS.storageView:
        return deps.storageView();
      case IPC_CHANNELS.storageOpen:
        return deps.storageOpen();
      case IPC_CHANNELS.retentionView:
        return deps.retentionView();
      case IPC_CHANNELS.retentionRun:
        return deps.retentionRun();
      case IPC_CHANNELS.notesList:
        return deps.notesList(request.args[0] as string);
      case IPC_CHANNELS.noteGet:
        return deps.noteGet(request.args[0] as string);
      case IPC_CHANNELS.noteCreate:
        return deps.noteCreate(request.args[0] as NoteCreate);
      case IPC_CHANNELS.noteSave:
        return deps.noteSave(request.args[0] as NoteSave);
      case IPC_CHANNELS.noteDelete:
        return deps.noteDelete(request.args[0] as string);
      case IPC_CHANNELS.noteVersions:
        return deps.noteVersions(request.args[0] as string);
      case IPC_CHANNELS.noteVersionSave:
        return deps.noteVersionSave(request.args[0] as NoteVersionSave);
      case IPC_CHANNELS.noteVersionText:
        return deps.noteVersionText(request.args[0] as string);
      case IPC_CHANNELS.noteVersionRestore:
        return deps.noteVersionRestore(request.args[0] as string);
      case IPC_CHANNELS.notePin:
        return deps.notePin(request.args[0] as string, request.args[1] as boolean);
      case IPC_CHANNELS.notePinMove:
        return deps.notePinMove(request.args[0] as string, request.args[1] as -1 | 1);
      case IPC_CHANNELS.noteRewrites:
        return deps.noteRewrites();
      case IPC_CHANNELS.noteRewriteRun:
        return deps.noteRewriteRun(request.args[0] as NoteRewriteRun);
      case IPC_CHANNELS.noteRewriteRecord:
        return deps.noteRewriteRecord(request.args[0] as NoteRewriteRecord);
      case IPC_CHANNELS.noteExport:
        return deps.noteExport(request.args[0] as NoteExport);
      case IPC_CHANNELS.noteImport:
        return deps.noteImport(request.args[0] as NoteImport);
      case IPC_CHANNELS.noteImageAdd:
        return deps.noteImageAdd(request.args[0] as NoteImageAdd);
      case IPC_CHANNELS.noteImageData:
        return deps.noteImageData(request.args[0] as string);
      case IPC_CHANNELS.scratchpadOpen:
        return deps.scratchpadOpen(request.args[0] as string | null);
      case IPC_CHANNELS.homeView:
        return deps.homeView();
      case IPC_CHANNELS.historyRetry:
        return deps.historyRetry(request.args[0] as string);
      case IPC_CHANNELS.dictationState:
        return deps.dictationState();
      case IPC_CHANNELS.milestonesList:
        return deps.milestonesList();
      case IPC_CHANNELS.milestonesSeen:
        return deps.milestonesSeen();
      case IPC_CHANNELS.progressCardSave:
        return deps.progressCardSave(request.args[0] as Uint8Array);
      case IPC_CHANNELS.progressCardCopy:
        return deps.progressCardCopy(request.args[0] as Uint8Array);
      case IPC_CHANNELS.insightsView:
        return deps.insightsView(request.args[0] as InsightsRange);
      case IPC_CHANNELS.insightsExport:
        return deps.insightsExport(request.args[0] as InsightsRange);
      case IPC_CHANNELS.historyPage:
        return deps.historyPage(request.args[0] as HistoryQuery);
      case IPC_CHANNELS.historyArchive:
        return deps.historyArchive(request.args[0] as string[], request.args[1] as boolean);
      case IPC_CHANNELS.historyFeedback:
        return deps.historyFeedback(request.args[0] as HistoryFeedback);
      case IPC_CHANNELS.historyDelete:
        return deps.historyDelete(request.args[0] as string[]);
      case IPC_CHANNELS.loginItemGet:
        return deps.loginItemGet();
      case IPC_CHANNELS.loginItemSet:
        return deps.loginItemSet(request.args[0] as boolean);
      case IPC_CHANNELS.hubSetPage:
        return deps.hubSetPage(request.args[0] as string);
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
      case IPC_CHANNELS.dictionaryClipStart:
        return deps.dictionaryClipStart(request.args[0] as string);
      case IPC_CHANNELS.dictionaryClipStop:
        return deps.dictionaryClipStop();
      case IPC_CHANNELS.dictionaryClipPlay:
        return deps.dictionaryClipPlay(request.args[0] as string);
      case IPC_CHANNELS.dictionaryClipDelete:
        return deps.dictionaryClipDelete(request.args[0] as string);
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
      case IPC_CHANNELS.rewritesList:
        return deps.rewritesList();
      case IPC_CHANNELS.rewritesSave:
        return deps.rewritesSave(request.args[0] as RewriteInput);
      case IPC_CHANNELS.rewritesSetEnabled:
        return deps.rewritesSetEnabled(request.args[0] as string, request.args[1] as boolean);
      case IPC_CHANNELS.rewritesMove:
        return deps.rewritesMove(request.args[0] as string, request.args[1] as -1 | 1);
      case IPC_CHANNELS.rewritesDuplicate:
        return deps.rewritesDuplicate(request.args[0] as string);
      case IPC_CHANNELS.rewritesDelete:
        return deps.rewritesDelete(request.args[0] as string);
      case IPC_CHANNELS.rewritesSetShortcut:
        return deps.rewritesSetShortcut(
          request.args[0] as string,
          request.args[1] as CapturedKey | null,
        );
      case IPC_CHANNELS.rewritesSetAutoApply:
        return deps.rewritesSetAutoApply(
          request.args[0] as string,
          request.args[1] as RewriteAutoApply,
        );
      case IPC_CHANNELS.instructThreads:
        return deps.instructThreads(request.args[0] as string);
      case IPC_CHANNELS.instructThread:
        return deps.instructThread(request.args[0] as string);
      case IPC_CHANNELS.instructDelete:
        return deps.instructDelete(request.args[0] as string);
      case IPC_CHANNELS.instructDeleteAll:
        return deps.instructDeleteAll();
      case IPC_CHANNELS.instructReuse:
        return deps.instructReuse(request.args[0] as string);
      case IPC_CHANNELS.instructModelStatus:
        return deps.instructModelStatus();
      case IPC_CHANNELS.instructModelDownload:
        return deps.instructModelDownload();
      case IPC_CHANNELS.instructModelRemove:
        return deps.instructModelRemove();
      case IPC_CHANNELS.focusState:
        return deps.focusState();
      case IPC_CHANNELS.focusStart:
        return deps.focusStart(request.args[0] as FocusDuration);
      case IPC_CHANNELS.focusStop:
        return deps.focusStop();
      case IPC_CHANNELS.focusApps:
        return deps.focusApps();
      case IPC_CHANNELS.focusAddApp:
        return deps.focusAddApp(request.args[0] as FocusAppInput);
      case IPC_CHANNELS.focusRemoveApp:
        return deps.focusRemoveApp(request.args[0] as string);
      case IPC_CHANNELS.focusInstalledApps:
        return deps.focusInstalledApps();
      case IPC_CHANNELS.focusSites:
        return deps.focusSites();
      case IPC_CHANNELS.focusAddSite:
        return deps.focusAddSite(request.args[0] as FocusSiteInput);
      case IPC_CHANNELS.rewritesSetApplyDirectly:
        return deps.rewritesSetApplyDirectly(request.args[0] as string, request.args[1] as boolean);
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
      case IPC_CHANNELS.meetingsList:
        return deps.meetingsList();
      case IPC_CHANNELS.meetingDetail:
        return deps.meetingDetail(request.args[0] as string);
      case IPC_CHANNELS.meetingRecording:
        return deps.meetingRecording();
      case IPC_CHANNELS.meetingStart:
        return deps.meetingStart();
      case IPC_CHANNELS.meetingStop:
        return deps.meetingStop();
      case IPC_CHANNELS.meetingSummarize:
        return deps.meetingSummarize(
          request.args[0] as string,
          request.args[1] as { skillId?: string; quick?: boolean },
        );
      case IPC_CHANNELS.meetingSummaryFeedback:
        return deps.meetingSummaryFeedback(
          request.args[0] as string,
          request.args[1] as SummaryFeedback | null,
        );
      case IPC_CHANNELS.skillsList:
        return deps.skillsList();
      case IPC_CHANNELS.skillSave:
        return deps.skillSave(request.args[0] as string | null, request.args[1] as SkillDraft);
      case IPC_CHANNELS.skillDuplicate:
        return deps.skillDuplicate(request.args[0] as string);
      case IPC_CHANNELS.skillDelete:
        return deps.skillDelete(request.args[0] as string);
      case IPC_CHANNELS.skillVersions:
        return deps.skillVersions(request.args[0] as string);
      case IPC_CHANNELS.skillRestore:
        return deps.skillRestore(request.args[0] as string, request.args[1] as number);
      case IPC_CHANNELS.skillExport:
        return deps.skillExport(request.args[0] as string);
      case IPC_CHANNELS.skillImport:
        return deps.skillImport();
      case IPC_CHANNELS.tasksList:
        return deps.tasksList(request.args[0] as TaskFilter);
      case IPC_CHANNELS.taskAdd:
        return deps.taskAdd(request.args[0] as TaskDraft);
      case IPC_CHANNELS.taskUpdate:
        return deps.taskUpdate(request.args[0] as string, request.args[1] as TaskDraft);
      case IPC_CHANNELS.taskAction:
        return deps.taskAction(request.args[0] as string, request.args[1] as TaskAction);
      case IPC_CHANNELS.taskReorder:
        return deps.taskReorder(request.args[0] as string, request.args[1] as string | null);
      case IPC_CHANNELS.tasksUndo:
        return deps.tasksUndo();
      case IPC_CHANNELS.meetingFindTasks:
        return deps.meetingFindTasks(request.args[0] as string);
      case IPC_CHANNELS.meetingSpeakerRename:
        return deps.meetingSpeakerRename(
          request.args[0] as string,
          request.args[1] as string,
          request.args[2] as string,
        );
      case IPC_CHANNELS.meetingSpeakerClip:
        return deps.meetingSpeakerClip(request.args[0] as string, request.args[1] as string);
      case IPC_CHANNELS.meetingCorrect:
        return deps.meetingCorrect(request.args[0] as string, request.args[1] as Correction);
      case IPC_CHANNELS.foldersList:
        return deps.foldersList();
      case IPC_CHANNELS.folderCreate:
        return deps.folderCreate(request.args[0] as string);
      case IPC_CHANNELS.folderRename:
        return deps.folderRename(request.args[0] as string, request.args[1] as string);
      case IPC_CHANNELS.folderDelete:
        return deps.folderDelete(request.args[0] as string);
      case IPC_CHANNELS.folderUpdate:
        return deps.folderUpdate(request.args[0] as string, request.args[1] as FolderPatch);
      case IPC_CHANNELS.folderChooseExport:
        return deps.folderChooseExport(request.args[0] as string);
      case IPC_CHANNELS.folderClearExport:
        return deps.folderClearExport(request.args[0] as string);
      case IPC_CHANNELS.connectorSync:
        return deps.connectorSync(request.args[0] as string);
      case IPC_CHANNELS.connectorConnectKey:
        return deps.connectorConnectKey(request.args[0] as string, request.args[1] as string);
      case IPC_CHANNELS.connectorRecordings:
        return deps.connectorRecordings(request.args[0] as string);
      case IPC_CHANNELS.connectorImportPrepare:
        return deps.connectorImportPrepare(request.args[0] as string, request.args[1] as string);
      case IPC_CHANNELS.connectorOptions:
        return deps.connectorOptions(request.args[0] as string);
      case IPC_CHANNELS.connectorDataStatus:
        return deps.connectorDataStatus();
      case IPC_CHANNELS.askActionPropose:
        return deps.askActionPropose(request.args[0] as AskActionRequest);
      case IPC_CHANNELS.slackPostState:
        return deps.slackPostState();
      case IPC_CHANNELS.slackPostStart:
        return deps.slackPostStart(request.args[0] as SlackPostSource);
      case IPC_CHANNELS.slackPostPrepare:
        return deps.slackPostPrepare(request.args[0] as SlackPrepareInput);
      case IPC_CHANNELS.slackPostSend:
        return deps.slackPostSend(request.args[0] as SlackSendInput);
      case IPC_CHANNELS.extensionsView:
        return deps.extensionsView();
      case IPC_CHANNELS.policyView:
        return deps.policyView();
      case IPC_CHANNELS.teamView:
        return deps.teamView();
      case IPC_CHANNELS.teamConnect:
        return deps.teamConnect(request.args[0] as TeamConnectInput);
      case IPC_CHANNELS.teamSetup:
        return deps.teamSetup(request.args[0] as TeamSetupInput);
      case IPC_CHANNELS.teamSignIn:
        return deps.teamSignIn(request.args[0] as TeamSignInInput);
      case IPC_CHANNELS.teamSignOut:
        return deps.teamSignOut();
      case IPC_CHANNELS.teamLock:
        return deps.teamLock();
      case IPC_CHANNELS.teamUnlock:
        return deps.teamUnlock(request.args[0] as string);
      case IPC_CHANNELS.teamRedeem:
        return deps.teamRedeem(request.args[0] as TeamRedeemInput);
      case IPC_CHANNELS.teamSyncNow:
        return deps.teamSyncNow();
      case IPC_CHANNELS.teamSetIdleLock:
        return deps.teamSetIdleLock(request.args[0] as number);
      case IPC_CHANNELS.teamDisconnect:
        return deps.teamDisconnect();
      case IPC_CHANNELS.teamNoticesSeen:
        return deps.teamNoticesSeen();
      case IPC_CHANNELS.teamOpenAdmin:
        return deps.teamOpenAdmin();
      case IPC_CHANNELS.teamPropose:
        return deps.teamPropose(request.args[0] as TeamProposeInput);
      case IPC_CHANNELS.briefOverview:
        return deps.briefOverview();
      case IPC_CHANNELS.briefGet:
        return deps.briefGet(request.args[0] as string);
      case IPC_CHANNELS.briefForMeeting:
        return deps.briefForMeeting(request.args[0] as string);
      case IPC_CHANNELS.briefBuild:
        return deps.briefBuild(request.args[0] as string);
      case IPC_CHANNELS.briefOpen:
        return deps.briefOpen(request.args[0] as string);
      case IPC_CHANNELS.briefTarget:
        return deps.briefTarget();
      case IPC_CHANNELS.emailDraftState:
        return deps.emailDraftState();
      case IPC_CHANNELS.emailDraftPropose:
        return deps.emailDraftPropose(request.args[0] as EmailDraftSource);
      case IPC_CHANNELS.emailDraftCreate:
        return deps.emailDraftCreate(request.args[0] as EmailDraftInput);
      case IPC_CHANNELS.emailDraftList:
        return deps.emailDraftList(request.args[0] as EmailDraftSource);
      case IPC_CHANNELS.emailDraftOpen:
        return deps.emailDraftOpen(request.args[0] as string);
      case IPC_CHANNELS.calendarEventState:
        return deps.calendarEventState();
      case IPC_CHANNELS.calendarEventPropose:
        return deps.calendarEventPropose(request.args[0] as CalendarEventSource);
      case IPC_CHANNELS.calendarEventCreate:
        return deps.calendarEventCreate(request.args[0] as CalendarEventInput);
      case IPC_CHANNELS.calendarEventList:
        return deps.calendarEventList(request.args[0] as CalendarEventSource);
      case IPC_CHANNELS.calendarEventOpen:
        return deps.calendarEventOpen(request.args[0] as string);
      case IPC_CHANNELS.mcpStatus:
        return deps.mcpStatus();
      case IPC_CHANNELS.mcpClients:
        return deps.mcpClients();
      case IPC_CHANNELS.mcpIssue:
        return deps.mcpIssue(request.args[0] as string, request.args[1] as McpClientKind);
      case IPC_CHANNELS.mcpRotate:
        return deps.mcpRotate(request.args[0] as string);
      case IPC_CHANNELS.mcpRevoke:
        return deps.mcpRevoke(request.args[0] as string);
      case IPC_CHANNELS.mcpCopyToken:
        return deps.mcpCopyToken(request.args[0] as string);
      case IPC_CHANNELS.mcpConfigPreview:
        return deps.mcpConfigPreview(request.args[0] as string);
      case IPC_CHANNELS.mcpConfigWrite:
        return deps.mcpConfigWrite(request.args[0] as string);
      case IPC_CHANNELS.mcpAudit:
        return deps.mcpAudit();
      case IPC_CHANNELS.mcpAuditClear:
        return deps.mcpAuditClear();
      case IPC_CHANNELS.connectorsView:
        return deps.connectorsView();
      case IPC_CHANNELS.connectorConnect:
        return deps.connectorConnect(
          request.args[0] as string,
          request.args[1] as string | undefined,
        );
      case IPC_CHANNELS.connectorCancel:
        return deps.connectorCancel(request.args[0] as string);
      case IPC_CHANNELS.connectorDisconnect:
        return deps.connectorDisconnect(request.args[0] as string);
      case IPC_CHANNELS.connectorSetEnabled:
        return deps.connectorSetEnabled(request.args[0] as string, request.args[1] as boolean);
      case IPC_CHANNELS.connectorSetClientId:
        return deps.connectorSetClientId(
          request.args[0] as string,
          request.args[1] as string | null,
        );
      case IPC_CHANNELS.connectorSetClientSecret:
        return deps.connectorSetClientSecret(
          request.args[0] as string,
          request.args[1] as string | null,
        );
      case IPC_CHANNELS.meetingMove:
        return deps.meetingMove(request.args[0] as string, request.args[1] as string | null);
      case IPC_CHANNELS.meetingFolderDismiss:
        return deps.meetingFolderDismiss(request.args[0] as string, request.args[1] as string);
      case IPC_CHANNELS.meetingRecap:
        return deps.meetingRecap(request.args[0] as string);
      case IPC_CHANNELS.meetingImportPreview:
        return deps.meetingImportPreview();
      case IPC_CHANNELS.meetingImportConfirm:
        return deps.meetingImportConfirm(request.args[0] as TranscriptImportConfirmInput);
      case IPC_CHANNELS.meetingImportCancel:
        return deps.meetingImportCancel(request.args[0] as string);
      case IPC_CHANNELS.meetingRetentionDue:
        return deps.meetingRetentionDue();
      case IPC_CHANNELS.meetingExport:
        return deps.meetingExport(
          request.args[0] as string,
          request.args[1] as MeetingExportOptions,
        );
      case IPC_CHANNELS.meetingSetLanguage:
        return deps.meetingSetLanguage(
          request.args[0] as string,
          request.args[1] as MeetingLanguageInput,
        );
      case IPC_CHANNELS.meetingRerun:
        return deps.meetingRerun(
          request.args[0] as string,
          request.args[1] as MeetingLanguageInput,
        );
      case IPC_CHANNELS.meetingVersionRestore:
        return deps.meetingVersionRestore(request.args[0] as string, request.args[1] as number);
      case IPC_CHANNELS.meetingSegmentHistory:
        return deps.meetingSegmentHistory(request.args[0] as string, request.args[1] as string);
      case IPC_CHANNELS.meetingCorrectionRevert:
        return deps.meetingCorrectionRevert(request.args[0] as string, request.args[1] as number);
      case IPC_CHANNELS.askThreads:
        return deps.askThreads();
      case IPC_CHANNELS.askThread:
        return deps.askThread(request.args[0] as string);
      case IPC_CHANNELS.askSend:
        return deps.askSend(request.args[0] as AskSendInput);
      case IPC_CHANNELS.askDelete:
        return deps.askDelete(request.args[0] as string);
      case IPC_CHANNELS.meetingRename:
        return deps.meetingRename(request.args[0] as string, request.args[1] as string);
      case IPC_CHANNELS.meetingDelete:
        return deps.meetingDelete(request.args[0] as string);
      case IPC_CHANNELS.meetingNotesSave:
        return deps.meetingNotesSave(request.args[0] as string, request.args[1] as string);
      case IPC_CHANNELS.meetingDocAddLink:
        return deps.meetingDocAddLink(
          request.args[0] as string,
          request.args[1] as string,
          request.args[2] as string,
        );
      case IPC_CHANNELS.meetingDocAddFile:
        return deps.meetingDocAddFile(request.args[0] as string);
      case IPC_CHANNELS.meetingDocOpen:
        return deps.meetingDocOpen(request.args[0] as string);
      case IPC_CHANNELS.meetingDocRemove:
        return deps.meetingDocRemove(request.args[0] as string);
      default:
        throw new Error("IPC rejected: unknown-channel");
    }
  };
}
