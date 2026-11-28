import { randomBytes, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  nativeImage,
  nativeTheme,
  Notification,
  ipcMain,
  Menu,
  powerMonitor,
  screen,
  session,
  shell,
  utilityProcess,
} from "electron";
import {
  BAR_IPC_CHANNELS,
  buildInsights,
  INSIGHTS_LIMITS,
  insightsCsv,
  dictationStateOf,
  type DictationState,
  type MeetingDetail,
  type FolderResult,
  type MeetingChannel,
  type MeetingExportOptions,
  type SummaryStatus,
  type TaskRunStatus,
  type HistoryRetryResult,
  localDate,
  milestoneTitle,
  addDays,
  weekStart,
  streaks,
  NOTE_MESSAGES,
  DEFAULT_NOTIFICATIONS,
  DEFAULT_PRIVACY,
  connectorFeatureOn,
  DEFAULT_SPEECH_MODEL,
  DEFAULT_PLAN_STATE,
  DEFAULT_DEVELOPER,
  CALENDAR_WRITE_SCOPES,
  CONNECTOR_CATALOGUE,
  DATA_CONNECTOR_IDS,
  GMAIL_SCOPE_COMPOSE,
  connectorChoice,
  hasScope,
  type CalendarEvent,
  type CalendarEventResult,
  type SlackSendResult,
  type EmailDraftResult,
  MCP_STATUS_OFF,
  DEFAULT_CONNECTOR_SETTINGS,
  DEFAULT_BRIEF_SETTINGS,
  DEFAULT_EXTENSIONS_SETTINGS,
  DEFAULT_MCP_SETTINGS,
  DEFAULT_NOTETAKER,
  isClientCredential,
  referralCode,
  type TestingTool,
  type TestingToolResult,
  FREE_WEEKLY_WORDS,
  PLAN_MESSAGES,
  weeklyLimitReached,
  DEFAULT_EXPORT_OPTIONS,
  DEFAULT_SKILL_ID,
  SPEAKER_DEFAULT_NAMES,
  formatElapsed,
  GENERATION_MESSAGES,
  markdownTitle,
  markdownToRich,
  rangeFirstDay,
  MEMORY_LIMITS,
  PRESETS,
  REWRITE_PANEL_BINDING_ID,
  REWRITE_PANEL_CHANNELS,
  STYLE_CATEGORIES,
  type StyleCategory,
  EDIT_WATCH_MAX_MS,
  DEFAULT_CLEANUP_MODEL,
  QUALITY_INSTRUCT_MODEL,
  AUTO_INSTRUCT_ASK_MS,
  INSTRUCT_MESSAGES,
  DEFAULT_EMAIL,
  DEFAULT_JARGON_PACKS,
  DEFAULT_DEVELOPER_TOOLS,
  DEFAULT_COMMAND_MODE,
  DEFAULT_INSTRUCT,
  DEFAULT_FOCUS,
  DEFAULT_PLAN,
  planAllows,
  type PlanFeature,
  INSTRUCT_PANEL_CHANNELS,
  FOCUS_MESSAGES,
  FOCUS_OVERLAY_CHANNELS,
  parseSiteEntry,
  type BarAnswer,
  type BarView,
  INSTRUCT_PANEL_PUSH,
  INSTRUCT_PANEL_SIZE,
  type InstructPanelState,
  GENERATION_LIMITS,
  DEFAULT_SOUNDS,
  IPC_CHANNELS,
  IPC_EVENTS,
  blockerMessage,
  type DictationBlocker,
  type PermissionKind,
  type PermissionSnapshot,
  type SoundName,
  SESSION_LIMIT_DEFAULT,
  type Settings,
  DEFAULT_BAR,
  DEFAULT_INSERTION,
  SOUND_VOLUME_DEFAULT,
  UNDO_MESSAGES,
} from "@murmur/shared";
import {
  createNavigationGuard,
  denyPermissionCheck,
  denyPermissionRequest,
  denyWindowOpen,
} from "../security/guards";
import { createHubWindowOptions, HUB_MIN_HEIGHT, HUB_MIN_WIDTH } from "../security/window-options";
import { createBarController } from "./bar/bar-controller";
import type { BarEvent } from "./bar/bar-machine";
import { barEventFor } from "./bar/bar-events";
import { createBarIpcHandler } from "./bar/bar-ipc";
import { WARNING_MS as BAR_WARNING_MS } from "./bar/bar-machine";
import { barMenu, type BarMenuAction } from "./bar/bar-menu";
import { createNextSession } from "./bar/next-session";
import { BarWindow, barPositionFile } from "./bar/bar-window";
import {
  createHubStateStore,
  DEFAULT_HUB_STATE,
  type HubWindowState,
  placeOnScreen,
} from "./hub/hub-window-state";
import { createCleanupService } from "./cleanup/cleanup-service";
import { databasePath, openDatabase } from "./db/database";
import { createHistoryStore, type HistoryStore } from "./history/history-store";
import { createInsightsStore } from "./insights/insights-store";
import { createMilestonesStore } from "./milestones/milestones-store";
import { createNotifier } from "./notifications/notifier";
import { createNetworkGuard } from "./privacy/network-guard";
import { createRetentionJob, tableRules } from "./privacy/retention";
import { sizeOf } from "./privacy/storage";
import { createDataDeleter } from "./privacy/data-delete";
import { createPlanController } from "./plans/plan-controller";
import { diagnosticsReport } from "./testing/diagnostics";
import { writeExport } from "./privacy/data-export";
import { createNotesStore } from "./notes/notes-store";
import { createContactsStore } from "./contacts/contacts-store";
import { createPrivateFocus } from "./privacy/private-focus";
import guide from "./help/guide.md?raw";
import { createMeetingsStore } from "./meetings/meetings-store";
import { createMeetingRecorder } from "./meetings/meeting-recorder";
import { createMeetingStarter } from "./meetings/meeting-starter";
import { createMeetingDetector, type MeetingDetector } from "./meetings/meeting-detector";
import { loadMeetingMatchers } from "./meetings/matchers-file";
import { createDetectionSync } from "./meetings/detection-sync";
import { createMeetingJobs, type MeetingJobs } from "./meetings/meeting-jobs";
import { createSkillsService } from "./meetings/skills-service";
import { readSkillFiles } from "./meetings/skill-folder";
import { createConnectorConfig } from "./connectors/connector-config";
import { createConnectorService } from "./connectors/connector-service";
import { createConnectorStore } from "./connectors/connector-store";
import { buildConnectorsView } from "./connectors/connectors-view";
import { createMcpService } from "./mcp/mcp-service";
import { createCalendarReminders } from "./meetings/calendar-reminders";
import { createEventResponder } from "./connectors/calendar/event-respond";
import {
  eventForCall,
  menuBarText,
  nextMeeting as upcomingMeeting,
  untilText,
} from "./meetings/calendar-upcoming";
import { createMcpSetup } from "./mcp/mcp-setup";
import { createHelperKeychain } from "./connectors/helper-keychain";
import { createConnectorRegistry } from "./connectors/providers";
import { createCalendarStore } from "./connectors/calendar/calendar-store";
import { createEventCreateService, isCalendarOpenUrl } from "./connectors/calendar/event-create";
import { connectOptionsFor } from "./connectors/connect-options";
import { createAutomationsStore } from "./connectors/gmail/automations-store";
import { createEmailDraftService } from "./connectors/gmail/email-draft";
import { createActionRunner, fromUserClick } from "./extensions/action-runner";
import { createSlackPost } from "./connectors/slack/slack-post";
import { createAskActions } from "./connectors/ask-actions";
import { createGmailThreads } from "./connectors/gmail/gmail-threads";
import { createBriefBuilder, eventKeyOf as briefEventKey } from "./meetings/brief-builder";
import { createBriefService } from "./meetings/brief-service";
import { createBriefsStore } from "./meetings/briefs-store";
import { gmailProvider } from "./connectors/gmail/gmail";
import { createConnectorData } from "./connectors/data/connector-data";
import { createConnectorImport } from "./connectors/data/connector-import";
import { firefliesProvider } from "./connectors/fireflies/fireflies";
import { githubProvider } from "./connectors/github/github";
import { linearProvider } from "./connectors/linear/linear";
import { notionProvider } from "./connectors/notion/notion";
import { slackProvider } from "./connectors/slack/slack";
import { zoomProvider } from "./connectors/zoom/zoom";
import { createCalendarSync } from "./connectors/calendar/calendar-sync";
import { googleCalendarProvider } from "./connectors/calendar/google-calendar";
import { outlookCalendarProvider } from "./connectors/calendar/outlook-calendar";
import { createAskIndex } from "./meetings/ask-index";
import { createAutoExport } from "./meetings/auto-export";
import { createDictationWindows } from "./meetings/dictation-windows";
import { createRecapRunner, RecapError } from "./meetings/recap-runner";
import { createRecapsStore } from "./meetings/recaps-store";
import { createFoldersStore } from "./meetings/folders-store";
import { createTranscriptImport } from "./meetings/import/transcript-import";
import { exportFileName, renderMeetingHtml } from "./meetings/meeting-export";
import { suggestFromCorrection } from "./meetings/corrections-learn";
import { createCorrectionsStore } from "./meetings/corrections-store";
import { createMeetingRerun } from "./meetings/meeting-rerun";
import { createMeetingRetention } from "./meetings/meeting-retention";
import { createSpeakerClip } from "./meetings/speaker-clip";
import { zipFiles } from "./meetings/zip";
import { createTranscriptVersions } from "./meetings/transcript-versions";
import { createSpeakersStore } from "./meetings/speakers-store";
import { AskError, createAskRunner } from "./meetings/ask-runner";
import { createAskStore } from "./meetings/ask-store";
import { createTaskRunner, TaskError } from "./meetings/tasks-runner";
import { createTasksService } from "./meetings/tasks-service";
import { createSkillsStore, createSummariesStore } from "./meetings/summaries-store";
import { createSummaryRunner, SummaryError } from "./meetings/summary-runner";
import { createTranscriptStore } from "./meetings/transcript-store";
import { createLiveTranscriber } from "./meetings/live-transcriber";
import { createMeetingNotesStore } from "./meetings/meeting-notes-store";
import { createNoteImages, type ImageEncoder } from "./notes/note-images";
import {
  noteFileName,
  noteRewriteChoices,
  SKILL_CHOICE,
  skillInstruction,
  writeNoteHtml,
  writeNoteMarkdown,
} from "./notes/note-files";
import { createDictionaryStore } from "./dictionary/dictionary-store";
import { createCorrectionLearner } from "./dictionary/learn";
import { createSnippetStore } from "./snippets/snippet-store";
import { createStyleStore } from "./styles/style-store";
import { createMemoryStore } from "./memory/memory-store";
import { createRewriteStore } from "./rewrites/rewrite-store";
import { createRewriteRunStore } from "./rewrites/run-store";
import { createCommandRunStore } from "./commands/run-store";
import { createCommandRunner, type LastDictation } from "./commands/command-runner";
import {
  COMMAND_CHOICE_MAX_TOKENS,
  commandChoicePrompt,
  parseCommandChoice,
} from "./commands/model-match";
import { createRewriteController } from "./rewrites/rewrite-controller";
import { PanelWindow, RewritePanelWindow } from "./rewrites/panel-window";
import { createInstructController } from "./instruct/instruct-controller";
import { createInstructPanelIpcHandler } from "./instruct/panel-ipc";
import { createInstructThreadStore } from "./instruct/thread-store";
import { createUndoService } from "./undo/undo-service";
import { createQualityModel } from "./instruct/quality-model";
import { createFocusController } from "./focus/focus-controller";
import {
  boundRewriteShortcuts,
  meetingStartRefusal,
  planRefusal,
  refuseNewRewrite,
  refuseRewriteShortcut,
} from "./plans/gates";
import { createFocusStore } from "./focus/focus-store";
import { createFocusOverlayIpcHandler } from "./focus/overlay-ipc";
import { FocusOverlayWindow } from "./focus/overlay-window";
import { createRewritePanelIpcHandler } from "./rewrites/panel-ipc";
import {
  rewriteBindings,
  rewriteShortcutsInUse,
  setRewriteShortcut,
  withShortcutLabels,
} from "./rewrites/rewrite-shortcuts";
import { createGenerationService, errorCode as generationErrorCode } from "./generation/service";
import { createAutoRewriter } from "./rewrites/auto-apply";
import { BROWSERS } from "./styles/app-categories";
import { createPhraseLearner } from "./dictionary/phrases";
import { createClipRecorder } from "./dictionary/clips";
import { createWritingSampleStore } from "./email/writing-samples";
import { createTranslator } from "./email/translator";
import { developerVocabulary, type DeveloperVocabulary } from "./developer/packs";
import { codingCliRunning, TERMINALS } from "./developer/coding-cli";
import { createWorkspaceIndexer, findWorkspace, TAG_EDITORS } from "./developer/workspace";
import { chooseAutoDevice } from "./settings/auto-device";
import { createImporter } from "./imports/importer";
import { createVoiceProfile, recentExamples } from "./voice/voice-profile";
import {
  createLlmClient,
  LlmCancelledError,
  LlmPreemptedError,
  type LlmReply,
} from "./cleanup/llm-client";
import { createConsoleLogger, systemClock } from "./helper/node-runtime";
import { HelperError } from "./helper/types";
import { createHotkeyService } from "./hotkeys";
import { createIpcHandler } from "./ipc";
import { createPermissionsService } from "./permissions";
import {
  activateMacApp,
  convertMacImageToPng,
  createMacHelper,
  permissionSettingsUrl,
  MAC_DEFAULT_COMMAND_TRIGGER,
  MAC_DEFAULT_COPY_LAST_TRIGGER,
  MAC_DEFAULT_FOCUS_TRIGGER,
  MAC_DEFAULT_INSTRUCT_TRIGGER,
  MAC_DEFAULT_PASTE_LAST_TRIGGER,
  MAC_DEFAULT_REWRITE_TRIGGER,
  MAC_DEFAULT_SCRATCHPAD_TRIGGER,
  MAC_KEY_RIGHT_OPTION,
  MAC_KEYS,
} from "./platform";
import {
  bindingsFor,
  createSettingsService,
  deviceFor,
  languagesFor,
  wantsLatinHindi,
} from "./settings/settings-service";
import { createSettingsStore } from "./settings/settings-store";
import { CANCELLED, createRecorder, type DictationRecord, type RecorderEvent } from "./recorder";
import { createSessionEffects } from "./media/session-effects";
import { createSpeechService } from "./speech/speech-service";
import { checkModel, downloadModel, modelLocation } from "./speech/model-store";
import { createModelDownload } from "./setup/model-download";
import { dictationBlockers, hasPermissionBlocker } from "./setup/readiness";
import { cleanupModelRoot, speechModelRoot } from "./speech/paths";
import { insertionRules, insertionMethod } from "./insertion/app-rules";
import { createLastTranscript } from "./insertion/last-transcript";
import { createTypingReminder } from "./reminder/typing-reminder";
import { createMicCheck } from "./mic-check/mic-check";
import { toLatinHindi } from "./speech/latin-hindi";
import { profilePaths } from "./profile";
import { createSmokeRun, SMOKE_PAGE, type SmokeRun } from "./smoke";
import { createSmokeChecks, type SmokeChecks } from "./smoke-checks";
import { createTrayController, type TrayController } from "./tray/tray-controller";
import { createElectronTray, menuTemplate } from "./tray/tray-electron";
import { reminderStatus } from "./tray/tray-menu";

const isDevelopment = !app.isPackaged;

// A separate profile for a clean first run or a test; see `profilePaths`.
const profile = profilePaths(process.env, {
  appData: app.getPath("appData"),
  userData: app.getPath("userData"),
});
if (profile.isOverridden) {
  mkdirSync(profile.userData, { recursive: true });
  app.setPath("userData", profile.userData);
  console.log(`[profile] using ${profile.appData}`);
}

/** URL of the Hub page: the Vite dev server in development, the bundled file otherwise. */
function resolveHubEntryUrl(): string {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return MAIN_WINDOW_VITE_DEV_SERVER_URL;
  }
  return pathToFileURL(
    path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
  ).toString();
}

const hubEntryUrl = resolveHubEntryUrl();

/** The Rewrite panel is another page of the same renderer build, with its own preload. */
function resolveRewriteEntryUrl(): string {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return new URL("rewrite.html", `${MAIN_WINDOW_VITE_DEV_SERVER_URL}/`).toString();
  }
  return pathToFileURL(
    path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/rewrite.html`),
  ).toString();
}

const rewriteEntryUrl = resolveRewriteEntryUrl();

/** The Instruct panel (RW-11), another page of the same build with its own preload. */
function resolveInstructEntryUrl(): string {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return new URL("instruct.html", `${MAIN_WINDOW_VITE_DEV_SERVER_URL}/`).toString();
  }
  return pathToFileURL(
    path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/instruct.html`),
  ).toString();
}

const instructEntryUrl = resolveInstructEntryUrl();

/** The Focus overlay (RW-21), another page of the same build with its own preload. */
function resolveFocusEntryUrl(): string {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return new URL("focus.html", `${MAIN_WINDOW_VITE_DEV_SERVER_URL}/`).toString();
  }
  return pathToFileURL(
    path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/focus.html`),
  ).toString();
}

const focusEntryUrl = resolveFocusEntryUrl();

/** The Bar is a second page of the same renderer build, with its own preload. */
function resolveBarEntryUrl(): string {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return new URL("bar.html", `${MAIN_WINDOW_VITE_DEV_SERVER_URL}/`).toString();
  }
  return pathToFileURL(
    path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/bar.html`),
  ).toString();
}

const barEntryUrl = resolveBarEntryUrl();

const helper = createMacHelper({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appPath: app.getAppPath(),
  env: process.env,
  appVersion: app.getVersion(),
});

const permissions = createPermissionsService({
  helper,
  logger: createConsoleLogger("[permissions]"),
});

// Opened before anything else that reads settings. If it cannot open, dictation still works
// with default settings and no history.
function openMurmurDatabase(): DatabaseSync | null {
  try {
    return openDatabase(databasePath(profile.appData));
  } catch (error) {
    console.error(
      `[db] database could not open: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
const database = openMurmurDatabase();
// The personal dictionary (PZ-01). Without a database the pipeline simply has none.
const dictionary = database ? createDictionaryStore(database) : null;
const phraseLearner = database && dictionary ? createPhraseLearner(database, dictionary) : null;
// Learning from corrections (PZ-02): the last inserted text, and what the helper reports.
const learner = database && dictionary ? createCorrectionLearner(database, dictionary) : null;
let lastInserted: string | null = null;
// Snippets (PZ-08).
const snippets = database ? createSnippetStore(database) : null;
// Styles per context and the owner's app categories (PZ-11, PZ-13).
const styles = database ? createStyleStore(database) : null;
// Memory (PZ-18, PZ-19), and the one "remember that" fact waiting on the Bar.
const memory = database ? createMemoryStore(database) : null;
const rewrites = database ? createRewriteStore(database) : null;
const rewriteRuns = database ? createRewriteRunStore(database) : null;
const commandRuns = database ? createCommandRunStore(database) : null;
/** The last dictation that went in, for a command said with nothing selected (RW-08). */
let lastDictation: LastDictation | null = null;
/** A Command Mode question on the Bar ("Delete the selected text?"), waiting for its answer. */
/** How long the Bar offers to undo a command. */
const UNDO_OFFER_MS = 8000;
const UNDO_QUESTION = "Text changed";
const RESUME_QUESTION = "Recording was interrupted";
let commandQuestion: { answer: (yes: boolean) => void; timer: NodeJS.Timeout } | null = null;
/** How long a Command Mode question waits before it counts as No. */
const COMMAND_ASK_MS = 60_000;
function askOnBar(message: string, detail: string, waitMs = COMMAND_ASK_MS): Promise<boolean> {
  commandQuestion?.answer(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (commandQuestion?.timer !== timer) return;
      commandQuestion = null;
      bar.dispatch({ type: "answered" });
      resolve(false);
    }, waitMs);
    commandQuestion = {
      timer,
      answer: (yes) => {
        clearTimeout(timer);
        commandQuestion = null;
        resolve(yes);
      },
    };
    bar.dispatch({ type: "ask", message, detail });
  });
}
const writingSamples = database ? createWritingSampleStore(database) : null;
// Bulk import of dictionary entries and snippets (PZ-07, PZ-10).
const importer = createImporter({ dictionary, snippets });
// Voice Profile (PZ-15 to PZ-17), and whether its weekly prompt waits on the Bar.
const voiceProfile = database ? createVoiceProfile(database) : null;
let profilePromptShown = false;
let offeredFact: { text: string; until: number } | null = null;
/** The Bar's question was answered: "Save to Memory?" or the weekly profile prompt. */
function answerBar(choice: BarAnswer): void {
  // NT-05: recording again after sleep stopped a recording.
  if (bar.getView().state === "ask" && bar.getView().message === RESUME_QUESTION) {
    bar.dispatch({ type: "answered" });
    if (choice === "yes") void meetingStarter?.start();
    return;
  }
  // RW-10: Undo, offered after a command changed text. Only that question answers to this.
  if (bar.getView().state === "ask" && bar.getView().message === UNDO_QUESTION) {
    bar.dispatch({ type: "answered" });
    if (choice !== "yes") return;
    void undo
      .undoLast("command", { refocus: true })
      .then((result) => bar.dispatch({ type: "warn", message: UNDO_MESSAGES[result] }));
    return;
  }
  // The Record, Not now and Never buttons of a detected call (NT-01).
  if (
    bar.getView().actions &&
    (calendarReminders?.answer(choice) || meetingDetector?.answer(choice))
  ) {
    bar.dispatch({ type: "answered" });
    return;
  }
  if (commandQuestion) {
    commandQuestion.answer(choice === "yes");
    bar.dispatch({ type: "answered" });
    return;
  }
  if (profilePromptShown && !offeredFact) {
    profilePromptShown = false;
    bar.dispatch({ type: "answered" });
    if (choice === "yes") openHubPage("my-voice");
    return;
  }
  const fact = offeredFact;
  offeredFact = null;
  const saved =
    choice === "yes" && fact && fact.until > Date.now()
      ? memory?.save({ text: fact.text, keywords: null, enabled: true }, "dictation")
      : null;
  bar.dispatch({ type: "answered" });
  if (saved?.ok) bar.dispatch({ type: "warn", message: "Saved to Memory" });
}
// HB-36: daily counts, filled from history once.
const insights = database ? createInsightsStore(database) : null;
try {
  const filled = insights?.backfill() ?? 0;
  if (filled > 0) console.log(`[insights] counted ${filled} earlier dictations`);
} catch (error) {
  console.warn(`[insights] could not fill from history: ${String(error)}`);
}

/**
 * HB-03: a failed dictation retried from the Hub. Its recording is transcribed and cleaned
 * again; the text goes into the same row and onto the clipboard, as there is no app to put
 * it in.
 */
async function retryFromHub(id: string): Promise<HistoryRetryResult> {
  const source = history?.retrySource(id) ?? null;
  if (!history || !source) return { ok: false, message: "This recording is no longer kept." };
  try {
    const transcript = await speech.transcribe(source.audioPath);
    const rawText = transcript.text.trim();
    if (rawText === "") return { ok: false, message: "Nothing was heard in the recording." };
    const cleaned = await cleanup.clean(rawText, { terms: [], budgetMs: 1500 });
    const finalText = cleaned.text.trim() || rawText;
    const wordCount = finalText.split(/\s+/).filter(Boolean).length;
    history.applyRetry(id, { rawText, finalText, wordCount });
    await clipboard.writeText(finalText);
    insights?.record({
      createdAt: source.createdAt,
      words: wordCount,
      durationMs: source.durationMs,
      insertStatus: "clipboard_only",
      appBundleId: source.appBundleId,
      appName: source.appName,
    });
    console.log(`[history] retried a failed dictation from the Hub (${wordCount} words)`);
    return { ok: true, text: finalText };
  } catch (error) {
    console.warn(
      `[history] retry failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false, message: "The recording could not be transcribed. Try again later." };
  }
}

// HB-26: Scratchpad notes.
const notes = database ? createNotesStore(database) : null;

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/gif": "gif",
};

const convertToPng = convertMacImageToPng;

/**
 * HB-30: decodes the image (HEIC, HEIF and GIF are first turned into PNG by the platform,
 * a GIF giving its first frame), scales the long side to at most `maxSide`, and encodes a
 * new PNG or JPEG. Only pixels survive, so location and every other piece of metadata is gone.
 */
const encodeNoteImage: ImageEncoder = async (input, maxSide) => {
  const folder = mkdtempSync(path.join(app.getPath("temp"), "murmur-image-"));
  try {
    let file = path.join(folder, `image.${IMAGE_EXTENSIONS[input.type] ?? "img"}`);
    writeFileSync(file, input.bytes);
    if (input.type === "image/heic" || input.type === "image/heif" || input.type === "image/gif") {
      const png = path.join(folder, "converted.png");
      if (!convertToPng || !(await convertToPng(file, png))) return null;
      file = png;
    }
    let image = nativeImage.createFromPath(file);
    if (image.isEmpty()) return null;
    const { width, height } = image.getSize();
    const scale = Math.min(1, maxSide / Math.max(width, height));
    if (scale < 1) {
      image = image.resize({
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        quality: "best",
      });
    }
    const size = image.getSize();
    const png = input.type === "image/png" || input.type === "image/gif";
    return {
      data: png ? image.toPNG() : image.toJPEG(85),
      mime: png ? "image/png" : "image/jpeg",
      width: size.width,
      height: size.height,
    };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};

const noteImages = database
  ? createNoteImages(database, path.join(profile.appData, "Murmur", "notes"), encodeNoteImage)
  : null;

// HB-52: the one gate for network use (model downloads and any page request).
const networkGuard = createNetworkGuard({
  strict: () => settingsStore.get().privacy.strictLocal,
  logger: console,
});

// HB-50: what the daily job removes. Dictionary, Snippets, Styles, Memory and notes are
// never touched by it.
const DAY_MS = 24 * 60 * 60_000;
const retention = database
  ? createRetentionJob(database, {
      historyText: (now) => {
        const days = settingsStore.get().privacy.historyDays;
        return days && history ? history.removeOlderThan(now - days * DAY_MS).rows : 0;
      },
      audio: (now) => history?.pruneAudio(now) ?? 0,
      // NT-22: meeting recordings and transcripts past their time (a recording, or one still
      // being transcribed, is never touched).
      meetingAudio: (now) => meetingRetention?.runAudio(now) ?? 0,
      meetingTranscripts: (now) => meetingRetention?.runTranscripts(now) ?? 0,
      instructThreads: () => {
        const result = instructThreads?.applyRetention();
        return result ? result.textRemoved + result.deleted : 0;
      },
      ...tableRules(database),
    })
  : null;

function runRetention(): void {
  try {
    const removed = retention?.runIfDue(Date.now());
    if (removed) {
      console.log(`[retention] ${JSON.stringify(removed)}`);
    }
  } catch (error) {
    console.warn(`[retention] could not run: ${String(error)}`);
  }
}

// HB-24: macOS notifications. Shown ones are kept until closed, so they are not collected
// while still on screen.
const shownNotifications = new Set<Notification>();
const notifier = createNotifier({
  settings: () => settingsStore.get(),
  show: ({ title, body, target }) => {
    if (isSmokeRun || !Notification.isSupported()) return;
    const notification = new Notification({ title, body });
    shownNotifications.add(notification);
    notification.on("click", () => openHubPage(target));
    notification.on("close", () => shownNotifications.delete(notification));
    notification.show();
  },
});

/** HB-24: once a week, last week's words and the streak, if that notification is on. */
function weeklySummary(): void {
  if (!insights || !settingsStore.get().notifications.weeklySummary) return;
  const today = localDate(Date.now());
  const monday = addDays(weekStart(today), -7);
  if (insights.meta("weekly.sent") === monday) return;
  const days = insights.days(monday).filter((day) => day.date < weekStart(today));
  const words = days.reduce((total, day) => total + day.words, 0);
  insights.setMeta("weekly.sent", monday);
  if (words === 0) return;
  const streak = streaks(
    insights
      .days(null)
      .filter((day) => day.dictations > 0)
      .map((day) => day.date),
    today,
  ).daily.current;
  notifier.weeklySummary(words, streak);
}

// HB-41: milestones; the first check records what was reached before, quietly.
const milestones = database ? createMilestonesStore(database) : null;

/** Records new milestones; with `announce`, says the newest on the Bar with a sound. */
function checkMilestones(announce: boolean): void {
  if (!milestones || !insights) return;
  try {
    const reached = milestones.check(insights.days(null), localDate(Date.now()), Date.now());
    const newest = reached.at(-1);
    if (newest === undefined) return;
    console.log(`[milestones] reached: ${reached.join(", ")}`);
    if (!announce) return;
    bar.dispatch({ type: "warn", message: `Milestone: ${milestoneTitle(newest)}` });
    effects.sound("milestone");
    notifier.milestone(milestoneTitle(newest));
  } catch (error) {
    console.warn(`[milestones] could not check: ${String(error)}`);
  }
}
checkMilestones(false);

const history: HistoryStore | null = database
  ? createHistoryStore(database, path.join(profile.appData, "Murmur", "audio"), undefined, {
      // HB-48, HB-52: what is kept of a successful recording; nothing in strict local mode.
      audioPolicy: () => {
        const privacy = settingsStore.get().privacy;
        return privacy.strictLocal ? "never" : privacy.audio;
      },
    })
  : null;

// Where the helper writes recordings. A separate profile keeps them inside it too.
if (profile.isOverridden && !process.env.MURMUR_AUDIO_DIR) {
  process.env.MURMUR_AUDIO_DIR = path.join(profile.appData, "Murmur", "audio", "tmp");
}
const recordingsDir =
  process.env.MURMUR_AUDIO_DIR || path.join(profile.appData, "Murmur", "audio", "tmp");
// Recordings a crash left unfinished become failed dictations that can be retried, and audio
// past its retention is removed.
if (history) {
  try {
    const recovered = history.recoverInterrupted(recordingsDir);
    if (recovered > 0)
      console.log(`[history] ${recovered} interrupted dictation(s) can be retried`);
    const removed = history.pruneAudio(Date.now());
    if (removed > 0) console.log(`[history] removed ${removed} expired recording(s)`);
  } catch (error) {
    console.warn(
      `[history] recovery failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// HB-47: delete by category.
const dataDeleter =
  database && history
    ? createDataDeleter({
        db: database,
        history,
        notesRoot: path.join(profile.appData, "Murmur", "notes"),
        audioRoot: path.join(profile.appData, "Murmur", "audio"),
        clipsRoot: path.join(profile.appData, "Murmur", "clips"),
        meetingsRoot: path.join(profile.appData, "Murmur", "meetings"),
        skillsRoot: path.join(profile.appData, "Murmur", "Skills"),
      })
    : null;

const settingsDefaults: Settings = {
  holdShortcut: { type: "key", keyCode: MAC_KEY_RIGHT_OPTION, modifiers: [] },
  handsFreeShortcut: null,
  rewriteShortcut: MAC_DEFAULT_REWRITE_TRIGGER,
  commandShortcut: MAC_DEFAULT_COMMAND_TRIGGER,
  commandMode: DEFAULT_COMMAND_MODE,
  instructShortcut: MAC_DEFAULT_INSTRUCT_TRIGGER,
  instruct: DEFAULT_INSTRUCT,
  focusShortcut: MAC_DEFAULT_FOCUS_TRIGGER,
  focus: DEFAULT_FOCUS,
  scratchpadShortcut: MAC_DEFAULT_SCRATCHPAD_TRIGGER,
  // NT-03: unset until the owner picks one; the check refuses clashes with dictation keys.
  meetingShortcut: null,
  copyLastShortcut: MAC_DEFAULT_COPY_LAST_TRIGGER,
  pasteLastShortcut: MAC_DEFAULT_PASTE_LAST_TRIGGER,
  pressEnterShortcut: null,
  recapShortcut: null,
  scratchpad: { enabled: true, newTab: true },
  theme: "system",
  language: "en",
  notifications: DEFAULT_NOTIFICATIONS,
  privacy: DEFAULT_PRIVACY,
  planState: DEFAULT_PLAN_STATE,
  devMode: DEFAULT_DEVELOPER,
  help: { tours: {} },
  referral: { code: "", invites: 0 },
  notetaker: DEFAULT_NOTETAKER,
  connectors: DEFAULT_CONNECTOR_SETTINGS,
  mcp: DEFAULT_MCP_SETTINGS,
  extensions: DEFAULT_EXTENSIONS_SETTINGS,
  plan: DEFAULT_PLAN,
  inputDevice: "auto",
  languages: [],
  cleanupLevel: "standard",
  sounds: DEFAULT_SOUNDS,
  muteWhileDictating: false,
  setupComplete: false,
  pressEnterCommand: true,
  creatorMode: false,
  sessionLimitMinutes: SESSION_LIMIT_DEFAULT,
  smartFormatting: true,
  bar: DEFAULT_BAR,
  insertion: DEFAULT_INSERTION,
  soundVolume: SOUND_VOLUME_DEFAULT,
  silentWarning: true,
  openHubOnLaunch: true,
  insights: { typingWpm: INSIGHTS_LIMITS.typingWpm.default },
  profile: { displayName: "", showOnHome: true },
  contextAwareness: true,
  mouseButtons: { hold: null, handsFree: null, pressEnter: null, copyLast: null },
  typingReminder: { enabled: true, snoozedUntil: null },
  whisperMode: false,
  memory: { enabled: true, fromDictation: true },
  learnCorrections: true,
  voiceProfile: { enabled: true, useInCleanup: true, prompts: true },
  email: DEFAULT_EMAIL,
  jargonPacks: DEFAULT_JARGON_PACKS,
  developerTools: DEFAULT_DEVELOPER_TOOLS,
  experimental: {
    splitMessages: false,
    pauseMedia: false,
    headsetWear: false,
    ringMicrophone: false,
    bulkImport: false,
    phraseLearning: false,
    styleDetection: false,
    pronunciationClips: false,
    commandMode: false,
    autoInstruct: false,
    focusMode: false,
    askConnectorActions: false,
    slackTagging: false,
  },
};
const settingsStore = createSettingsStore(database, settingsDefaults);
const keys = MAC_KEYS;
/** Plan gates (RW-22): read on every action, so a plan change applies at once. */
const allows = (feature: PlanFeature) => planAllows(settingsStore.get().plan, feature);
/** Why a connector may not be used on this plan, or null. */
const connectorRefusal = () => planRefusal(settingsStore.get().plan, "connectors");
const nextSession = createNextSession(
  () => settingsStore.get(),
  (change) => settingsStore.update(change),
);
const settingsService = createSettingsService({
  store: settingsStore,
  platform: keys,
  listDevices: () => helper.listAudioDevices(),
  defaults: settingsDefaults,
  rejected: () => hotkeys.rejected(),
  otherShortcuts: () => rewriteShortcutsInUse(rewrites?.list() ?? []),
});
const bindingsNow = () => [
  ...bindingsFor(settingsStore.get(), keys.cancelKeyCode),
  ...rewriteBindings(rewrites?.list() ?? []).slice(
    0,
    boundRewriteShortcuts(settingsStore.get().plan),
  ),
];

const hotkeys = createHotkeyService({
  helper,
  bindings: bindingsNow(),
  logger: createConsoleLogger("[hotkeys]"),
});
// New shortcuts reach the helper at once; no restart.
const refreshBindings = () => hotkeys.setBindings(bindingsNow());
settingsStore.onChange(refreshBindings);
permissions.onChecked((statuses) => hotkeys.handlePermissions(statuses));

/** The speech model the helper loads. */
const SPEECH_MODEL = DEFAULT_SPEECH_MODEL;
const speech = createSpeechService({
  helper,
  model: SPEECH_MODEL,
  root: speechModelRoot(profile.modelsAppData),
  logger: createConsoleLogger("[speech]"),
  languages: () => languagesFor(nextSession.settings()),
});

// First-run setup: the model download behind the setup screen, and what blocks dictation.
const modelDownload = createModelDownload({
  model: SPEECH_MODEL,
  download: (onProgress) =>
    Promise.resolve().then(() => {
      networkGuard.check("speech model download");
      return downloadModel(speechModelRoot(profile.modelsAppData), SPEECH_MODEL, {
        onProgress,
      });
    }),
  speechState: () => speech.getState(),
  onDownloaded: () => {
    speech.recheck();
    notifier.modelDownload(true);
  },
  onFailed: () => notifier.modelDownload(false),
  logger: createConsoleLogger("[setup]"),
});
let lastPermissions: PermissionSnapshot | null = null;
permissions.onChecked((statuses) => {
  lastPermissions = statuses;
});
const blockersNow = (): DictationBlocker[] =>
  dictationBlockers({
    helper: helper.getStatus().state,
    permissions: lastPermissions,
    speech: speech.getState(),
  });
/** Why dictation cannot start, or null. A permission is read again before it counts. */
/** DC-45: paused from the menu, until resumed there or the next start. */
let dictationPaused = false;

async function dictationBlocked(): Promise<string | null> {
  if (dictationPaused) return "Dictation is paused. Resume it from the menu bar.";
  // HB-19: Free stops at its weekly word limit; any other tier has none.
  if (weeklyLimitReached(settingsStore.get().plan, weekWords())) return PLAN_MESSAGES.weeklyLimit;
  let blockers = blockersNow();
  if (hasPermissionBlocker(blockers)) {
    await permissions.check("dictation start");
    blockers = blockersNow();
  }
  return blockerMessage(blockers);
}

const displayArea = (display: Electron.Display) => ({ id: display.id, workArea: display.workArea });
const barWindow = new BarWindow({
  create: (options) => new BrowserWindow(options),
  preloadPath: path.join(__dirname, "bar-preload.cjs"),
  entryUrl: barEntryUrl,
  isDevelopment,
  placement: () => settingsStore.get().bar,
  positionFile: barPositionFile(profile.userData),
  displays: () => screen.getAllDisplays().map(displayArea),
  primaryDisplay: () => displayArea(screen.getPrimaryDisplay()),
  logger: createConsoleLogger("[bar]"),
});
/** Focus Mode's time left, drawn on the idle Bar (RW-18). */
let focusBadge: BarView["focus"] = null;
/** A meeting being recorded, drawn on the Bar in every state (NT-04). */
let meetingBadge: BarView["meeting"] = null;
/** The recorder's last word on a dictation, after which its one-time choices are dropped. */
const SESSION_OVER: ReadonlySet<RecorderEvent["type"]> = new Set([
  "transcribed",
  "transcription-failed",
  "no-speech",
  "cancelled",
  "stop-failed",
  "start-failed",
  "command-heard",
  "tap-ignored",
]);
/** The dictation state the Hub shows (HB-03), following the Bar. */
let hubDictationState: DictationState = "idle";
/** The meeting a dictation is being made during, if one is (NT-19). */
let dictationMeeting: string | null = null;
/**
 * A dictation that records while a meeting does is a window on the meeting's timeline: the
 * microphone lines that overlap it are the dictation, not the meeting (NT-19). The recording is
 * never paused.
 */
function trackDictationWindow(before: DictationState, after: DictationState): void {
  if (after === "listening" && before !== "listening") {
    const recording = meetings?.state();
    if (recording?.status === "recording") {
      dictationWindows?.open(recording.meetingId, Date.now() - recording.startedAt);
      dictationMeeting = recording.meetingId;
    }
  } else if (before === "listening" && after !== "listening" && dictationMeeting) {
    const meeting = meetingsStore?.get(dictationMeeting);
    if (meeting) dictationWindows?.close(dictationMeeting, Date.now() - meeting.startedAt);
    dictationMeeting = null;
  }
}
/** The Hub's web contents for pushed events; set when the Hub opens (it may not exist yet). */
let hubEvents: Electron.WebContents | null = null;
const barPort = {
  render: (view: BarView) => {
    barWindow.render({ ...view, focus: focusBadge, meeting: meetingBadge });
    const state = dictationStateOf(view.state);
    if (state === hubDictationState) return;
    const before = hubDictationState;
    hubDictationState = state;
    trackDictationWindow(before, state);
    if (hubEvents && !hubEvents.isDestroyed()) hubEvents.send(IPC_EVENTS.dictationState, state);
  },
  level: (rmsDb: number) => barWindow.level(rmsDb),
};
const bar = createBarController(barPort, systemClock);
const rewritePanel = new RewritePanelWindow({
  create: (options) => new BrowserWindow(options),
  preloadPath: path.join(__dirname, "rewrite-preload.cjs"),
  entryUrl: rewriteEntryUrl,
  isDevelopment,
  barPosition: () => barWindow.position(),
  workArea: (point) =>
    (point
      ? screen.getDisplayNearestPoint({ x: point[0], y: point[1] })
      : screen.getPrimaryDisplay()
    ).workArea,
  logger: createConsoleLogger("[rewrite]"),
});
const instructPanel = new PanelWindow<InstructPanelState>(
  {
    create: (options) => new BrowserWindow(options),
    preloadPath: path.join(__dirname, "instruct-preload.cjs"),
    entryUrl: instructEntryUrl,
    isDevelopment,
    barPosition: () => barWindow.position(),
    workArea: (point) =>
      (point
        ? screen.getDisplayNearestPoint({ x: point[0], y: point[1] })
        : screen.getPrimaryDisplay()
      ).workArea,
    logger: createConsoleLogger("[instruct]"),
    pushChannel: INSTRUCT_PANEL_PUSH.state,
    size: INSTRUCT_PANEL_SIZE,
    title: "Murmur Instruct",
  },
  { stage: "hidden" },
);

// Sounds and output mute around each recording. The marker file exists only while Murmur
// holds the output muted, so a crash leaves a note for the next launch to undo.
const muteMarker = path.join(profile.userData, "output-muted-by-murmur.json");
const effects = createSessionEffects({
  settings: () => settingsStore.get(),
  playSound: (name) => {
    smokeChecks?.handleSound(name);
    const { soundVolume, sounds } = settingsStore.get();
    barWindow.sound(name, soundVolume / 100, sounds.set);
  },
  helper,
  marker: {
    exists: () => existsSync(muteMarker),
    write: (content) => writeFileSync(muteMarker, content),
    remove: () => rmSync(muteMarker, { force: true }),
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logger: createConsoleLogger("[media]"),
});
helper.onStatusChange((status) => {
  if (status.state === "ready") void effects.recover();
});

/** Feedback sounds for the steps the Bar shows. */
const SOUND_FOR: Partial<Record<RecorderEvent["type"], SoundName>> = {
  locked: "lock",
  transcribed: "success",
  "transcription-failed": "error",
  "start-failed": "error",
  cancelled: "cancel",
};

const cleanupRoot = cleanupModelRoot(profile.modelsAppData);
const cleanupModelFile = path.join(
  modelLocation(cleanupRoot, DEFAULT_CLEANUP_MODEL).dir,
  DEFAULT_CLEANUP_MODEL.files[0]!.path,
);
let cleanupModelCheck: Promise<boolean> | null = null;
const cleanupLogger = createConsoleLogger("[cleanup]");
const llm = createLlmClient({
  spawn: () => {
    const child = utilityProcess.fork(path.join(__dirname, "llm-worker.cjs"), [], {
      serviceName: "Murmur Cleanup",
    });
    return {
      post: (request) => child.postMessage(request),
      onMessage: (handler) => child.on("message", (reply: LlmReply) => handler(reply)),
      onExit: (handler) => child.on("exit", handler),
      kill: () => void child.kill(),
    };
  },
  modelPath: cleanupModelFile,
  clock: systemClock,
  logger: cleanupLogger,
});
// Every byte is checked once per run (about 2 s for 2.5 GB), then remembered.
const cleanupModelReady = (): Promise<boolean> => {
  cleanupModelCheck ??= checkModel(cleanupRoot, DEFAULT_CLEANUP_MODEL).then((result) => {
    if (!result.ok) {
      cleanupLogger.warn(
        result.reason === "missing"
          ? "The cleanup model is not downloaded; using rules only. Run `npm run model:download`."
          : `The cleanup model failed its ${result.reason} check (${result.file}); using rules only.`,
      );
    }
    return result.ok;
  });
  return cleanupModelCheck;
};
const cleanup = createCleanupService({
  llm,
  modelReady: cleanupModelReady,
  logger: cleanupLogger,
  level: () => nextSession.settings().cleanupLevel,
});
// The microphone for a session. In Auto: a real microphone over a virtual one, and not the
// built-in one while the lid is closed (roadmap M2 epic 7). Asked at each start.
let lastAutoChoice: string | null = null;
async function inputDevice(settings: Settings = settingsStore.get()): Promise<string | null> {
  const chosen = deviceFor(settings);
  if (chosen !== null) return chosen;
  const inputs = await Promise.race([
    helper.audioInputs().catch(() => null),
    new Promise<null>((done) => setTimeout(() => done(null), 300)),
  ]);
  const id = inputs ? chooseAutoDevice(inputs) : null;
  if (id !== lastAutoChoice) {
    const name = inputs?.devices.find((device) => device.id === id)?.name;
    console.log(
      id
        ? `[audio] Auto uses ${name ?? "another microphone"}${inputs?.lidClosed ? " (lid closed)" : ""}`
        : "[audio] Auto uses the system default",
    );
    lastAutoChoice = id;
  }
  return id;
}

// File tags (PZ-24): the workspace of an AI editor, from its window title.
const developerLogger = createConsoleLogger("[developer]");
const workspaceIndexer = createWorkspaceIndexer();
async function workspaceFor(app: {
  bundleId: string | null;
  windowTitle: string | null;
}): Promise<string | null> {
  const tools = settingsStore.get().developerTools;
  if (!tools.fileTags || !app.bundleId || !TAG_EDITORS.has(app.bundleId)) return null;
  return findWorkspace(app.windowTitle, tools.codeFolders);
}
// Jargon packs (PZ-27): rebuilt only when the pack switches change.
let developerCache: { key: string; vocabulary: DeveloperVocabulary } | null = null;
function developerVocabularyNow(): DeveloperVocabulary {
  const packs = settingsStore.get().jargonPacks;
  const key = JSON.stringify(packs);
  if (developerCache?.key !== key) developerCache = { key, vocabulary: developerVocabulary(packs) };
  return developerCache.vocabulary;
}
const translateEmail = createTranslator({
  llm,
  modelReady: cleanupModelReady,
  logger: createConsoleLogger("[email]"),
});

// HB-48: no text is read from an app on the private list.
const privateFocus = createPrivateFocus(
  (input) => helper.focusContext(input),
  () => settingsStore.get().privacy.contextExcludedApps,
);

const recorder = createRecorder({
  helper,
  logger: createConsoleLogger("[audio]"),
  newSessionId: randomUUID,
  transcribe: (file, { prompt, audioMs }) => {
    if (smokeFailNextTranscription) {
      smokeFailNextTranscription = false;
      return Promise.reject(
        new HelperError("TRANSCRIPTION_FAILED", "failed on purpose by the smoke test"),
      );
    }
    return speech.transcribe(file, prompt, audioMs);
  },
  readContext: async () => {
    // With context awareness off, only the app and its window are asked for (for the style);
    // no text around the caret. Without Accessibility there is no context at all.
    const on = settingsStore.get().contextAwareness;
    const context = await privateFocus(on ? {} : { maxBefore: 0, maxAfter: 0 }).catch(() => null);
    smokeChecks?.handleContext(context);
    // File tags: index the editor's workspace while the owner speaks.
    if (context) {
      void workspaceFor(context).then((root) => {
        if (root) void workspaceIndexer.prepare(root);
      });
    }
    return context;
  },
  useContextText: () =>
    settingsStore.get().contextAwareness && !settingsStore.get().devMode.disableContext,
  logTranscripts: process.env.MURMUR_LOG_TRANSCRIPTS === "1",
  focusNow: () => helper.focusContext({ maxBefore: 0, maxAfter: 0 }),
  insert: (text, { pressEnter, html, keepOnClipboard }) => {
    // During a smoke run text may only go into the test box.
    smoke?.assertFieldFocused();
    return helper.insertText({
      text,
      // HB-57: the Testing page can force typed insertion.
      method: insertionMethod(
        settingsStore.get().insertion.method,
        settingsStore.get().devMode.forceTyped,
      ),
      restoreClipboard: !keepOnClipboard,
      restoreDelayMs: 350,
      pressEnter,
      ...(html ? { html } : {}),
      ...insertionRules(settingsStore.get().insertion),
    });
  },
  pressEnterCommand: () => settingsStore.get().pressEnterCommand,
  silentWarning: () => settingsStore.get().silentWarning,
  formatting: () => {
    const { cleanupLevel, smartFormatting } = nextSession.settings();
    return {
      lists: cleanupLevel === "standard" || cleanupLevel === "full",
      smart: smartFormatting,
    };
  },
  sessionLimitMinutes: () => settingsStore.get().sessionLimitMinutes,
  copy: (text) => helper.copyText(text),
  onEvent: (event) => {
    bar.dispatch(barEventFor(event));
    if (event.type === "started") nextSession.started();
    else if (SESSION_OVER.has(event.type)) nextSession.finished();
    // A new recording ends the watch for corrections to the last one.
    if (event.type === "started") void helper.cancelEdits().catch(() => {});
    smokeChecks?.handleBarView(bar.getView());
    smokeChecks?.handleRecorderEvent(event);
    tray?.handleRecorderEvent(event);
    smoke?.handleRecorderEvent(event);
    const sound = SOUND_FOR[event.type];
    if (sound) effects.sound(sound);
  },
  blocked: dictationBlocked,
  beforeStart: () => effects.beforeStart(),
  afterEnd: () => effects.afterEnd(),
  // HB-57: with cleanup off on the Testing page, only the deterministic rules run.
  clean: (text, options) =>
    cleanup.clean(
      text,
      settingsStore.get().devMode.disableCleanup ? { ...options, budgetMs: 0 } : options,
    ),
  email: { settings: () => settingsStore.get().email, translate: translateEmail },
  developer: {
    vocabulary: () => developerVocabularyNow(),
    variables: () => settingsStore.get().developerTools.variables,
    workspaceFiles: async (app) => {
      const root = await workspaceFor(app);
      if (!root) return null;
      // The index was started when recording began; wait a little for a large one.
      const files = await Promise.race([
        workspaceIndexer.prepare(root),
        new Promise<null>((done) => setTimeout(() => done(null), 1500)),
      ]);
      developerLogger.info(
        files ? `file tags: ${files.length} files in the workspace` : "file tags: index not ready",
      );
      return files;
    },
    codingCli: async (app) => {
      const tools = settingsStore.get().developerTools;
      if (!tools.cliDetection || !app.bundleId || !TERMINALS.has(app.bundleId)) return false;
      const names = await Promise.race([
        helper.foregroundProcesses(),
        new Promise<string[]>((done) => setTimeout(() => done([]), 500)),
      ]);
      return codingCliRunning(names, app.windowTitle, tools.cliNames);
    },
  },
  prepareCleanup: () => cleanup.prepare(),
  styleDetection: () => settingsStore.get().experimental.styleDetection,
  // Called only during a dictation, after the auto-rewriter below exists.
  autoRewrite: (text, category, appBundleId) => autoRewrite(text, category, appBundleId),
  record: (dictation) => {
    // HB-48: with Store history off, no dictation row is written; Insights keep counts only.
    const storeHistory = settingsStore.get().privacy.storeHistory;
    const id = storeHistory ? (history?.add(dictation) ?? null) : null;
    // A cancelled dictation is listed, and counts for nothing else.
    if (dictation.errorCode === CANCELLED) return id;
    try {
      insights?.record({
        createdAt: dictation.createdAt,
        words: dictation.wordCount,
        durationMs: dictation.durationMs,
        insertStatus: dictation.insertStatus,
        appBundleId: storeHistory ? (dictation.appBundleId ?? null) : null,
        appName: storeHistory ? (dictation.appName ?? null) : null,
      });
    } catch (error) {
      console.warn(`[insights] could not count a dictation: ${String(error)}`);
    }
    checkMilestones(true);
    lastTranscript.remember(dictation.finalText ?? "", id !== null);
    if (dictation.insertStatus === "failed") notifier.dictationFailed();
    if (dictation.insertStatus === "inserted" && dictation.finalText) {
      lastDictation = {
        text: dictation.finalText,
        appBundleId: dictation.appBundleId ?? null,
        at: Date.now(),
      };
    }
    learnVoice(dictation, id);
    // Phrase learning (PZ-05, experimental): from text that went in only.
    if (
      phraseLearner &&
      settingsStore.get().experimental.phraseLearning &&
      dictation.insertStatus === "inserted" &&
      dictation.finalText
    ) {
      const learned = phraseLearner.learn(dictation.finalText);
      if (learned.length > 0) console.log(`[dictionary] learned ${learned.length} phrase(s)`);
    }
    return id;
  },
  voiceSummary: () => {
    const flags = settingsStore.get().voiceProfile;
    return flags.enabled && flags.useInCleanup ? (voiceProfile?.summary(Date.now()) ?? null) : null;
  },
  deviceId: () => inputDevice(nextSession.settings()),
  whisperMode: () => nextSession.settings().whisperMode,
  ...(history
    ? {
        pending: {
          start: (sessionId: string, at: number) => history.markPending(sessionId, at),
          stopped: (sessionId: string, file: string, ms: number) =>
            history.pendingStopped(sessionId, file, ms),
          clear: (sessionId: string) => history.clearPending(sessionId),
        },
      }
    : {}),
  lastRetryable: () => history?.lastRetryable(Date.now()) ?? null,
  isResolved: (historyId) => history?.isResolved(historyId) ?? false,
  waitForSpeech: () => speech.whenReady(),
  ...(dictionary
    ? {
        dictionary: {
          rules: () => dictionary.rules(),
          recordUses: (ids: string[]) => dictionary.recordUses(ids),
        },
      }
    : {}),
  ...(snippets
    ? {
        snippets: {
          list: () => snippets.list(),
          recordUse: (id: string) => snippets.recordUse(id),
        },
      }
    : {}),
  afterInsert: (text: string) => {
    if (!learner || !settingsStore.get().learnCorrections) return;
    lastInserted = text;
    void helper
      .watchEdits({ text: text.slice(0, 20_000), durationMs: EDIT_WATCH_MAX_MS })
      .catch(() => {});
  },
  ...(styles ? { styles } : {}),
  ...(memory
    ? {
        memory: {
          facts: (text: string) =>
            settingsStore.get().memory.enabled
              ? memory.relevant(text).map((item) => item.text)
              : [],
          offer: (fact: string) => {
            if (!settingsStore.get().memory.fromDictation) return false;
            offeredFact = { text: fact, until: Date.now() + MEMORY_LIMITS.offerMs };
            return true;
          },
        },
      }
    : {}),
  rewriteText: (text) => (wantsLatinHindi(nextSession.settings()) ? toLatinHindi(text) : text),
  // Command Mode (RW-08, experimental). The runner below exists before any recording ends.
  command: {
    enabled: () => settingsStore.get().experimental.commandMode && allows("commandMode"),
    wakePhrase: () => {
      const options = settingsStore.get().commandMode;
      return options.wakePhraseEnabled ? options.wakePhrase : null;
    },
    run: (phrase, trigger) => commandRunner.run(phrase, trigger),
  },
  // Instruct Mode (RW-11). The controller below exists before any recording ends.
  instruct: { run: (instruction) => instructController.spoken(instruction) },
  autoInstruct: {
    enabled: () => settingsStore.get().experimental.autoInstruct,
    ask: () =>
      askOnBar(INSTRUCT_MESSAGES.autoAsk, "Or it goes in as dictated.", AUTO_INSTRUCT_ASK_MS),
  },
});
const micCheck = createMicCheck({
  helper,
  logger: createConsoleLogger("[mic-check]"),
  newSessionId: () => `check-${randomUUID()}`,
  deviceId: () => inputDevice(),
  whisper: () => settingsStore.get().whisperMode,
  isDictating: () => recorder.isBusy(),
  sendLevel: (rmsDb) => hubWindow?.webContents.send(IPC_EVENTS.micCheckLevel, rmsDb),
});
// Pronunciation clips (PZ-06, experimental), kept next to the database.
const clips = dictionary
  ? createClipRecorder({
      helper,
      dictionary,
      dir: path.join(profile.appData, "Murmur", "clips"),
      isDictating: () => recorder.isBusy() || micCheck.isRunning(),
      deviceId: () => inputDevice(),
      newSessionId: () => `clip-${randomUUID()}`,
      clock: systemClock,
      logger: createConsoleLogger("[clips]"),
    })
  : null;
// Rewrites (RW-01, RW-07): the generation engine on the cleanup model, and the panel.
const generation = createGenerationService({
  llm,
  modelReady: cleanupModelReady,
  logger: createConsoleLogger("[generate]"),
});
// Instruct Mode's Quality model (RW-15): its own worker, started only when a thread uses it,
// so the cleanup model stays loaded for dictation.
const qualityFile = path.join(
  modelLocation(cleanupRoot, QUALITY_INSTRUCT_MODEL).dir,
  QUALITY_INSTRUCT_MODEL.files[0]!.path,
);
let qualityReadyNow = false;
const qualityModel = createQualityModel({
  model: QUALITY_INSTRUCT_MODEL,
  check: () => checkModel(cleanupRoot, QUALITY_INSTRUCT_MODEL),
  download: (onProgress) =>
    Promise.resolve().then(() => {
      networkGuard.check("Quality model download");
      return downloadModel(cleanupRoot, QUALITY_INSTRUCT_MODEL, { onProgress });
    }),
  remove: async () => {
    qualityLlm.stop();
    await rm(modelLocation(cleanupRoot, QUALITY_INSTRUCT_MODEL).dir, {
      recursive: true,
      force: true,
    });
  },
  onChange: (ready) => {
    qualityReadyNow = ready;
  },
  logger: createConsoleLogger("[instruct]"),
});
void qualityModel.isReady().then((ready) => {
  qualityReadyNow = ready;
});
const qualityLlm = createLlmClient({
  spawn: () => {
    const child = utilityProcess.fork(path.join(__dirname, "llm-worker.cjs"), [], {
      serviceName: "Murmur Instruct Quality",
    });
    return {
      post: (request) => child.postMessage(request),
      onMessage: (handler) => child.on("message", (reply: LlmReply) => handler(reply)),
      onExit: (handler) => child.on("exit", handler),
      kill: () => void child.kill(),
    };
  },
  modelPath: qualityFile,
  clock: systemClock,
  logger: createConsoleLogger("[instruct]"),
});
const qualityGeneration = createGenerationService({
  llm: qualityLlm,
  modelReady: () => qualityModel.isReady(),
  logger: createConsoleLogger("[generate]"),
});
const activateApp = activateMacApp;
const rewriteController = createRewriteController({
  helper,
  rewrites: {
    enabled: () => rewrites?.enabled() ?? [],
    get: (id) => rewrites?.get(id) ?? null,
    markUsed: (id) => rewrites?.markUsed(id),
  },
  runs: rewriteRuns,
  generation,
  panel: rewritePanel,
  notify: (message) => bar.dispatch({ type: "warn", message }),
  activateApp,
  context: (appId, text) => rewriteContext(appId, text),
  // Web editors (Google Docs and the like) report the wrong selection through Accessibility.
  clipboardFirstInApps: () => [...BROWSERS],
  insertRules: () => insertionRules(settingsStore.get().insertion),
  logger: createConsoleLogger("[rewrite]"),
});
/** Style notes, matching Memory facts and (in Email apps) writing samples for a Rewrite. */
function rewriteContext(appId: string | null, text: string) {
  const resolved = styles?.resolve({ bundleId: appId, windowTitle: null }) ?? null;
  const preset = resolved ? PRESETS[resolved.style.preset].instruction : null;
  const own = resolved?.style.instructions.trim() ?? "";
  const settings = settingsStore.get();
  return {
    style: [preset, own].filter((note): note is string => Boolean(note)),
    memory: settings.memory.enabled ? (memory?.relevant(text).map((item) => item.text) ?? []) : [],
    // Writing samples were collected for email (PZ-20); elsewhere they would pull the tone.
    samples:
      resolved?.category === "email"
        ? (writingSamples?.list() ?? []).map((sample) => sample.text)
        : [],
  };
}
// Auto-apply (RW-05): one Rewrite on every dictation, within 3 s.
const autoRewrite = createAutoRewriter({
  // Free has no auto-apply (RW-22): no Rewrite counts as auto-applying.
  rewrites: {
    list: () => (allows("autoApply") ? (rewrites?.list() ?? []) : []),
    markUsed: (id) => rewrites?.markUsed(id),
  },
  generation,
  context: rewriteContext,
  runs: rewriteRuns,
  logger: createConsoleLogger("[rewrite]"),
});
// Instruct Mode (RW-11, RW-17): drafts from a spoken instruction, with the allowed context.
const instructThreads = database ? createInstructThreadStore(database) : null;
// Undo of Murmur's own edits (RW-10, RW-13), for Command Mode and Instruct Mode.
const undo = createUndoService({
  helper,
  mayReadField: () => settingsStore.get().contextAwareness,
  insertRules: () => insertionRules(settingsStore.get().insertion),
  activateApp,
  logger: createConsoleLogger("[undo]"),
});
const instructController = createInstructController({
  helper,
  generation: (model) => (model === "quality" ? qualityGeneration : generation),
  qualityReady: () => qualityReadyNow && allows("qualityModel"),
  qualityLocked: () => !allows("qualityModel"),
  panel: instructPanel,
  threads: instructThreads,
  undo,
  modelId: (model) => (model === "quality" ? QUALITY_INSTRUCT_MODEL.id : DEFAULT_CLEANUP_MODEL.id),
  notify: (message) => bar.dispatch({ type: "warn", message }),
  activateApp,
  context: (appId, text) => rewriteContext(appId, text),
  settings: () => {
    const settings = settingsStore.get();
    return { instruct: settings.instruct, contextAwareness: settings.contextAwareness };
  },
  clipboardFirstInApps: () => [...BROWSERS],
  insertRules: () => insertionRules(settingsStore.get().insertion),
  logger: createConsoleLogger("[instruct]"),
});
// Command Mode (RW-08, RW-09): rules first, then the model may pick a command id.
const commandLogger = createConsoleLogger("[command]");
const commandRunner = createCommandRunner({
  offerUndo: () => {
    // After the command's own message has had its moment (RW-10).
    setTimeout(() => {
      bar.dispatch({
        type: "ask",
        message: UNDO_QUESTION,
        detail: "Undo puts the previous text back.",
        actions: [
          { answer: "yes", label: "Undo", primary: true },
          { answer: "no", label: "Keep" },
        ],
        timeoutMs: UNDO_OFFER_MS,
      });
    }, BAR_WARNING_MS).unref();
  },
  helper,
  chooseWithModel: async (phrase) => {
    if (!(await cleanupModelReady())) return null;
    const { system, prompt } = commandChoicePrompt(phrase);
    const job = llm.generate(
      { system, prompt, maxTokens: COMMAND_CHOICE_MAX_TOKENS },
      { timeoutMs: GENERATION_LIMITS.command.timeoutMs },
    );
    const answer = await job.result;
    const id = parseCommandChoice(answer);
    commandLogger.info(`model picked ${id ?? "none"}`);
    return id;
  },
  panel: rewriteController,
  notify: (message) => bar.dispatch({ type: "warn", message }),
  ask: askOnBar,
  lastDictation: () => lastDictation,
  mayReadField: () => settingsStore.get().contextAwareness,
  runs: commandRuns,
  undo,
  clipboardFirstInApps: () => [...BROWSERS],
  insertRules: () => insertionRules(settingsStore.get().insertion),
  logger: commandLogger,
});
// Source text of old runs is cut to 200 characters after 7 days.
const trimRewriteRuns = () => {
  try {
    const trimmed = (rewriteRuns?.trimOld() ?? 0) + (commandRuns?.trimOld() ?? 0);
    if (trimmed > 0) console.log(`[rewrite] trimmed ${trimmed} old runs`);
    // Instruct threads (RW-14) are in the daily retention job (HB-50).
  } catch (error) {
    console.warn(`[rewrite] could not trim old runs: ${String(error)}`);
  }
};
trimRewriteRuns();
setInterval(trimRewriteRuns, 24 * 60 * 60_000).unref();

// Focus Mode (RW-18 to RW-21, experimental).
const focusStore = database ? createFocusStore(database) : null;
// A session left open by a crash ended when Murmur did.
focusStore?.endOpen("quit");
const focusOverlay = new FocusOverlayWindow({
  create: (options) => new BrowserWindow(options),
  preloadPath: path.join(__dirname, "focus-preload.cjs"),
  entryUrl: focusEntryUrl,
  isDevelopment,
  displayBounds: () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds,
  logger: createConsoleLogger("[focus]"),
});
const focus = createFocusController({
  rules: () => focusStore?.all() ?? [],
  sessions: focusStore,
  enabled: () => settingsStore.get().experimental.focusMode && allows("focusMode"),
  lastDuration: () => settingsStore.get().focus.duration,
  saveDuration: (duration) => settingsStore.update({ focus: { duration } }),
  watchFrontApp: (enabled) => helper.watchFrontApp(enabled),
  overlay: focusOverlay,
  say: (message) => {
    bar.dispatch({ type: "warn", message });
    if (message === FOCUS_MESSAGES.ended) notifier.focusEnded();
  },
  activateApp,
  fallbackApp: "com.apple.finder",
  pressBack: async (bundleId) =>
    (await helper.pressKey({ key: "left_bracket", modifiers: ["command"], onlyInApp: bundleId }))
      .pressed,
  ownPid: process.pid,
  clock: systemClock,
  logger: createConsoleLogger("[focus]"),
  onChange: (state) => {
    focusBadge = state.status === "on" ? { endsAt: state.endsAt } : null;
    barPort.render(bar.getView());
    tray?.refresh();
  },
});
helper.onFrontApp((front) => focus.frontApp(front));
helper.onStatusChange((status) => {
  if (status.state === "ready") focus.helperReady();
});
settingsStore.onChange(() => focus.refresh());
// HB-52: strict local mode keeps learning, the Voice Profile and recordings off.
settingsStore.onChange(() => {
  const settings = settingsStore.get();
  if (!settings.privacy.strictLocal) return;
  if (
    settings.learnCorrections ||
    settings.voiceProfile.enabled ||
    settings.privacy.audio !== "never"
  ) {
    settingsStore.update({
      learnCorrections: false,
      voiceProfile: { ...settings.voiceProfile, enabled: false },
      privacy: { ...settings.privacy, audio: "never" },
    });
  }
});

// HB-43: the referral code is made once, here, and kept. Nothing is sent.
if (settingsStore.get().referral.code === "") {
  settingsStore.update({
    referral: {
      ...settingsStore.get().referral,
      code: referralCode((count) => randomBytes(count)),
    },
  });
}

// HB-19: the trial, the student label and the change log.
let lastTier = settingsStore.get().plan;
const plans = createPlanController({
  tier: () => settingsStore.get().plan,
  state: () => settingsStore.get().planState,
  save: (change) => {
    if (change.plan) lastTier = change.plan;
    settingsStore.update(change);
  },
  now: () => Date.now(),
});
settingsStore.onChange(() => {
  const tier = settingsStore.get().plan;
  if (tier === lastTier) return;
  const from = lastTier;
  lastTier = tier;
  plans.tierChanged(from, tier);
});
plans.expire();
setInterval(() => plans.expire(), 60 * 60_000).unref();

/**
 * HB-53, HB-55, HB-08: a diagnostics bundle in a folder the user picks: versions, settings
 * with personal fields masked, and counts. Never any text; nothing is sent.
 */
async function writeDiagnostics(): Promise<TestingToolResult> {
  const options = {
    title: "Choose where to save the diagnostics bundle",
    buttonLabel: "Save here",
    defaultPath: app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[],
  };
  const choice = hubWindow
    ? await dialog.showOpenDialog(hubWindow, options)
    : await dialog.showOpenDialog(options);
  const parent = choice.filePaths[0];
  if (choice.canceled || !parent) return { ok: false, message: "" };
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
  const folder = path.join(parent, `Murmur diagnostics ${stamp}`);
  mkdirSync(folder, { recursive: true });
  const report = diagnosticsReport({
    app: {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron ?? "",
      node: process.versions.node,
    },
    system: { platform: process.platform, release: os.release(), arch: process.arch },
    helper: helper.getStatus(),
    settings: settingsStore.get(),
    counts: dataDeleter?.counts() ?? { categories: [], failedFiles: 0 },
    retention: retention?.view() ?? { lastRunAt: null, nextRunAt: null, removed: {} },
    now: Date.now(),
  });
  writeFileSync(path.join(folder, "diagnostics.json"), `${JSON.stringify(report, null, 2)}\n`);
  return { ok: true, message: `Saved to ${folder}.` };
}

/** HB-55: the Testing page's tools. Developer mode only; none sends anything anywhere. */
async function runTestingTool(tool: TestingTool): Promise<TestingToolResult> {
  if (!settingsStore.get().devMode.enabled) {
    return { ok: false, message: "Developer mode is off." };
  }
  switch (tool) {
    case "restartOnboarding":
      settingsStore.update({ setupComplete: false });
      return { ok: true, message: "Setup will run again." };
    case "resetPersonalisation": {
      let rows = 0;
      for (const category of [
        "dictionary",
        "snippets",
        "styles",
        "memory",
        "voiceProfile",
        "learnedCandidates",
      ] as const) {
        rows += dataDeleter?.delete(category).rows ?? 0;
      }
      return { ok: true, message: `Personalisation reset: ${rows} items deleted.` };
    }
    case "testNotification":
      notifier.test();
      return { ok: true, message: "A test notification was sent." };
    case "cycleBar": {
      if (hubDictationState !== "idle") {
        return { ok: false, message: "Wait for the dictation to end." };
      }
      const steps: BarEvent[] = [
        { type: "start", at: Date.now() },
        { type: "lock" },
        { type: "stop" },
        { type: "transcribed", words: 12 },
        { type: "warn", message: "This is how a warning looks." },
        { type: "failed", message: "This is how an error looks." },
        { type: "cancel" },
      ];
      steps.forEach((step, index) => setTimeout(() => bar.dispatch(step), index * 2000));
      return { ok: true, message: "The Bar shows each state for two seconds." };
    }
    case "diagnostics":
      return writeDiagnostics();
  }
}

/** Words dictated this week, Monday to now (HB-19). */
function weekWords(): number {
  const monday = weekStart(localDate(Date.now()));
  return (insights?.days(monday) ?? []).reduce((total, day) => total + day.words, 0);
}

function planView() {
  const settings = settingsStore.get();
  return {
    tier: settings.plan,
    weekWords: weekWords(),
    weeklyLimit: settings.plan === "free" ? FREE_WEEKLY_WORDS : null,
    state: settings.planState,
  };
}

// HB-22: one switch for every window. Each page follows prefers-color-scheme (and Astryx's
// "system" mode), which this sets for all of them at once.
nativeTheme.themeSource = settingsStore.get().theme;
settingsStore.onChange(() => {
  const theme = settingsStore.get().theme;
  if (nativeTheme.themeSource !== theme) nativeTheme.themeSource = theme;
});

// HB-17: the Bar's settings apply at once.
settingsStore.onChange((_settings, changed) => {
  if (!changed.includes("bar")) return;
  barWindow.place();
  barPort.render(bar.getView());
});

// HB-34: turning Scratchpad off closes its window; notes stay on disk.
settingsStore.onChange(() => {
  if (
    !settingsStore.get().scratchpad.enabled &&
    scratchpadWindow &&
    !scratchpadWindow.isDestroyed()
  ) {
    scratchpadWindow.close();
  }
});

/** NT-13: the recap shortcut. Opens the meeting being recorded and writes its recap. */
async function recapNow(): Promise<void> {
  const state = meetings?.state();
  if (state?.status !== "recording" || !recapRunner) {
    bar.dispatch({ type: "warn", message: "No meeting is being recorded" });
    return;
  }
  openHubPage("notetaker");
  try {
    await recapRunner.run(state.meetingId);
  } catch (error) {
    console.warn(`[recap] ${error instanceof Error ? error.message : String(error)}`);
    bar.dispatch({ type: "warn", message: "The recap could not be written" });
  }
}

hotkeys.onEvent((event) => {
  if (event.action === "notetaker.start") {
    // A press starts a recording, and the next one stops it (NT-03).
    if (event.state !== "up") void meetingStarter?.toggle();
    return;
  }
  if (event.action === "notetaker.recap") {
    if (event.state !== "up") void recapNow();
    return;
  }
  if (event.action === "scratchpad.open") {
    if (event.state !== "up" && settingsStore.get().scratchpad.enabled) openScratchpad();
    return;
  }
  if (event.action === "copy.last" || event.action === "paste.last") {
    if (event.state === "up") return;
    void (event.action === "copy.last" ? lastTranscript.copy() : lastTranscript.paste());
    return;
  }
  if (event.action === "press.enter") {
    if (event.state !== "up")
      void helper.pressKey({ key: "return", modifiers: [] }).catch((error: unknown) => {
        console.warn(`[hotkeys] could not press Return: ${String(error)}`);
      });
    return;
  }
  if (event.action === "focus.toggle") {
    if (event.state !== "up") focus.toggle();
    return;
  }
  if (event.action === "rewrite") {
    if (event.state === "up" || !event.rewriteId) return;
    if (event.rewriteId === REWRITE_PANEL_BINDING_ID) void rewriteController.open();
    else void rewriteController.runDirect(event.rewriteId);
    return;
  }
  recorder.handleHotkey(event);
});
helper.onAudioLevel((level) => bar.level(level.rmsDb));
helper.onEditsChanged((change) => {
  if (!learner || !lastInserted || !settingsStore.get().learnCorrections) return;
  const learned = learner.learn(change, lastInserted);
  if (learned) console.log(`[dictionary] learned a ${learned.kind} from a correction`);
});

// NT-04: meeting recordings. The helper writes the chunk files; main keeps the rows.
// NT-12: people mentioned in notes, tasks and Ask.
const contactsStore = database
  ? createContactsStore(database, {
      now: Date.now,
      newId: () => randomBytes(8).toString("hex"),
    })
  : null;
const meetingsStore = database
  ? createMeetingsStore(database, {
      onAttendees: (attendees) => {
        if (!settingsStore.get().notetaker.contacts.fromCalendar) return;
        try {
          contactsStore?.addAttendees(attendees);
        } catch (error) {
          console.warn(`[contacts] could not add the attendees: ${String(error)}`);
        }
      },
    })
  : null;
const meetingTranscripts = database ? createTranscriptStore(database) : null;
const meetingNotes = database ? createMeetingNotesStore(database) : null;
const meetingSummaries = database ? createSummariesStore(database) : null;
const meetingSkills = database ? createSkillsStore(database) : null;
// NT-22: retention of meeting audio and transcripts, joined to the daily retention job.
const meetingRetention = database
  ? createMeetingRetention(database, {
      settings: () => {
        const notetaker = settingsStore.get().notetaker;
        return { ...notetaker.retention, summaryAuto: notetaker.summary.auto };
      },
      removeFile: (file) => rmSync(file, { force: true }),
      logger: createConsoleLogger("[retention]"),
    })
  : null;
// NT-19: when a dictation recorded during a meeting.
const dictationWindows = database ? createDictationWindows(database) : null;
dictationWindows?.closeLost();
// NT-17: personal folders for meetings. The Inbox is the meetings in no folder.
const foldersStore = database
  ? createFoldersStore(database, { now: Date.now, newId: randomUUID })
  : null;
// NT-16: custom Skills. Each is also kept as a `.md` file in the Skills folder.
const skillsFolder = path.join(profile.appData, "Murmur", "Skills");
const skillsService = meetingSkills
  ? createSkillsService({
      store: meetingSkills,
      newId: randomUUID,
      now: Date.now,
      folder: {
        write: (fileName, text) => {
          mkdirSync(skillsFolder, { recursive: true });
          writeFileSync(path.join(skillsFolder, fileName), text);
        },
        remove: (fileName) => rmSync(path.join(skillsFolder, fileName), { force: true }),
      },
      onRemoved: (id) => {
        const current = settingsStore.get().notetaker;
        if (current.skills.default === id)
          settingsStore.update({
            notetaker: { ...current, skills: { ...current.skills, default: DEFAULT_SKILL_ID } },
          });
      },
    })
  : null;
// CN-01: connectors. The tokens are in the Keychain, reached through the helper; the database
// has only the accounts and a cache. The providers (Google Calendar, ...) are added to this
// list one by one in M6.
const connectorKeychain = createHelperKeychain(helper);
const connectorStore = database ? createConnectorStore(database) : null;
const connectorsFile = path.join(profile.appData, "Murmur", "connectors.json");
const connectorConfig = createConnectorConfig({
  readFile: () => {
    try {
      return readFileSync(connectorsFile, "utf8");
    } catch {
      return null;
    }
  },
  writeFile: (text) => {
    mkdirSync(path.dirname(connectorsFile), { recursive: true });
    writeFileSync(connectorsFile, text);
  },
  keychain: connectorKeychain,
});
const connectorRegistry = createConnectorRegistry([
  googleCalendarProvider,
  outlookCalendarProvider,
  gmailProvider,
  slackProvider,
  notionProvider,
  linearProvider,
  githubProvider,
  zoomProvider,
  firefliesProvider,
]);
const connectorService = connectorStore
  ? createConnectorService({
      registry: connectorRegistry,
      store: connectorStore,
      keychain: connectorKeychain,
      config: connectorConfig,
      // Strict local mode (HB-52): no sign-in and no request to a provider.
      http: (url, init) => {
        networkGuard.check("connector request");
        return fetch(url, init);
      },
      openExternal: (url) => shell.openExternal(url),
      networkRefusal: () => {
        try {
          networkGuard.check("connector sign-in");
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
      now: Date.now,
      newId: randomUUID,
      logger: createConsoleLogger("[connectors]"),
    })
  : null;
connectorStore?.cachePrune(Date.now());
// CN-02, CN-03: the events of the days around now, read from the providers every 15 minutes
// (or as the owner chose) and kept on this Mac.
const calendarStore = database
  ? createCalendarStore(database, () => settingsStore.get().connectors.privateTitlesAsBusy)
  : null;
/** CN-15: whether a feature's switch on the Connectors page is on. */
const featureOn = (id: string) => connectorFeatureOn(settingsStore.get().connectors, id);
const calendarSync =
  connectorService && connectorStore && calendarStore
    ? createCalendarSync({
        connectors: connectorService,
        connectorStore,
        store: calendarStore,
        settings: () => settingsStore.get().connectors,
        now: Date.now,
        logger: createConsoleLogger("[calendar]"),
        // New events change the menu bar at once.
        onChange: () => tray?.refresh(),
      })
    : null;
calendarSync?.start();
// CN-05 to CN-08: what Slack, Notion, Linear and GitHub said, kept for briefs and Ask.
const connectorData =
  connectorService && connectorStore
    ? createConnectorData({
        connectors: connectorService,
        connectorStore,
        settings: () => settingsStore.get().connectors,
        now: Date.now,
        logger: createConsoleLogger("[connector-data]"),
      })
    : null;
connectorData?.start();
/** A folder call's result: the folders as they are now, or why it did not work. */
function folderResult(
  outcome: { ok: true; id: string } | { ok: false; message: string } | undefined,
): FolderResult {
  if (!foldersStore) return { ok: false, message: "Folders need the database." };
  if (!outcome) return { ok: false, message: "That folder is gone." };
  return outcome.ok ? { ok: true, folders: foldersStore.list(), id: outcome.id } : outcome;
}
const noTasks = { ok: false as const, message: "Tasks cannot be saved without the database." };
const noSkills = { ok: false as const, message: "Skills cannot be saved without the database." };
// One call of the local model for the Notetaker's background work (summaries, tasks).
async function meetingGenerate(
  request: { system: string; prompt: string; maxTokens: number },
  model: Pick<typeof llm, "generate"> = llm,
): Promise<string> {
  const job = model.generate(request, { timeoutMs: 180_000, onChunk: () => {} });
  try {
    return await job.result;
  } catch (error) {
    // Another request took the model: the step is asked again later.
    if (error instanceof LlmCancelledError || error instanceof LlmPreemptedError) {
      throw Object.assign(error, { retry: true });
    }
    throw error;
  }
}
// NT-09: summaries on the local model. A dictation or a Rewrite always goes first.
const summaryRunner =
  meetingsStore && meetingTranscripts && meetingNotes && meetingSummaries && meetingSkills
    ? createSummaryRunner({
        hasMeeting: (id) => meetingsStore.get(id) !== null,
        segments: (id) => meetingTranscripts.segments(id),
        notes: (id) => meetingNotes.notes(id).body,
        summaries: meetingSummaries,
        skills: meetingSkills,
        settings: () => {
          const settings = settingsStore.get().notetaker;
          return {
            skillId: settings.skills.default,
            length: settings.summary.length,
            language: settings.summary.language,
          };
        },
        // NT-05: a recording the owner started keeps a made-up name until its summary names it.
        title: {
          wanted: (id) => meetingsStore.get(id)?.source === "ad_hoc",
          set: (id, title) => void meetingsStore.setGeneratedTitle(id, title),
        },
        folderSkill: (id) => foldersStore?.defaultSkillOf(id) ?? null,
        modelId: DEFAULT_CLEANUP_MODEL.id,
        modelReady: cleanupModelReady,
        generate: meetingGenerate,
        quality: {
          modelId: QUALITY_INSTRUCT_MODEL.id,
          ready: async () => allows("qualityModel") && (await qualityModel.isReady()),
          generate: (request) => meetingGenerate(request, qualityLlm),
        },
        dictating: () => hubDictationState !== "idle",
        generating: () => llm.isGenerating(),
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
        newId: randomUUID,
        onChange: (id) => notifyMeetings(id),
        logger: createConsoleLogger("[summary]"),
      })
    : null;
// NT-04: the recording's level meter in the Hub.
helper.onCaptureLevel((level) => {
  if (hubEvents && !hubEvents.isDestroyed()) hubEvents.send(IPC_EVENTS.meetingLevel, level);
});
/** Tells the Hub a meeting changed (null: the list or the recording). */
function notifyMeetings(meetingId: string | null): void {
  if (hubEvents && !hubEvents.isDestroyed()) hubEvents.send(IPC_EVENTS.meetingsChanged, meetingId);
}
// NT-26: tasks suggested from meetings, and My Tasks.
const tasksService = database
  ? createTasksService(database, { newId: randomUUID, now: Date.now })
  : null;
const automationsStore = database ? createAutomationsStore(database) : null;
// NT-27: "Draft email" makes a draft in Gmail after the owner has read it. It never sends.
const emailDrafts =
  database &&
  connectorService &&
  meetingsStore &&
  meetingSummaries &&
  tasksService &&
  automationsStore
    ? createEmailDraftService({
        connectors: connectorService,
        settings: () => settingsStore.get().connectors.gmail,
        store: automationsStore,
        tasks: tasksService,
        meetings: meetingsStore,
        summaries: meetingSummaries,
        generate: meetingGenerate,
        now: Date.now,
        newId: randomUUID,
      })
    : null;
const noEmailDrafts = { available: false, reason: "Drafts need Gmail and the database." };
// NT-28: "Create event" makes an event in the owner's calendar after they have read the form.
const eventCreate =
  connectorService && meetingsStore && tasksService && automationsStore
    ? createEventCreateService({
        connectors: connectorService,
        settings: () => {
          const current = settingsStore.get();
          return { connectors: current.connectors, automations: current.notetaker.automations };
        },
        store: automationsStore,
        tasks: tasksService,
        meetings: meetingsStore,
        now: Date.now,
        newId: randomUUID,
        // The new event shows in the menu bar and reminders at once.
        onCreated: (accountId) => void calendarSync?.syncAccount(accountId),
      })
    : null;
// NT-11: a brief before a calendar meeting, from earlier meetings, open tasks and the connectors.
const briefsStore = database ? createBriefsStore(database) : null;
const briefs =
  briefsStore &&
  connectorService &&
  connectorStore &&
  calendarStore &&
  meetingsStore &&
  meetingSummaries &&
  tasksService &&
  connectorData
    ? createBriefService({
        calendar: calendarStore,
        meeting: (id) => meetingsStore.get(id),
        settings: () => ({
          brief: {
            ...settingsStore.get().notetaker.brief,
            auto: settingsStore.get().notetaker.brief.auto && featureOn("briefs"),
          },
          skipDeclined: settingsStore.get().notetaker.calendar.skipDeclined,
        }),
        store: briefsStore,
        builder: createBriefBuilder({
          settings: () => ({
            brief: settingsStore.get().notetaker.brief,
            gmail: settingsStore.get().connectors.gmail,
          }),
          accounts: () => connectorService.list(),
          meetings: meetingsStore,
          summaries: meetingSummaries,
          tasks: tasksService,
          connectorItems: (connector) => connectorData.items({ connector }),
          gmailThreads: createGmailThreads({
            connectors: connectorService,
            connectorStore,
            now: Date.now,
          }),
          generate: meetingGenerate,
          now: Date.now,
        }),
        accounts: () => connectorService.list(),
        now: Date.now,
        logger: createConsoleLogger("[brief]"),
        // The menu bar shows a way to open the brief once there is one.
        onBuilt: () => tray?.refresh(),
      })
    : null;
briefs?.start();
/** The meeting the menu bar asked the Brief tab to show; handed over once. */
let briefTarget: string | null = null;
const noBriefs = {
  calendarConnected: false,
  events: [],
  sources: [],
  settings: DEFAULT_BRIEF_SETTINGS,
};
const noEventCreate = { available: false, reason: "Events need a calendar and the database." };
// CN-05, CN-14: "Send to Slack": the preview comes first, tags only with the experimental option.
const slackPost =
  connectorService && meetingsStore && meetingSummaries && tasksService
    ? createSlackPost({
        connectors: connectorService,
        settings: () => ({
          connectors: settingsStore.get().connectors,
          tagging: settingsStore.get().experimental.slackTagging,
        }),
        tasks: tasksService,
        meetings: meetingsStore,
        summaries: meetingSummaries,
        now: Date.now,
        newId: randomUUID,
      })
    : null;
const noSlackPost = { available: false, reason: "Sending to Slack needs Slack and the database." };
// CN-12: the built-in actions run only through the runner, and only for a click.
const actionRunner = createActionRunner({
  settings: () => settingsStore.get().extensions,
  accounts: () => connectorService?.list() ?? [],
  executors: {
    draft_email: {
      state: () => emailDrafts?.state() ?? noEmailDrafts,
      run: async (input) =>
        emailDrafts?.create(input) ?? { ok: false, message: noEmailDrafts.reason },
    },
    create_event: {
      state: () => eventCreate?.state() ?? noEventCreate,
      run: async (input) =>
        eventCreate?.create(input) ?? { ok: false, message: noEventCreate.reason },
    },
    post_to_slack: {
      state: () => slackPost?.state() ?? noSlackPost,
      run: async (input) => slackPost?.send(input) ?? { ok: false, message: noSlackPost.reason },
    },
  },
});
// CN-13: Ask can propose one of these actions, behind the experimental option; the owner confirms.
const askActions = createAskActions({
  enabled: () => settingsStore.get().experimental.askConnectorActions,
  runner: actionRunner,
  generate: meetingGenerate,
  contacts: () => {
    const seen = new Map<string, { name: string | null; email: string }>();
    for (const meeting of meetingsStore?.list(200) ?? [])
      for (const person of meeting.attendees ?? [])
        if (!seen.has(person.email))
          seen.set(person.email, { name: person.name, email: person.email });
    return [...seen.values()];
  },
  emailAccount: () => {
    const account = connectorService
      ?.list()
      .find(
        (entry) =>
          entry.connector === "gmail" &&
          entry.status === "connected" &&
          entry.scopes.includes(GMAIL_SCOPE_COMPOSE),
      );
    return account ? { id: account.id, email: account.email } : null;
  },
  calendarAccount: () => {
    const settings = settingsStore.get().connectors;
    const account = connectorService?.list().find((entry) => {
      const write = CALENDAR_WRITE_SCOPES[entry.connector];
      const catalogue = CONNECTOR_CATALOGUE.find((candidate) => candidate.id === entry.connector);
      return (
        write !== undefined &&
        catalogue !== undefined &&
        entry.status === "connected" &&
        hasScope(entry.scopes, write) &&
        !connectorChoice(settings, catalogue).readOnly
      );
    });
    return account ? { id: account.id, email: account.email, connector: account.connector } : null;
  },
  eventDefaults: () => {
    const create = settingsStore.get().notetaker.automations.createEvent;
    return { durationMinutes: create.defaultDuration, invitesAllowed: create.sendInvites };
  },
  now: Date.now,
});
const ACTION_FEATURES = {
  draft_email: "email-drafts",
  create_event: "calendar-events",
  post_to_slack: "slack-send",
} as const;
const draftState = (id: "draft_email" | "create_event" | "post_to_slack") => {
  if (!featureOn(ACTION_FEATURES[id]))
    return { available: false, reason: "Turned off on the Connectors page.", hidden: true };
  const state = actionRunner.stateOf(id);
  return { available: state.state === "ready", reason: state.reason, hidden: state.hidden };
};
const taskRunner =
  meetingsStore && meetingTranscripts && tasksService
    ? createTaskRunner({
        hasMeeting: (id) => meetingsStore.get(id) !== null,
        startedAt: (id) => meetingsStore.get(id)?.startedAt ?? Date.now(),
        segments: (id) => meetingTranscripts.segments(id),
        tasks: tasksService,
        maxPerMeeting: () => settingsStore.get().notetaker.tasks.maxPerMeeting,
        modelReady: cleanupModelReady,
        generate: meetingGenerate,
        dictating: () => hubDictationState !== "idle",
        generating: () => llm.isGenerating(),
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        onChange: (id) => notifyMeetings(id),
        logger: createConsoleLogger("[tasks]"),
      })
    : null;
// NT-07, NT-08: who spoke in a meeting, their names, and a sample of their voice.
const speakersStore = database ? createSpeakersStore(database, { now: Date.now }) : null;
const speakerClip =
  database && speakersStore
    ? createSpeakerClip(database, {
        speakers: speakersStore,
        read: (file) => {
          try {
            return new Uint8Array(readFileSync(file));
          } catch {
            return null;
          }
        },
      })
    : null;
// NT-24: corrections to a transcript, each one kept so it can be taken back.
const correctionsStore =
  database && speakersStore
    ? createCorrectionsStore(database, { now: Date.now, speakers: speakersStore })
    : null;
// NT-14: Ask across meetings. BM25 over pieces of the meetings, answered by the local model.
const askStore = database ? createAskStore(database, { now: Date.now, newId: randomUUID }) : null;
const askRunner =
  database && askStore
    ? createAskRunner({
        index: createAskIndex(database, { now: Date.now }),
        store: askStore,
        folderMeetings: (folderId) => foldersStore?.meetingIds(folderId) ?? [],
        settings: () => settingsStore.get().notetaker.ask,
        modelReady: cleanupModelReady,
        generate: meetingGenerate,
        dictating: () => hubDictationState !== "idle",
        generating: () => llm.isGenerating(),
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: Date.now,
        logger: createConsoleLogger("[ask]"),
      })
    : null;
const mcpSocketPath = path.join(profile.appData, "Murmur", "mcp.sock");
const mcpCommandPath = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "mcp", "murmur-mcp")
    : path.join(app.getAppPath(), "packaging", "murmur-mcp");
// CN-11: the local MCP server. Off until turned on; AI clients read meeting notes, summaries,
// transcripts and tasks through it, and nothing else.
const mcpService =
  database &&
  meetingsStore &&
  meetingTranscripts &&
  speakersStore &&
  meetingSummaries &&
  tasksService &&
  foldersStore &&
  meetingNotes
    ? createMcpService({
        // On Free the server answers nothing.
        settings: () => {
          const mcp = settingsStore.get().mcp;
          return allows("mcp") ? mcp : { ...mcp, enabled: false };
        },
        db: database,
        newId: randomUUID,
        data: {
          notes: meetingNotes,
          meetings: meetingsStore,
          transcript: meetingTranscripts,
          speakers: speakersStore,
          summaries: meetingSummaries,
          tasks: tasksService,
          folders: foldersStore,
          ask: createAskIndex(database, { now: Date.now }),
        },
        keychain: connectorKeychain,
        socketPath: mcpSocketPath,
        serverVersion: app.getVersion(),
        logger: createConsoleLogger("[mcp]"),
        now: Date.now,
      })
    : null;
// CN-11: writing an app's config file, only after the owner approves the diff.
const mcpSetup = mcpService
  ? createMcpSetup({
      clients: mcpService.clients,
      home: app.getPath("home"),
      claudeFolder: ["Library", "Application Support", "Claude"],
      command: mcpCommandPath,
      socketPath: mcpSocketPath,
      newId: randomUUID,
      now: Date.now,
      files: {
        read: (file) => {
          try {
            return readFileSync(file, "utf8");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
          }
        },
        write: (file, text) => {
          mkdirSync(path.dirname(file), { recursive: true });
          // The file holds a token, so only this user can read it; replaced whole, never half-written.
          const temporary = `${file}.murmur-tmp`;
          writeFileSync(temporary, text, { mode: 0o600 });
          renameSync(temporary, file);
        },
      },
    })
  : null;
if (mcpService) {
  settingsStore.onChange(() => void mcpService.apply());
  // The token is in the Keychain, which the helper reaches: try again once it is ready.
  helper.onStatusChange((status) => {
    if (status.state === "ready") void mcpService.apply();
  });
  void mcpService.apply();
}
// NT-23: meetings whose transcript was just made again: their tasks are looked for again.
const rerunExtract = new Set<string>();
// NT-05: the work queue. Transcription needs only the local model; meetings wait for it.
const meetingJobs: MeetingJobs | null =
  database && meetingsStore && meetingTranscripts
    ? createMeetingJobs({
        db: database,
        meetings: meetingsStore,
        transcripts: meetingTranscripts,
        // The meeting's own language, and whether to write the words in English (NT-20).
        transcribe: (file, how) => speech.transcribeMeeting(file, how.languages, how.translate),
        speechReady: () => speech.getState() === "ready",
        dictating: () => hubDictationState !== "idle",
        now: () => Date.now(),
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        onProgress: (meetingId) => notifyMeetings(meetingId),
        // The summary is written once the transcript is complete, unless it is off.
        onTranscribed: (id) => {
          if (meetingsStore.get(id)?.status !== "ready") return;
          const notetaker = settingsStore.get().notetaker;
          // After a rerun (NT-23) a new summary is always written, and the tasks are looked
          // for again: a title the meeting already has is skipped, so done tasks stay done.
          if (meetingsStore.consumeRerun(id)) {
            transcriptVersions?.reapplySpeakers(id);
            rerunExtract.add(id);
            meetingJobs?.enqueue(id, "summarise");
            return;
          }
          // With no summary and no tasks to wait for, the folder's file is written now.
          if (!notetaker.summary.auto && !notetaker.tasks.extract) autoExport?.run(id);
          // With no summary to wait for, "after processing" is now.
          if (!notetaker.summary.auto) meetingRetention?.afterProcessing(id, Date.now());
          if (notetaker.summary.auto) {
            if ((meetingSummaries?.list(id).length ?? 0) > 0) return;
            if (meetingJobs?.jobStatus(id, "summarise") !== null) return;
            meetingJobs.enqueue(id, "summarise");
          } else if (
            notetaker.tasks.extract &&
            meetingJobs?.jobStatus(id, "extract_tasks") === null
          ) {
            // No summary to wait for: the tasks are looked for now.
            meetingJobs.enqueue(id, "extract_tasks");
          }
        },
        // The tasks are looked for after the summary, once.
        onSummarised: (id) => {
          autoExport?.run(id);
          // "Delete after processing" (NT-22): the audio goes once the summary is written.
          meetingRetention?.afterProcessing(id, Date.now());
          const again = rerunExtract.delete(id);
          if (!settingsStore.get().notetaker.tasks.extract) return;
          if (!again && meetingJobs?.jobStatus(id, "extract_tasks") !== null) return;
          meetingJobs?.enqueue(id, "extract_tasks");
        },
        // The folder's file is written again with the tasks.
        onTasksExtracted: (id) => void autoExport?.run(id),
        extractTasks: async (id) => {
          if (!taskRunner) throw new TaskError("no-transcript", "No tasks here.");
          const result = await taskRunner.run(id);
          return result.note ? { note: result.note } : undefined;
        },
        summarise: async (id) => {
          if (!summaryRunner) throw new SummaryError("no-transcript", "No summaries here.");
          await summaryRunner.run(id);
        },
        logger: createConsoleLogger("[meetings]"),
      })
    : null;
// NT-23: transcribe a finished meeting again from its saved audio, keeping the old transcript.
const transcriptVersions = database ? createTranscriptVersions(database) : null;
const meetingRerun =
  meetingsStore && transcriptVersions && meetingJobs
    ? createMeetingRerun({
        meetings: meetingsStore,
        versions: transcriptVersions,
        jobs: meetingJobs,
        keepDays: () => settingsStore.get().notetaker.rerun.keepPreviousVersionDays,
        audioPresent: (id) => meetingsStore.chunks(id).every((chunk) => existsSync(chunk.path)),
        now: Date.now,
        onChange: (id) => notifyMeetings(id),
      })
    : null;
transcriptVersions?.purge(Date.now());
// NT-13: "What did I miss": a short recap of the last minutes of a meeting.
const recapsStore = database ? createRecapsStore(database) : null;
const recapRunner =
  meetingsStore && meetingTranscripts && recapsStore
    ? createRecapRunner({
        position: (id) => {
          const meeting = meetingsStore.get(id);
          if (!meeting) return null;
          const state = meetings?.state();
          const recording = state?.status === "recording" && state.meetingId === id;
          return {
            recording,
            nowMs: recording ? Date.now() - meeting.startedAt : meeting.durationMs,
          };
        },
        lines: (id) => {
          const speakers = speakersStore?.list(id) ?? [];
          const nameOf = (speakerId: string | null, channel: MeetingChannel) =>
            speakers.find((s) => s.id === speakerId)?.name ??
            speakers.find((s) => s.channel === channel)?.name ??
            SPEAKER_DEFAULT_NAMES[channel];
          const finals = meetingTranscripts
            .segments(id)
            .filter((segment) => !segment.isDictated)
            .map((segment) => ({
              id: segment.id as string | null,
              startMs: segment.startMs,
              speaker: nameOf(segment.speakerId, segment.channel),
              text: segment.text,
            }));
          // What is still grey counts too: it is what the owner sees on the page now.
          const live = liveTranscriber.partials(id).flatMap((partial) =>
            partial.segments.map((segment) => ({
              id: null as string | null,
              startMs: segment.startMs,
              speaker: nameOf(null, partial.channel),
              text: segment.text,
            })),
          );
          return [...finals, ...live].sort((a, b) => a.startMs - b.startMs);
        },
        lastSummaryMs: (id) => {
          const meeting = meetingsStore.get(id);
          const last = meetingSummaries?.list(id).at(-1);
          return meeting && last ? Math.max(0, last.createdAt - meeting.startedAt) : null;
        },
        windowMinutes: () => settingsStore.get().notetaker.recap.windowMinutes,
        recaps: recapsStore,
        modelId: DEFAULT_CLEANUP_MODEL.id,
        modelReady: cleanupModelReady,
        generate: meetingGenerate,
        dictating: () => hubDictationState !== "idle",
        generating: () => llm.isGenerating(),
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: Date.now,
        newId: randomUUID,
        onChange: (id) => notifyMeetings(id),
        logger: createConsoleLogger("[recap]"),
      })
    : null;
// NT-21: meetings from transcript files (VTT, SRT, text, JSON); the preview comes first.
const transcriptImport =
  database && speakersStore
    ? createTranscriptImport(database, {
        speakers: speakersStore,
        newId: randomUUID,
        now: Date.now,
        meetingsRoot: path.join(profile.appData, "Murmur", "meetings"),
        ownerName: () => settingsStore.get().profile.displayName,
        folderId: () => {
          const wanted = settingsStore.get().notetaker.import.defaultFolder;
          return wanted !== "inbox" && foldersStore?.get(wanted) ? wanted : null;
        },
      })
    : null;
// CN-09, CN-10: meetings from Zoom and Fireflies go through the same importer and its preview.
const connectorImport =
  connectorService && transcriptImport
    ? createConnectorImport({
        connectors: connectorService,
        importer: transcriptImport,
        settings: () => settingsStore.get().connectors,
        now: Date.now,
        logger: createConsoleLogger("[import]"),
      })
    : null;
/**
 * What follows an import: the summary is written like for a recording, and then the tasks. A
 * meeting that came with its service's own summary keeps it: the local summary is not written
 * over it by itself, and the tasks are looked for in the transcript instead.
 */
function afterImport(meetingId: string): void {
  const hasProviderSummary = (meetingSummaries?.list(meetingId).length ?? 0) > 0;
  if (hasProviderSummary) {
    if (settingsStore.get().notetaker.tasks.extract) {
      meetingJobs?.enqueue(meetingId, "extract_tasks");
      meetingJobs?.kick();
    }
  } else if (settingsStore.get().notetaker.import.regenerateSummary) {
    meetingJobs?.enqueue(meetingId, "summarise");
    meetingJobs?.kick();
  }
  notifyMeetings(null);
}
// CN-09, CN-10: new recordings, once an hour, for the accounts whose switch is on.
const AUTO_IMPORT_MS = 60 * 60_000;
function importNewRecordings(): void {
  if (!connectorImport || !featureOn("import-services")) return;
  void connectorImport.importNew().then(
    (ids) => ids.forEach(afterImport),
    (error: unknown) => console.warn(`[import] automatic import failed: ${String(error)}`),
  );
}
setInterval(importNewRecordings, AUTO_IMPORT_MS).unref();
// NT-18: a meeting as one HTML file that opens offline; audio is never in it.
function buildMeetingExport(
  meetingId: string,
  options: MeetingExportOptions,
): { fileName: string; html: string; audio: { name: string; path: string }[] } | null {
  const meeting = meetingsStore?.get(meetingId);
  if (!meeting || !meetingTranscripts || !meetingNotes) return null;
  // NT-18: the recording's own files, when they are wanted and still here.
  const audio =
    options.audio && meeting.audioDeletedAt === null
      ? (meetingsStore?.chunks(meetingId) ?? [])
          .filter((chunk) => existsSync(chunk.path))
          .map((chunk) => ({
            name: `audio/${path.basename(chunk.path)}`,
            label: `${SPEAKER_DEFAULT_NAMES[chunk.channel]}, from ${formatElapsed(chunk.startMs)}`,
            path: chunk.path,
          }))
      : [];
  const speakers = speakersStore?.list(meetingId) ?? [];
  const summaries = (meetingSummaries?.list(meetingId) ?? []).filter((summary) => !summary.quick);
  const summary = summaries.at(-1) ?? null;
  return {
    fileName: exportFileName(meeting.title, meeting.startedAt),
    audio,
    html: renderMeetingHtml({
      audio,
      title: meeting.title,
      startedAt: meeting.startedAt,
      durationMs: meeting.durationMs,
      folderName: meeting.folderId ? (foldersStore?.get(meeting.folderId)?.name ?? null) : null,
      segments: meetingTranscripts
        .segments(meetingId)
        .filter((segment) => !segment.isDictated)
        .map((segment) => ({
          id: segment.id,
          startMs: segment.startMs,
          speaker:
            speakers.find((speaker) => speaker.id === segment.speakerId)?.name ??
            SPEAKER_DEFAULT_NAMES[segment.channel],
          text: segment.text,
        })),
      summary: summary
        ? { markdown: summary.markdown, skillName: summary.skillName, createdAt: summary.createdAt }
        : null,
      tasks: (tasksService?.list({ meetingId }).tasks ?? [])
        .filter((task) => task.status !== "archived")
        .map((task) => ({
          title: task.title,
          status: task.status,
          owner: task.owner,
          ownerIsMe: task.ownerIsMe,
          dueOn: task.dueOn,
        })),
      notes: meetingNotes.notes(meetingId).body,
      options,
      exportedAt: Date.now(),
    }),
  };
}
// After each meeting of a folder with a path is ready, the file is written there (NT-18).
const autoExport = foldersStore
  ? createAutoExport({
      folders: foldersStore,
      build: (id) => buildMeetingExport(id, DEFAULT_EXPORT_OPTIONS),
      directoryExists: (dir) => {
        try {
          return statSync(dir).isDirectory();
        } catch {
          return false;
        }
      },
      write: (file, text) => writeFileSync(file, text),
      logger: createConsoleLogger("[export]"),
    })
  : null;
// NT-06: grey text for the chunk being recorded, decoded again and again.
const liveTranscriber = createLiveTranscriber({
  transcribeLive: (input) => speech.transcribeLive(input),
  state: () => meetings?.state() ?? { status: "idle" },
  dictating: () => hubDictationState !== "idle",
  enabled: () => settingsStore.get().notetaker.live,
  options: (meetingId) => {
    const meeting = meetingsStore?.get(meetingId);
    return {
      languages: meeting?.language ? [meeting.language] : [],
      translate: meeting?.translate ?? false,
    };
  },
  isFinal: (meetingId, channel, seq) =>
    meetingTranscripts?.isTranscribed(meetingId, channel, seq) ?? false,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onPartial: (partial) => {
    if (hubEvents && !hubEvents.isDestroyed()) hubEvents.send(IPC_EVENTS.meetingLive, partial);
  },
  logger: createConsoleLogger("[meetings]"),
});
let meetingTick: ReturnType<typeof setInterval> | null = null;
let meetingDetector: MeetingDetector | null = null;
const meetings = meetingsStore
  ? createMeetingRecorder({
      helper,
      store: meetingsStore,
      meetingsDir: path.join(profile.appData, "Murmur", "meetings"),
      now: () => Date.now(),
      newId: randomUUID,
      options: () => {
        const settings = settingsStore.get();
        return {
          captureSystem: settings.notetaker.captureSystem,
          chunkSeconds: settings.notetaker.chunkSeconds,
          titleFormat: settings.notetaker.titleFormat,
          micDeviceId: settings.inputDevice === "auto" ? null : settings.inputDevice,
          language:
            settings.notetaker.language.default === "auto"
              ? null
              : settings.notetaker.language.default,
          translate: settings.notetaker.translate.transcriptToEnglish,
          folderId: (() => {
            const wanted = settings.notetaker.folders.defaultFolder;
            return wanted !== "inbox" && foldersStore?.get(wanted) ? wanted : null;
          })(),
        };
      },
      onState: (state) => {
        // The menu bar shows the time while recording, so it is redrawn every second.
        if (state.status === "recording" && meetingTick === null) {
          meetingTick = setInterval(() => tray?.refresh(), 1000);
        } else if (state.status !== "recording" && meetingTick !== null) {
          clearInterval(meetingTick);
          meetingTick = null;
        }
        meetingBadge = state.status === "recording" ? { startedAt: state.startedAt } : null;
        meetingDetector?.recordingChanged(state);
        if (state.status === "recording") liveTranscriber.start(state.meetingId, state.channels);
        notifyMeetings(null);
        barPort.render(bar.getView());
        tray?.refresh();
      },
      onFinished: (meeting) => {
        meetingJobs?.enqueue(meeting.id, "transcribe");
        meetingJobs?.kick();
      },
      removePartials: (folder) => {
        try {
          for (const name of readdirSync(folder)) {
            if (name.includes(".partial.")) rmSync(path.join(folder, name), { force: true });
          }
        } catch {
          // The folder is gone: nothing to tidy.
        }
      },
      logger: createConsoleLogger("[meetings]"),
    })
  : null;
const interruptedMeetings = meetings?.recover() ?? 0;
if (interruptedMeetings > 0) {
  console.log(`[meetings] ended ${interruptedMeetings} recording(s) cut short by a crash`);
}
const queuedMeetingJobs = meetingJobs?.resume() ?? 0;
if (queuedMeetingJobs > 0) console.log(`[meetings] ${queuedMeetingJobs} job(s) waiting`);
// The model may become ready at any time (a download, a helper restart): look every 15 s.
setInterval(() => meetingJobs?.kick(), 15_000).unref();
helper.onStatusChange((status) => {
  if (status.state !== "ready") meetings?.helperDown();
});
// Each closed chunk is transcribed while the meeting goes on, so final text follows the
// grey text by about one chunk. The recorder has stored the chunk row by now.
helper.onCaptureChunk((chunk) => {
  if (!meetingsStore?.get(chunk.meetingId)) return;
  meetingJobs?.enqueue(chunk.meetingId, "transcribe");
  meetingJobs?.kick();
});

function meetingDetail(id: string): MeetingDetail | null {
  const meeting = meetingsStore?.get(id);
  if (!meeting || !meetingTranscripts || !meetingNotes) return null;
  const notes = meetingNotes.notes(id);
  return {
    meeting,
    progress: meetingTranscripts.progress(id),
    segments: meetingTranscripts.segments(id),
    live: liveTranscriber.partials(id),
    notes: notes.body,
    notesUpdatedAt: notes.updatedAt,
    docs: meetingNotes.docs(id),
    summaries: meetingSummaries?.list(id) ?? [],
    summaryStatus: summaryStatus(id),
    taskStatus: taskStatus(id),
    recaps: recapsStore?.list(id) ?? [],
    recapStatus: recapRunner?.status(id) ?? { state: "idle" as const },
    showDictated: !settingsStore.get().notetaker.dictation.excludeFromTranscript,
    correctedAt: correctionsStore?.lastAt(id) ?? null,
    speakers: speakersStore?.list(id) ?? [],
    transcriptVersions: transcriptVersions?.list(id, Date.now()) ?? [],
    detectedLanguage: meeting.language ? null : meetingTranscripts.detectedLanguage(id),
    rerunBlocked: meetingRerun?.blocked(id) ?? null,
    folderSuggestion: settingsStore.get().notetaker.folders.suggest
      ? (foldersStore?.suggest(id) ?? null)
      : null,
  };
}

function summaryStatus(id: string): SummaryStatus {
  const running = summaryRunner?.status(id) ?? { state: "idle" as const };
  if (running.state !== "idle") return running;
  const job = meetingJobs?.jobStatus(id, "summarise");
  if (job === "queued" || job === "running") return { state: "waiting" };
  if (job === "failed")
    return { state: "failed", message: "The summary could not be written. Try again." };
  return { state: "idle" };
}

function taskStatus(id: string): TaskRunStatus {
  const running = taskRunner?.status(id) ?? { state: "idle" as const };
  if (running.state !== "idle") return running;
  const job = meetingJobs?.jobStatus(id, "extract_tasks");
  if (job === "queued" || job === "running") return { state: "waiting" };
  if (job === "failed") return { state: "failed", message: "Tasks could not be found. Try again." };
  return { state: "idle" };
}

function deleteMeeting(id: string): void {
  const now = meetings?.state();
  if (now && now.status !== "idle" && "meetingId" in now && now.meetingId === id) return;
  const folder = meetingsStore?.folderOf(id);
  meetingsStore?.remove(id);
  if (folder) rmSync(folder, { recursive: true, force: true });
  notifyMeetings(null);
}

// NT-25: the notice is written by Murmur and shown before any audio is captured when asked for.
const meetingStarter =
  meetings && meetingsStore
    ? createMeetingStarter({
        recorder: meetings,
        store: meetingsStore,
        consent: () => settingsStore.get().notetaker.consent,
        markNoticeSeen: () => {
          const notetaker = settingsStore.get().notetaker;
          settingsStore.update({
            notetaker: { ...notetaker, consent: { ...notetaker.consent, seen: true } },
          });
        },
        confirmNotice: async () => {
          const options = {
            type: "info" as const,
            message: "Recording this meeting",
            detail:
              "Tell the other participants that this meeting is being recorded. Murmur records " +
              "your microphone and the sound of this Mac, and keeps the audio on this Mac. " +
              "Murmur does not give legal advice: follow the rules where you and the others are.",
            buttons: ["OK, start recording", "Cancel"],
            defaultId: 0,
            cancelId: 1,
          };
          const result =
            hubWindow && !hubWindow.isDestroyed() && hubWindow.isVisible()
              ? await dialog.showMessageBox(hubWindow, options)
              : await dialog.showMessageBox(options);
          return result.response === 0;
        },
        now: () => Date.now(),
        // TM-25: Free records five meetings a month.
        refuse: () =>
          meetingStartRefusal({
            plan: () => settingsStore.get().plan,
            meetings: () => meetingsStore?.list(500) ?? [],
            now: () => Date.now(),
          }),
        logger: createConsoleLogger("[meetings]"),
      })
    : null;

// NT-01: calls in Zoom, Meet and Teams. The helper looks only while this is on.
const meetingMatchers = loadMeetingMatchers(() => {
  const file = path.join(profile.appData, "Murmur", "meeting-matchers.json");
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}, createConsoleLogger("[detect]"));
// NT-02, NT-29: meetings from the calendar. The events are the ones kept on this Mac; with no
// calendar connected there are none, and nothing below does anything.
const calendarEventKey = (event: CalendarEvent) => `${event.accountId}|${event.id}`;
const upcomingEvents = (from: number, to: number): CalendarEvent[] =>
  calendarStore?.list({ from, to, includeDeclined: true }) ?? [];
const eventByKey = (key: string): CalendarEvent | null =>
  upcomingEvents(Date.now() - 6 * 3_600_000, Date.now() + 24 * 3_600_000).find(
    (event) => calendarEventKey(event) === key,
  ) ?? null;
/** The recording of an event: its title, the people invited (not the owner) and its calendar's folder. */
function startFromEvent(event: CalendarEvent): void {
  if (!meetingStarter) return;
  const wanted = settingsStore.get().notetaker.calendar.defaultFolders[event.accountId];
  void meetingStarter.start("calendar", {
    eventId: event.id,
    title: event.title,
    attendees: event.attendees
      .filter((attendee) => !attendee.self)
      .map((attendee) => ({ name: attendee.name, email: attendee.email })),
    folderId: wanted && foldersStore?.get(wanted) ? wanted : null,
  });
}
/** The calendar event that a detected call in this app belongs to, or null. */
function eventForApp(app: { id: string }): CalendarEvent | null {
  const matcher = meetingMatchers.find((candidate) => candidate.id === app.id);
  const hosts = [...(matcher?.web?.hosts ?? []), ...(matcher?.linkHosts ?? [])];
  const now = Date.now();
  if (!featureOn("reminders")) return null;
  return eventForCall(
    upcomingEvents(now, now + 600_000),
    now,
    hosts,
    settingsStore.get().notetaker.calendar.skipDeclined,
  );
}
const eventResponder = connectorService
  ? createEventResponder({
      connectors: connectorService,
      settings: () => settingsStore.get().connectors,
      onAnswered: (accountId) => void calendarSync?.syncAccount(accountId),
    })
  : null;
/** NT-02: the confirmation before every answer to an invitation; nothing is sent without it. */
async function replyToInvitation(event: CalendarEvent): Promise<void> {
  const answers = ["accepted", "tentative", "declined"] as const;
  const { response } = await dialog.showMessageBox({
    type: "question",
    message: `Answer “${event.title}”?`,
    detail: "The answer goes to your calendar, and the organiser is told.",
    buttons: ["Accept", "Maybe", "Decline", "Cancel"],
    defaultId: 3,
    cancelId: 3,
  });
  const answer = answers[response];
  if (!answer || !eventResponder) return;
  const result = await eventResponder.respond(event, answer);
  bar.dispatch({ type: "warn", message: result.ok ? "Answer sent" : result.message });
}
const calendarReminders =
  calendarStore && meetings
    ? createCalendarReminders({
        settings: () => settingsStore.get().notetaker.calendar,
        events: ({ from, to }) => (featureOn("reminders") ? upcomingEvents(from, to) : []),
        recording: () => meetings.state().status !== "idle",
        ...(eventResponder
          ? {
              replying: {
                offered: (event) =>
                  settingsStore.get().notetaker.calendar.rsvpFromReminder &&
                  eventResponder.canRespond(event),
                reply: (event) => void replyToInvitation(event),
              },
            }
          : {}),
        ask: ({ message, detail, reply }) => {
          // Only when the Bar is free: a dictation or another question is not interrupted.
          if (bar.getView().state !== "idle") return false;
          bar.dispatch({
            type: "ask",
            message,
            detail,
            actions: [
              { answer: "yes", label: "Record", primary: true },
              { answer: "no", label: "Not now" },
              ...(reply ? [{ answer: "reply" as const, label: "Reply" }] : []),
            ],
            timeoutMs: 60_000,
          });
          return bar.getView().state === "ask";
        },
        hide: () => {
          if (bar.getView().actions) bar.dispatch({ type: "answered" });
        },
        stillOpen: () => bar.getView().state === "ask",
        record: startFromEvent,
        now: Date.now,
        logger: createConsoleLogger("[calendar]"),
      })
    : null;
calendarReminders?.start();
if (meetings && meetingStarter) {
  meetingDetector = createMeetingDetector({
    clock: systemClock,
    matchers: () => meetingMatchers,
    settings: () => settingsStore.get().notetaker.detect,
    recording: () => meetings.state(),
    showPrompt: ({ name }) => {
      bar.dispatch({
        type: "ask",
        message: "Record this meeting?",
        detail: `${name} call detected`,
        actions: [
          { answer: "yes", label: "Record", primary: true },
          { answer: "no", label: "Not now" },
          { answer: "never", label: "Never", hint: "Never for this app" },
        ],
        timeoutMs: 20_000,
      });
      return bar.getView().state === "ask";
    },
    hidePrompt: () => {
      if (bar.getView().actions) bar.dispatch({ type: "answered" });
    },
    // A call whose calendar event is on now takes the event's title and people (NT-02).
    start: async (app) => {
      const event = eventForApp(app);
      return meetingStarter.start(
        "recorded",
        event
          ? {
              eventId: event.id,
              title: event.title,
              attendees: event.attendees
                .filter((attendee) => !attendee.self)
                .map((attendee) => ({ name: attendee.name, email: attendee.email })),
              folderId: (() => {
                const wanted =
                  settingsStore.get().notetaker.calendar.defaultFolders[event.accountId];
                return wanted && foldersStore?.get(wanted) ? wanted : null;
              })(),
            }
          : undefined,
      );
    },
    autoRecordFor: (app) =>
      settingsStore.get().notetaker.calendar.autoStart && eventForApp(app) !== null,
    stop: () => meetings.stop(),
    neverFor: (id) => {
      const notetaker = settingsStore.get().notetaker;
      const detect = notetaker.detect;
      if (detect.neverApps.includes(id)) return;
      settingsStore.update({
        notetaker: { ...notetaker, detect: { ...detect, neverApps: [...detect.neverApps, id] } },
      });
    },
    logger: createConsoleLogger("[detect]"),
  });
  helper.onMeetingDetected((event) => meetingDetector?.event(event));
}

const detectionSync = createDetectionSync({
  matchers: () => {
    return meetingMatchers;
  },
  settings: () => settingsStore.get().notetaker.detect,
  helperReady: () => helper.getStatus().state === "ready",
  watch: (input) => helper.watchMeetings(input),
  stopped: () => meetingDetector?.reset(),
  logger: createConsoleLogger("[detect]"),
});
settingsStore.onChange(() => detectionSync.sync());
// A new helper process knows nothing: it is told again once it is ready.
helper.onStatusChange(() => detectionSync.sync());

async function startMeeting(): Promise<void> {
  const result = await meetingStarter?.start();
  if (result && !result.ok) console.warn(`[meetings] ${result.message}`);
}

// The menu bar item. Created once the app is ready; it works with the Hub closed.
let tray: TrayController | null = null;
function createTray(): void {
  const host = createElectronTray((action) => tray?.perform(action));
  const controller = createTrayController({
    host,
    clock: systemClock,
    logger: createConsoleLogger("[tray]"),
    settings: () => settingsStore.get(),
    updateSettings: (patch) => settingsStore.update(patch),
    listDevices: () => helper.listAudioDevices(),
    lastTranscript: () => lastTranscript.read(),
    pasteLast: () => void lastTranscript.paste(),
    draftFromLast: () => {
      const text = history?.lastText() ?? null;
      if (!notes || text === null) {
        bar.dispatch({ type: "warn", message: NOTE_MESSAGES.noDictation });
        return;
      }
      openScratchpad(notes.create(text).id);
    },
    openHub: () => openHubPage("home"),
    paused: () => dictationPaused,
    setPaused: (paused) => {
      dictationPaused = paused;
    },
    toggleDictation: () => recorder.toggle(),
    canRetry: () => recorder.canRetry(),
    retryLast: () => void recorder.retryLast(),
    snoozeReminder: (choice) => typingReminder.snooze(choice),
    copy: (text) => void clipboard.writeText(text),
    quit: () => app.quit(),
    focusState: () => focus.state(),
    startFocus: (duration) => focus.start(duration),
    stopFocus: () => focus.stop("user"),
    ...(meetings
      ? {
          meetingState: () => meetings.state(),
          startMeeting: () => void startMeeting(),
          stopMeeting: () => void meetings.stop(),
        }
      : {}),
    // NT-29: the next meeting from the calendar kept here; none when it is off or not connected.
    nextMeeting: () => {
      const { menubar, calendar } = settingsStore.get().notetaker;
      if (!menubar.showNextMeeting || !calendarStore || !featureOn("next-meeting")) return null;
      const now = Date.now();
      const event = upcomingMeeting(
        upcomingEvents(now - 600_000, now + menubar.lookaheadHours * 3_600_000),
        now,
        { lookaheadHours: menubar.lookaheadHours, skipDeclined: calendar.skipDeclined },
      );
      return event
        ? {
            eventId: calendarEventKey(event),
            title: event.title,
            when: untilText(event.startMs, now),
            hasLink: event.joinUrl !== null,
            hasBrief: briefsStore?.get(briefEventKey(event)) != null,
            text: menuBarText(event, now),
          }
        : null;
    },
    joinMeeting: (key) => {
      const event = eventByKey(key);
      if (!event?.joinUrl || !/^https?:\/\//i.test(event.joinUrl)) return;
      void shell.openExternal(event.joinUrl);
      // With auto record on, joining also starts the recording (NT-03).
      if (settingsStore.get().notetaker.detect.autoRecord && meetings?.state().status === "idle")
        startFromEvent(event);
    },
    recordEvent: (key) => {
      const event = eventByKey(key);
      if (event) startFromEvent(event);
    },
    openBrief: (key) => {
      const event = eventByKey(key);
      if (!event) return;
      briefTarget = briefEventKey(event);
      openHubPage("notetaker");
    },
  });
  tray = controller;
  // The countdown moves every minute.
  setInterval(() => controller.refresh(), 60_000).unref();
  controller.refresh();
  settingsStore.onChange(() => controller.refresh());
  // The microphone list is read when the helper comes up and each time the pointer reaches
  // the icon, so the menu is current by the time it opens.
  helper.onStatusChange((status) => {
    if (status.state === "ready") void controller.refreshDevices();
    else controller.handleHelperDown();
  });
  host.onHover(() => void controller.refreshDevices());
  // Plugging a microphone in or out updates the menu at once.
  helper.onAudioDevicesChanged(() => void controller.refreshDevices());
  void controller.refreshDevices();
}

// The end-to-end smoke run (MURMUR_SMOKE=1, started by `npm run smoke`): a test window takes
// the place of the Hub, the app presses its own dictation key, and the result is printed.
const isSmokeRun = process.env.MURMUR_SMOKE === "1";
let smoke: SmokeRun | null = null;
// `npm run smoke -- --full` (MURMUR_SMOKE_FULL=1): more checks after the main dictation.
let smokeChecks: SmokeChecks | null = null;
/** Set by a full smoke run to make one transcription fail, as a broken model would. */
let smokeFailNextTranscription = false;
function startSmokeRun(): void {
  const window = new BrowserWindow({
    width: 520,
    height: 260,
    title: "Murmur smoke test",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const field = (script: string) => window.webContents.executeJavaScript(script) as Promise<string>;
  const key = (state: "down" | "up") =>
    recorder.handleHotkey({
      bindingId: "dictate-hold",
      action: "dictate.hold",
      state,
      at: Date.now(),
    });
  const run = createSmokeRun({
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    blockers: blockersNow,
    focusField: async () => {
      app.focus({ steal: true });
      window.show();
      window.focus();
      window.webContents.focus();
      await field("document.getElementById('field').focus(); ''");
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    isFieldFocused: () => !window.isDestroyed() && window.isFocused(),
    readField: () => field("document.getElementById('field').value"),
    keyDown: () => key("down"),
    keyUp: () => key("up"),
    settled: () => recorder.idle(),
    holdMs: Number(process.env.MURMUR_SMOKE_HOLD_MS) || 5000,
    log: (message) => console.log(`[smoke] ${message}`),
  });
  smoke = run;
  void window
    .loadURL(SMOKE_PAGE)
    .then(() => run.run())
    .then(async (result) => {
      const checks =
        result.ok && process.env.MURMUR_SMOKE_FULL === "1"
          ? await fullSmokeChecks(window, field, key).run()
          : [];
      console.log(`[smoke] result ${JSON.stringify({ ...result, checks })}`);
      process.exitCode = result.ok && checks.every((check) => check.ok !== false) ? 0 : 1;
      app.quit();
    });
}

function fullSmokeChecks(
  window: BrowserWindow,
  field: (script: string) => Promise<string>,
  key: (state: "down" | "up") => void,
): SmokeChecks {
  const fixture = process.env.MURMUR_AUDIO_FIXTURE ?? "";
  // The script writes each clip as <name>.wav in this folder, and clips.json with their
  // lengths in milliseconds.
  const clipsDir = process.env.MURMUR_SMOKE_CLIPS_DIR ?? "";
  const clipLengths = JSON.parse(readFileSync(path.join(clipsDir, "clips.json"), "utf8")) as Record<
    string,
    number
  >;
  const checks = createSmokeChecks({
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (message) => console.log(`[smoke] ${message}`),
    clipMs: (name) => (clipLengths[name] ?? 5000) + 800,
    focusField: async () => {
      app.focus({ steal: true });
      window.show();
      window.focus();
      window.webContents.focus();
      await field("document.getElementById('field').focus(); ''");
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    isFieldFocused: () => !window.isDestroyed() && window.isFocused(),
    setField: async (text) => {
      await field(
        `(() => { const box = document.getElementById('field'); box.value = ${JSON.stringify(text)}; box.setSelectionRange(box.value.length, box.value.length); return ''; })()`,
      );
    },
    readField: () => field("document.getElementById('field').value"),
    keyDown: () => key("down"),
    keyUp: () => key("up"),
    settled: () => recorder.idle(),
    barView: () => bar.getView(),
    barPosition: () => barWindow.position(),
    dragBar: async (dx, dy) => {
      barWindow.dragStart();
      barWindow.drag(dx, dy);
      await barWindow.dragEnd();
    },
    reopenBar: async () => {
      barWindow.close();
      await barWindow.open();
      barWindow.render(bar.getView());
    },
    settings: () => settingsStore.get(),
    updateSettings: (patch) => void settingsStore.update(patch),
    outputMuted: () => helper.getOutputMuted(),
    setOutputMuted: async (muted) => {
      await helper.setOutputMuted(muted);
    },
    tray: (action) => tray?.perform(action),
    lastTranscript: () => history?.lastText() ?? null,
    saveClipboard: async () => {
      // Every type's data is read now, before anything is written over it; items from
      // read() cannot be written back as they are.
      const saved = await Promise.all(
        (await clipboard.read()).map(async (item) => {
          const record: Record<string, Blob | string | Electron.ClipboardBookmark> = {};
          for (const type of item.types) record[type] = await item.getType(type);
          return record;
        }),
      );
      return async () => {
        if (saved.length === 0) clipboard.clear();
        else {
          try {
            await clipboard.write(saved.map((record) => new ClipboardItem(record)));
          } catch (error) {
            // At least the text goes back.
            const text = saved.find((record) => typeof record["text/plain"] === "string");
            if (text) await clipboard.writeText(text["text/plain"] as string);
            throw error;
          }
        }
      };
    },
    readClipboardText: () => clipboard.readText(),
    useClip: (name) => {
      if (!fixture || !clipsDir) throw new Error("the smoke clips are not set");
      copyFileSync(path.join(clipsDir, `${name}.wav`), fixture);
    },
    micCheck: async () => {
      const started = await micCheck.start();
      if (!started.ok) return null;
      await new Promise((resolve) => setTimeout(resolve, (clipLengths.speech ?? 4000) + 800));
      return micCheck.stop();
    },
    failNextTranscription: () => {
      smokeFailNextTranscription = true;
    },
    canRetry: () => recorder.canRetry(),
    feedTypedWords: (words) => typingReminder.record(words),
    addDictionary: (entries) => {
      const ids = entries.flatMap((entry) => {
        const saved = dictionary?.save({ ...entry, caseSensitive: false, starred: false });
        return saved?.ok ? [saved.entry.id] : [];
      });
      return () => ids.forEach((id) => dictionary?.remove(id));
    },
    answerBar: (choice) => answerBar(choice),
    learnedEntries: () =>
      (dictionary?.list() ?? [])
        .filter((entry) => entry.source === "auto")
        .map((entry) => ({ id: entry.id, term: entry.term, replacement: entry.replacement })),
    removeDictionary: (id) => dictionary?.remove(id),
    memoryTexts: () => memory?.list().map((item) => item.text) ?? [],
    forgetMemory: (text) => {
      const found = memory?.list().find((item) => item.text === text);
      if (found) memory?.remove(found.id);
    },
    setAppCategory: (bundleId, category) => {
      styles?.setOverride({ bundleId, appName: "Smoke test", category });
      return () => styles?.clearOverride(bundleId);
    },
    addSnippet: (trigger, lines) => {
      const saved = snippets?.save({
        trigger,
        plain: "",
        rich: {
          blocks: lines.map((line, index) => ({
            type: "paragraph" as const,
            inlines: [{ text: line, ...(index === 0 ? { bold: true } : {}) }],
          })),
        },
      });
      return () => {
        if (saved?.ok) snippets?.remove(saved.snippet.id);
      };
    },
  });
  smokeChecks = checks;
  return checks;
}

// DC-39: the last transcript, copied or pasted again by its shortcuts.
const lastTranscript = createLastTranscript({
  stored: () => history?.lastText() ?? null,
  focus: () => helper.focusContext({ maxBefore: 0, maxAfter: 0 }),
  insert: (text, options) =>
    helper.insertText({
      text,
      method: insertionMethod(
        settingsStore.get().insertion.method,
        settingsStore.get().devMode.forceTyped,
      ),
      restoreClipboard: !options?.keepOnClipboard,
      restoreDelayMs: 350,
      ...insertionRules(settingsStore.get().insertion),
    }),
  copy: (text) => helper.copyText(text),
  busy: () => recorder.isBusy(),
  notify: (kind, message) => bar.dispatch({ type: kind, message }),
  logger: createConsoleLogger("[paste-last]"),
});

// Typing reminder (DC-08): the helper counts words only while it is on and not snoozed.
const typingReminder = createTypingReminder({
  settings: () => settingsStore.get(),
  update: (reminder) => settingsStore.update({ typingReminder: reminder }),
  isDictating: () => recorder.isBusy(),
  now: () => Date.now(),
  nudge: (message) => {
    console.log("[reminder] suggested dictating after a lot of typing");
    bar.dispatch({ type: "warn", message });
  },
  holdLabel: () => keys.label(settingsStore.get().holdShortcut),
});
let typingWatched: boolean | null = null;
function syncTypingWatch(force = false): void {
  if (helper.getStatus().state !== "ready") return;
  const want = typingReminder.isActive();
  if (!force && want === typingWatched) return;
  typingWatched = want;
  helper.watchTyping(want).catch(() => {
    typingWatched = null;
  });
}
helper.onStatusChange((status) => {
  if (status.state === "ready") syncTypingWatch(true);
  else typingWatched = null;
});
settingsStore.onChange(() => syncTypingWatch());
helper.onTypingActivity((activity) => typingReminder.record(activity.words));
// A snooze ends by itself; check now and then so counting starts again.
setInterval(() => syncTypingWatch(), 60_000).unref();

async function openPermissionSettings(kind: PermissionKind): Promise<void> {
  const url = permissionSettingsUrl(kind);
  if (url === null) {
    throw new Error("No System Settings pane is known for this permission");
  }
  await shell.openExternal(url);
}

let hubWindow: BrowserWindow | null = null;

/** Shows the Hub on one page, opening it if it is closed. */
function openHubPage(pageId: string): void {
  if (isSmokeRun) return;
  const window = hubWindow ?? createHubWindow();
  const send = () => window.webContents.send(IPC_EVENTS.openPage, pageId);
  if (window.webContents.isLoading()) window.webContents.once("did-finish-load", send);
  else send();
  window.show();
  window.focus();
}

/** Learns from an inserted dictation; marks milestones; offers the weekly passage prompt. */
function learnVoice(dictation: DictationRecord, historyId: string | null): void {
  const flags = settingsStore.get().voiceProfile;
  if (!voiceProfile || !flags.enabled) return;
  if (dictation.insertStatus !== "inserted" || !dictation.finalText || !dictation.rawText) return;
  const category = (dictation.styleId ?? "").replace(/^style-/, "");
  const reached = voiceProfile.learn({
    historyId,
    createdAt: dictation.createdAt,
    category: (STYLE_CATEGORIES as readonly string[]).includes(category)
      ? (category as StyleCategory)
      : "other",
    rawText: dictation.rawText,
    finalText: dictation.finalText,
  });
  // Word milestones are announced by the milestone check (HB-41); none is said twice.
  if (reached !== null) return;
  if (flags.prompts && !offeredFact && voiceProfile.takePrompt(Date.now())) {
    profilePromptShown = true;
    bar.dispatch({
      type: "ask",
      message: "Update your voice profile?",
      detail: "Read a short passage aloud on the My Voice page.",
    });
  }
}

function profileView() {
  const now = Date.now();
  return voiceProfile && database
    ? voiceProfile.view(now, recentExamples(database, now))
    : {
        sessions: 0,
        totalWords: 0,
        measures: [],
        topPhrases: [],
        summary: null,
        milestones: [],
        examples: { personal: [], work: [], email: [], other: [] },
        passage: "",
      };
}

/** HB-17: launch at login, only for a packaged app (a development run would add Electron). */
function loginItem(): { available: boolean; enabled: boolean } {
  if (!app.isPackaged) return { available: false, enabled: false };
  return { available: true, enabled: app.getLoginItemSettings().openAtLogin };
}

// HB-01: the Hub's size, place and last page, kept between runs.
const hubState = createHubStateStore({
  file: path.join(profile.userData, "hub-window.json"),
  minWidth: HUB_MIN_WIDTH,
  minHeight: HUB_MIN_HEIGHT,
  logger: { warn: (message) => console.warn(`[hub] ${message}`) },
});
let hubSaved: HubWindowState = { ...DEFAULT_HUB_STATE };

function createHubWindow(): BrowserWindow {
  const place = placeOnScreen(
    hubSaved,
    screen.getAllDisplays().map((display) => display.workArea),
  );
  const window = new BrowserWindow({
    ...createHubWindowOptions({
      preloadPath: path.join(__dirname, "preload.cjs"),
      isDevelopment,
    }),
    width: hubSaved.width,
    height: hubSaved.height,
    ...(place ?? {}),
  });
  const saveBounds = () => {
    if (window.isDestroyed() || window.isFullScreen() || window.isMinimized()) return;
    const bounds = window.getNormalBounds();
    hubSaved = { ...hubSaved, ...bounds };
    hubState.update(bounds);
  };
  window.on("resize", saveBounds);
  window.on("move", saveBounds);
  // The last page; a page asked for by openHubPage is sent after this and wins.
  if (hubSaved.page) {
    const page = hubSaved.page;
    window.webContents.once("did-finish-load", () =>
      window.webContents.send(IPC_EVENTS.openPage, page),
    );
  }
  window.once("ready-to-show", () => window.show());
  hubEvents = window.webContents;
  window.on("closed", () => {
    if (hubWindow === window) hubWindow = null;
    if (hubEvents === window.webContents) hubEvents = null;
  });
  void window.loadURL(hubEntryUrl);
  hubWindow = window;
  return window;
}

let scratchpadWindow: BrowserWindow | null = null;

/**
 * HB-26: the Scratchpad is its own window showing the Hub page at `#/scratchpad-window`, so
 * it shares the Hub's preload, CSP and IPC checks. Opens or brings it forward.
 */
function openScratchpad(noteId?: string): void {
  if (isSmokeRun || !settingsStore.get().scratchpad.enabled) return;
  const existing = scratchpadWindow;
  if (existing && !existing.isDestroyed()) {
    if (noteId) existing.webContents.send(IPC_EVENTS.scratchpadOpenNote, noteId);
    existing.show();
    existing.focus();
    return;
  }
  const window = new BrowserWindow({
    ...createHubWindowOptions({
      preloadPath: path.join(__dirname, "preload.cjs"),
      isDevelopment,
    }),
    title: "Scratchpad",
    width: 900,
    height: 640,
    minWidth: 640,
    minHeight: 420,
  });
  window.once("ready-to-show", () => window.show());
  if (noteId) {
    window.webContents.once("did-finish-load", () =>
      window.webContents.send(IPC_EVENTS.scratchpadOpenNote, noteId),
    );
  }
  window.on("closed", () => {
    if (scratchpadWindow === window) scratchpadWindow = null;
  });
  void window.loadURL(`${hubEntryUrl}#/scratchpad-window`);
  scratchpadWindow = window;
}

// Applies to every web contents, including any created later.
app.on("web-contents-created", (_event, contents) => {
  const guardNavigation = createNavigationGuard(hubEntryUrl);
  contents.setWindowOpenHandler(denyWindowOpen);
  contents.on("will-navigate", guardNavigation);
  contents.on("will-redirect", guardNavigation);
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

function registerIpc(): void {
  const handle = createIpcHandler({
    entryUrl: hubEntryUrl,
    helperRetry: () => helper.retry(),
    openGuide: async () => {
      // HB-08: written beside the data, so any text viewer can open it.
      const file = path.join(profile.appData, "Murmur", "Murmur guide.md");
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, guide);
      return (await shell.openPath(file)) === "";
    },
    reportProblem: () => writeDiagnostics(),
    testingTool: (tool) => runTestingTool(tool),
    axInspect: (showValues) => helper.inspectAccessibility(showValues),
    planView: () => planView(),
    planAct: (action) => {
      plans.act(action);
      return planView();
    },
    dataExport: async ({ categories }) => {
      if (!history || !database) {
        return {
          ok: false,
          message: "Nothing can be exported without the database.",
          canceled: false,
        };
      }
      const options = {
        title: "Choose where to save the export",
        buttonLabel: "Export here",
        defaultPath: app.getPath("documents"),
        properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[],
      };
      const choice = hubWindow
        ? await dialog.showOpenDialog(hubWindow, options)
        : await dialog.showOpenDialog(options);
      const parent = choice.filePaths[0];
      if (choice.canceled || !parent) return { ok: false, message: "", canceled: true };
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
      const folder = path.join(parent, `Murmur export ${stamp}`);
      try {
        const counts = writeExport(
          folder,
          categories,
          {
            dictations: () => history.allRows(),
            dictionary: () => dictionary?.list() ?? [],
            snippets: () => snippets?.list() ?? [],
            styles: () => styles?.view() ?? { styles: [], overrides: [], recentApps: [] },
            customRewrites: () =>
              (rewrites?.list() ?? []).filter((rewrite) => rewrite.builtinKey === null),
            memory: () => memory?.list() ?? [],
            notes: () =>
              (notes?.list() ?? []).flatMap((item) => {
                const note = notes?.get(item.id);
                return note ? [note] : [];
              }),
            noteImages: noteImages ?? { file: () => null, dataUrl: () => null },
            instructThreads: () =>
              (instructThreads?.list("", 1000) ?? []).flatMap((item) => {
                const thread = instructThreads?.get(item.id);
                return thread ? [thread] : [];
              }),
            insights: () => insights?.days(null) ?? [],
            meetings: () =>
              (meetingsStore?.list(100_000) ?? []).map((meeting) => ({
                title: meeting.title,
                startedAt: meeting.startedAt,
                endedAt: meeting.endedAt,
                attendees: meeting.attendees ?? [],
                notes: meetingNotes?.notes(meeting.id).body ?? "",
                summaries: meetingSummaries?.list(meeting.id) ?? [],
                transcript: meetingTranscripts?.segments(meeting.id) ?? [],
              })),
            tasks: () => tasksService?.list().tasks ?? [],
            contacts: () => contactsStore?.list() ?? [],
            audioFiles: () => history.audioFiles(),
          },
          Date.now(),
        );
        console.log(`[export] wrote ${JSON.stringify(counts)}`);
        return { ok: true, folder, counts };
      } catch (error) {
        return {
          ok: false,
          message: `The export could not be written: ${error instanceof Error ? error.message : String(error)}`,
          canceled: false,
        };
      }
    },
    dataCounts: () => dataDeleter?.counts() ?? { categories: [], failedFiles: 0 },
    dataDelete: (category) => {
      const result = dataDeleter?.delete(category) ?? { rows: 0, files: 0, failedFiles: 0 };
      lastTranscript.forget();
      console.log(`[data] deleted ${category}: ${result.rows} rows, ${result.files} files`);
      return result;
    },
    dataReset: async ({ includeModels }) => {
      // Sign-ins first: the tokens are in the Keychain, not in the database that is cleared next.
      await mcpService?.reset();
      const connectors = await connectorService?.reset();
      if (connectors && connectors.kept > 0)
        console.warn(`[connectors] reset: ${connectors.kept} sign-in(s) could not be removed`);
      rmSync(connectorsFile, { force: true });
      const result = dataDeleter?.deleteAll() ?? { rows: 0, files: 0, failedFiles: 0 };
      if (includeModels) {
        await rm(speechModelRoot(profile.modelsAppData), { recursive: true, force: true });
        await rm(cleanupRoot, { recursive: true, force: true });
      }
      console.log(`[data] reset: ${result.rows} rows, ${result.files} files`);
      // Back to first run with a clean start.
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 300);
      return result;
    },
    dataRetryFailed: () => dataDeleter?.retryFailed() ?? 0,
    storageView: () => {
      const root = path.join(profile.appData, "Murmur");
      const db = databasePath(profile.appData);
      return {
        folder: root,
        parts: [
          { name: "Database", bytes: sizeOf(db) + sizeOf(`${db}-wal`) + sizeOf(`${db}-shm`) },
          { name: "Recordings", bytes: sizeOf(path.join(root, "audio")) },
          { name: "Scratchpad images", bytes: sizeOf(path.join(root, "notes")) },
          {
            name: "Models",
            bytes: sizeOf(speechModelRoot(profile.modelsAppData)) + sizeOf(cleanupRoot),
          },
        ],
      };
    },
    storageOpen: () => {
      void shell.openPath(path.join(profile.appData, "Murmur"));
    },
    retentionView: () => retention?.view() ?? { lastRunAt: null, nextRunAt: null, removed: {} },
    retentionRun: () => {
      retention?.run(Date.now());
      return retention?.view() ?? { lastRunAt: null, nextRunAt: null, removed: {} };
    },
    notesList: (query) => notes?.list(query) ?? [],
    meetingsList: () =>
      (meetingsStore?.list() ?? []).map((meeting) => ({
        ...meeting,
        progress: meetingTranscripts?.progress(meeting.id) ?? { chunks: 0, done: 0 },
      })),
    meetingDetail,
    meetingRecording: () => meetings?.state() ?? { status: "idle" },
    meetingStart: async () =>
      meetingStarter
        ? meetingStarter.start()
        : { ok: false, message: "Meetings are not available." },
    meetingStop: async () => {
      await meetings?.stop();
    },
    meetingSummarize: async (id, options) => {
      if (!summaryRunner) return { ok: false, message: "Summaries are not available." };
      try {
        await summaryRunner.run(id, options);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof SummaryError ? error.message : "The summary could not be written.",
        };
      }
    },
    meetingSummaryFeedback: (summaryId, feedback) => {
      meetingSummaries?.setFeedback(summaryId, feedback);
    },
    skillsList: () => meetingSkills?.list() ?? [],
    tasksList: (filter) => tasksService?.list(filter) ?? { tasks: [], undo: null },
    taskAdd: (draft) => tasksService?.addManual(draft) ?? noTasks,
    taskUpdate: (id, draft) => tasksService?.update(id, draft) ?? noTasks,
    taskAction: (id, action) => tasksService?.act(id, action) ?? noTasks,
    taskReorder: (id, beforeId) => tasksService?.reorder(id, beforeId) ?? noTasks,
    tasksUndo: () => tasksService?.undo() ?? { ok: false },
    meetingSpeakerRename: (meetingId, speakerId, name) => {
      const result = speakersStore?.rename(meetingId, speakerId, name) ?? {
        ok: false as const,
        message: "Speakers cannot be saved without the database.",
      };
      if (result.ok) {
        contactsStore?.addSpeaker(name);
        notifyMeetings(meetingId);
      }
      return result;
    },
    contactsList: (query) => contactsStore?.list(query) ?? [],
    contactSave: (id, draft) =>
      contactsStore?.save(id, draft) ?? { ok: false, message: "Contacts need the database." },
    contactDelete: (id) => contactsStore?.remove(id) ?? false,
    contactCard: (id) => contactsStore?.card(id) ?? null,
    meetingCorrect: (meetingId, correction) => {
      if (!correctionsStore) return { ok: false, message: "Corrections need the database." };
      const result = correctionsStore.apply(meetingId, correction);
      if (!result.ok) return result;
      if (result.changed) notifyMeetings(meetingId);
      // Words the owner changes again and again are offered to the Dictionary, for review.
      const settings = settingsStore.get();
      const learned =
        result.changed &&
        result.before !== undefined &&
        result.after !== undefined &&
        learner &&
        settings.learnCorrections &&
        settings.notetaker.corrections.suggestDictionary
          ? suggestFromCorrection(learner, result.before, result.after)
          : null;
      return { ok: true, segmentId: result.segmentId, changed: result.changed, learned };
    },
    foldersList: () => foldersStore?.list() ?? [],
    folderCreate: (name) => folderResult(foldersStore?.create(name)),
    folderRename: (id, name) => folderResult(foldersStore?.rename(id, name)),
    folderDelete: (id) => {
      if (!foldersStore) return folderResult(undefined);
      foldersStore.remove(id);
      const current = settingsStore.get().notetaker;
      if (current.folders.defaultFolder === id)
        settingsStore.update({
          notetaker: { ...current, folders: { ...current.folders, defaultFolder: "inbox" } },
        });
      notifyMeetings(null);
      return { ok: true, folders: foldersStore.list() };
    },
    folderUpdate: (id, patch) => {
      if (!foldersStore?.get(id)) return folderResult(undefined);
      if (patch.defaultSkillId !== undefined)
        foldersStore.setDefaultSkill(id, patch.defaultSkillId);
      foldersStore.setRetention(id, {
        ...(patch.retentionAudio !== undefined ? { audio: patch.retentionAudio } : {}),
        ...(patch.retentionTranscript !== undefined
          ? { transcript: patch.retentionTranscript }
          : {}),
      });
      return { ok: true, folders: foldersStore.list(), id };
    },
    folderChooseExport: async (id) => {
      if (!foldersStore?.get(id)) return folderResult(undefined);
      const options = {
        title: "Where should a file of each meeting be written?",
        properties: ["openDirectory" as const, "createDirectory" as const],
      };
      const picked = hubWindow
        ? await dialog.showOpenDialog(hubWindow, options)
        : await dialog.showOpenDialog(options);
      const dir = picked.filePaths[0];
      if (!picked.canceled && dir) foldersStore.setAutoExport(id, dir);
      return { ok: true, folders: foldersStore.list(), id };
    },
    folderClearExport: (id) => {
      if (!foldersStore?.get(id)) return folderResult(undefined);
      foldersStore.setAutoExport(id, null);
      return { ok: true, folders: foldersStore.list(), id };
    },
    mcpClients: () => ({
      clients: mcpService?.clients.list() ?? [],
      command: mcpCommandPath(),
      socketPath: mcpSocketPath,
    }),
    mcpIssue: async (name, kind) => {
      const result = await (mcpService?.clients.issue(name, kind) ?? Promise.resolve(null));
      if (!result) return { ok: false, message: "The MCP server is not available." };
      return result.ok ? { ok: true, message: `Added ${result.client.name}.` } : result;
    },
    mcpRotate: async (id) =>
      (await mcpService?.clients.rotate(id)) ?? {
        ok: false,
        message: "The MCP server is not available.",
      },
    mcpRevoke: async (id) =>
      (await mcpService?.clients.revoke(id)) ?? {
        ok: false,
        message: "The MCP server is not available.",
      },
    mcpCopyToken: async (id) => {
      const token = await mcpService?.clients.token(id);
      if (!token)
        return { ok: false, message: "The token is not in the Keychain. Make a new one." };
      await clipboard.writeText(token);
      // Cleared after a minute, if it is still what is there.
      setTimeout(() => {
        void clipboard.readText().then((text) => {
          if (text === token) void clipboard.clear();
        });
      }, 60_000).unref();
      return { ok: true, message: "Copied. The clipboard is cleared in a minute." };
    },
    mcpConfigPreview: async (id) =>
      (await mcpSetup?.preview(id)) ?? { ok: false, message: "The MCP server is not available." },
    mcpConfigWrite: async (previewId) =>
      (await mcpSetup?.apply(previewId)) ?? {
        ok: false,
        message: "The MCP server is not available.",
      },
    mcpAudit: () => mcpService?.audit.list(50) ?? [],
    mcpAuditClear: () => mcpService?.audit.clear(),
    // Waits for any change of setting to be applied, so the page sees where things are now.
    mcpStatus: () => mcpService?.apply() ?? Promise.resolve(MCP_STATUS_OFF),
    connectorsView: () =>
      buildConnectorsView({
        available: new Set(connectorRegistry.list().map((provider) => provider.id)),
        accounts: connectorService?.list() ?? [],
        config: connectorConfig,
        settings: settingsStore.get().connectors,
        isConnecting: (id) => connectorService?.isConnecting(id) ?? false,
      }),
    connectorConnect: async (id, loginHint) => {
      if (!connectorService) return { ok: false, message: "Connectors are not available." };
      const refusal = connectorRefusal();
      if (refusal !== null) return { ok: false, message: refusal };
      const outcome = await connectorService.connect(
        id,
        connectOptionsFor(
          id,
          settingsStore.get().connectors,
          loginHint,
          connectorRegistry.get(id)?.scopes,
        ),
      );
      if (outcome.ok) {
        if ((DATA_CONNECTOR_IDS as readonly string[]).includes(outcome.account.connector))
          void connectorData?.refresh(outcome.account.id);
        else void calendarSync?.syncAccount(outcome.account.id);
      }
      return outcome.ok
        ? { ok: true, message: `Connected ${outcome.account.email}.` }
        : { ok: false, message: outcome.message };
    },
    connectorCancel: (id) => connectorService?.cancelConnect(id),
    connectorDisconnect: async (accountId) => {
      if (!connectorService) return { ok: false, message: "Connectors are not available." };
      try {
        const { revoked } = await connectorService.disconnect(accountId);
        return {
          ok: true,
          message:
            revoked === false
              ? "Disconnected here. The provider did not confirm it, so also remove Murmur in that account's own settings."
              : "Disconnected.",
        };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "Could not disconnect.",
        };
      }
    },
    connectorSetEnabled: (accountId, enabled) => connectorService?.setEnabled(accountId, enabled),
    connectorConnectKey: async (id, key) => {
      if (!connectorService) return { ok: false, message: "Connectors are not available." };
      const refusal = connectorRefusal();
      if (refusal !== null) return { ok: false, message: refusal };
      const outcome = await connectorService.connectWithKey(id, key);
      return outcome.ok
        ? { ok: true, message: `Connected ${outcome.account.email}.` }
        : { ok: false, message: outcome.message };
    },
    connectorRecordings: async (accountId) =>
      featureOn("import-services")
        ? (connectorImport?.list(accountId) ?? { ok: false, message: "Import needs the database." })
        : { ok: false, message: "Importing is turned off on the Connectors page." },
    connectorImportPrepare: async (accountId, remoteId) =>
      connectorImport?.prepare(accountId, remoteId) ?? {
        ok: false,
        message: "Import needs the database.",
      },
    connectorOptions: async (accountId) =>
      connectorData?.options(accountId) ?? { ok: false, message: "Connectors are not available." },
    connectorDataStatus: () => connectorData?.status() ?? [],
    connectorSync: async (accountId) => {
      const refusal = connectorRefusal();
      if (refusal !== null) return { ok: false, message: refusal };
      // A Slack, Notion, Linear or GitHub account is read by the connector data; a calendar by the calendar sync.
      const account = connectorService?.list().find((entry) => entry.id === accountId);
      if (account && (DATA_CONNECTOR_IDS as readonly string[]).includes(account.connector)) {
        const read = (await connectorData?.refresh(accountId)) ?? {
          ok: false as const,
          message: "Connectors are not available.",
        };
        return read.ok
          ? { ok: true, message: `Read ${read.count} ${read.count === 1 ? "item" : "items"}.` }
          : read;
      }
      const result = await (calendarSync?.syncAccount(accountId) ??
        Promise.resolve({ ok: false as const, message: "Calendars are not available." }));
      return result.ok
        ? { ok: true, message: `Read ${result.count} ${result.count === 1 ? "event" : "events"}.` }
        : result;
    },
    briefOverview: () => briefs?.overview() ?? noBriefs,
    briefGet: (eventKey) => briefs?.get(eventKey) ?? null,
    briefForMeeting: (meetingId) => {
      const eventId = meetingsStore?.get(meetingId)?.calendarEventId;
      const found = eventId ? briefsStore?.getForEvent(eventId) : null;
      return found ?? briefsStore?.get(`meeting:${meetingId}`) ?? null;
    },
    briefBuild: async (eventKey) =>
      briefs?.build(eventKey) ?? { ok: false, message: "Briefs need a calendar and the database." },
    briefOpen: async (url) => {
      // Only an address from a connected service's own reads is opened.
      if (!/^https:\/\/(github\.com|linear\.app|(www\.)?notion\.so)\//i.test(url))
        return { ok: false };
      await shell.openExternal(url);
      return { ok: true };
    },
    briefTarget: () => {
      const target = briefTarget;
      briefTarget = null;
      return target;
    },
    askActionPropose: async (request) => askActions.propose(request),
    slackPostState: () => draftState("post_to_slack"),
    slackPostStart: async (source) => {
      const state = draftState("post_to_slack");
      if (!state.available) return { ok: false, message: state.reason ?? noSlackPost.reason };
      return slackPost?.start(source) ?? { ok: false, message: noSlackPost.reason };
    },
    slackPostPrepare: async (input) => {
      const state = draftState("post_to_slack");
      if (!state.available) return { ok: false, message: state.reason ?? noSlackPost.reason };
      return slackPost?.prepare(input) ?? { ok: false, message: noSlackPost.reason };
    },
    slackPostSend: async (input) => {
      // The click on "Send to Slack" is what runs the action.
      const result = await actionRunner.run("post_to_slack", input, fromUserClick());
      return result.ok
        ? (result.result as SlackSendResult)
        : { ok: false, message: result.message };
    },
    extensionsView: () => actionRunner.view(),
    emailDraftState: () => draftState("draft_email"),
    emailDraftPropose: async (source) => {
      const state = draftState("draft_email");
      if (!state.available) return { ok: false, message: state.reason ?? noEmailDrafts.reason };
      return emailDrafts?.propose(source) ?? { ok: false, message: noEmailDrafts.reason };
    },
    emailDraftCreate: async (input) => {
      // The click on "Create the draft in Gmail" is what runs the action.
      const result = await actionRunner.run("draft_email", input, fromUserClick());
      return result.ok
        ? (result.result as EmailDraftResult)
        : { ok: false, message: result.message };
    },
    emailDraftList: (source) => emailDrafts?.list(source) ?? [],
    calendarEventState: () => draftState("create_event"),
    calendarEventPropose: async (source) => {
      const state = draftState("create_event");
      if (!state.available) return { ok: false, message: state.reason ?? noEventCreate.reason };
      return eventCreate?.propose(source) ?? { ok: false, message: noEventCreate.reason };
    },
    calendarEventCreate: async (input) => {
      // The click on "Create the event" is what runs the action.
      const result = await actionRunner.run("create_event", input, fromUserClick());
      return result.ok
        ? (result.result as CalendarEventResult)
        : { ok: false, message: result.message };
    },
    calendarEventList: (source) => eventCreate?.list(source) ?? [],
    calendarEventOpen: async (url) => {
      // Only an event's address at the calendar service is opened, never another address.
      if (!isCalendarOpenUrl(url)) return { ok: false };
      await shell.openExternal(url);
      return { ok: true };
    },
    emailDraftOpen: async (url) => {
      // Only a draft in Gmail is opened, never another address.
      if (!url.startsWith("https://mail.google.com/mail/u/")) return { ok: false };
      await shell.openExternal(url);
      return { ok: true };
    },
    connectorSetClientId: async (id, clientId) => {
      if (!CONNECTOR_CATALOGUE.some((entry) => entry.id === id))
        return { ok: false, message: "That connector is not known." };
      const value = clientId?.trim() ?? null;
      if (value !== null && !isClientCredential(value))
        return { ok: false, message: "A client id is one piece of text with no spaces." };
      try {
        connectorConfig.setClientId(id, value === "" ? null : value);
        return { ok: true };
      } catch {
        return { ok: false, message: "Murmur could not save the client id." };
      }
    },
    connectorSetClientSecret: async (id, secret) => {
      if (!CONNECTOR_CATALOGUE.some((entry) => entry.id === id && entry.clientSecret))
        return { ok: false, message: "That connector has no client secret." };
      const value = secret?.trim() ?? null;
      if (value !== null && !isClientCredential(value))
        return { ok: false, message: "A client secret is one piece of text with no spaces." };
      try {
        await connectorConfig.setClientSecret(id, value === "" ? null : value);
        return { ok: true };
      } catch {
        return { ok: false, message: "Murmur could not save the client secret in the Keychain." };
      }
    },
    meetingMove: (meetingId, folderId) => {
      if (!foldersStore) return folderResult(undefined);
      const moved = foldersStore.move(meetingId, folderId);
      if (moved.ok) notifyMeetings(meetingId);
      return moved.ok ? { ok: true, folders: foldersStore.list() } : moved;
    },
    meetingFolderDismiss: (meetingId, folderId) => {
      foldersStore?.dismiss(meetingId, folderId);
      notifyMeetings(meetingId);
    },
    meetingExport: async (meetingId, options) => {
      const file = buildMeetingExport(meetingId, options);
      if (!file) return { ok: false, message: "That meeting is gone." };
      const archive = file.audio.length > 0;
      const dialogOptions = {
        title: "Export a shareable file",
        defaultPath: path.join(
          app.getPath("documents"),
          archive ? file.fileName.replace(/\.html$/, ".murmur-meeting") : file.fileName,
        ),
        filters: archive
          ? [{ name: "Meeting archive", extensions: ["murmur-meeting"] }]
          : [{ name: "Web page", extensions: ["html"] }],
      };
      const choice = hubWindow
        ? await dialog.showSaveDialog(hubWindow, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions);
      if (choice.canceled || !choice.filePath) return { ok: false, cancelled: true };
      try {
        writeFileSync(
          choice.filePath,
          archive
            ? zipFiles([
                { name: "index.html", data: Buffer.from(file.html, "utf8") },
                ...file.audio.map(({ name, path: from }) => ({ name, data: readFileSync(from) })),
              ])
            : file.html,
        );
        return { ok: true, path: choice.filePath };
      } catch {
        return { ok: false, message: "The file could not be saved there." };
      }
    },
    meetingRecap: async (id) => {
      if (!recapRunner) return { ok: false, message: "Recaps need the database." };
      try {
        return { ok: true, recap: await recapRunner.run(id) };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof RecapError
              ? error.message
              : "The recap could not be written. Try again.",
        };
      }
    },
    meetingImportPreview: async () => {
      if (!transcriptImport) return { ok: false, message: "Import needs the database." };
      const options = {
        title: "Import a transcript",
        properties: ["openFile" as const],
        filters: [
          { name: "Transcripts", extensions: ["vtt", "srt", "txt", "json"] },
          { name: "All files", extensions: ["*"] },
        ],
      };
      const picked = hubWindow
        ? await dialog.showOpenDialog(hubWindow, options)
        : await dialog.showOpenDialog(options);
      const file = picked.filePaths[0];
      if (picked.canceled || !file) return { ok: false, cancelled: true };
      try {
        const stat = statSync(file);
        if (stat.size > 20 * 1024 * 1024)
          return { ok: false, message: "That file is too big to be a transcript." };
        const prepared = transcriptImport.prepare({
          name: path.basename(file),
          bytes: new Uint8Array(readFileSync(file)),
          modifiedAt: stat.mtimeMs,
        });
        return prepared.ok ? { ok: true, preview: prepared.preview } : prepared;
      } catch {
        return { ok: false, message: "That file could not be read." };
      }
    },
    meetingImportConfirm: (input) => {
      if (!transcriptImport) return { ok: false, message: "Import needs the database." };
      const result = transcriptImport.confirm(input);
      if (result.ok) {
        afterImport(result.meetingId);
      }
      return result;
    },
    meetingImportCancel: (token) => transcriptImport?.discard(token),
    meetingRetentionDue: () => meetingRetention?.due(Date.now()) ?? { audio: 0, transcripts: 0 },
    meetingRetentionLog: () => meetingRetention?.log() ?? [],
    meetingSetLanguage: (meetingId, input) =>
      meetingRerun?.setLanguage(meetingId, input) ?? {
        ok: false,
        message: "Languages need the database.",
      },
    meetingRerun: (meetingId, input) =>
      meetingRerun?.rerun(meetingId, input) ?? { ok: false, message: "Rerun needs the database." },
    meetingVersionRestore: (meetingId, versionId) =>
      meetingRerun?.restore(meetingId, versionId) ?? {
        ok: false,
        message: "Rerun needs the database.",
      },
    meetingSegmentHistory: (meetingId, segmentId) =>
      correctionsStore?.history(meetingId, segmentId) ?? [],
    meetingCorrectionRevert: (meetingId, correctionId) => {
      const result = correctionsStore?.revert(meetingId, correctionId) ?? {
        ok: false as const,
        message: "Corrections need the database.",
      };
      if (result.ok) notifyMeetings(meetingId);
      return result;
    },
    meetingSpeakerClip: (meetingId, speakerId) =>
      speakerClip?.(meetingId, speakerId) ?? { ok: false, reason: "no-audio" },
    askThreads: () => askStore?.list() ?? [],
    askThread: (id) => askStore?.get(id) ?? null,
    askSend: async (input) => {
      if (!askRunner) return { ok: false, message: "Ask needs the database." };
      const refusal = planRefusal(settingsStore.get().plan, "askMeetings");
      if (refusal !== null) return { ok: false, message: refusal };
      try {
        return { ok: true, thread: await askRunner.send(input) };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof AskError ? error.message : "The question could not be answered.",
        };
      }
    },
    askDelete: (id) => askStore?.remove(id),
    meetingFindTasks: (id) => {
      if (!meetingJobs || !meetingsStore?.get(id))
        return { ok: false, message: "That meeting is gone." };
      meetingJobs.enqueue(id, "extract_tasks");
      meetingJobs.kick();
      notifyMeetings(id);
      return { ok: true };
    },
    skillSave: (id, draft) => skillsService?.save(id, draft) ?? noSkills,
    skillDuplicate: (id) => skillsService?.duplicate(id) ?? noSkills,
    skillDelete: (id) => skillsService?.remove(id) ?? noSkills,
    skillVersions: (id) => skillsService?.versions(id) ?? [],
    skillRestore: (id, version) => skillsService?.restore(id, version) ?? noSkills,
    skillExport: async (id) => {
      const file = skillsService?.exportFile(id);
      if (!file) return { ok: false, message: "That Skill was not found." };
      const options = {
        title: "Export a Skill",
        defaultPath: path.join(app.getPath("documents"), file.fileName),
        filters: [{ name: "Markdown", extensions: ["md"] }],
      };
      const choice = hubWindow
        ? await dialog.showSaveDialog(hubWindow, options)
        : await dialog.showSaveDialog(options);
      if (choice.canceled || !choice.filePath) return { ok: false, cancelled: true };
      try {
        writeFileSync(choice.filePath, file.text);
        return { ok: true, path: choice.filePath };
      } catch {
        return { ok: false, message: "The file could not be saved there." };
      }
    },
    skillImport: async () => {
      if (!skillsService) return { ...noSkills, line: null };
      const options = {
        title: "Import a Skill",
        properties: ["openFile" as const],
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
      };
      const picked = hubWindow
        ? await dialog.showOpenDialog(hubWindow, options)
        : await dialog.showOpenDialog(options);
      const file = picked.filePaths[0];
      if (picked.canceled || !file) return { ok: false, cancelled: true };
      let text: string;
      try {
        if (statSync(file).size > 100_000)
          return { ok: false, message: "That file is too big to be a Skill.", line: null };
        text = readFileSync(file, "utf8");
      } catch {
        return { ok: false, message: "That file could not be read.", line: null };
      }
      return skillsService.importFile(text);
    },
    skillImportFolder: async () => {
      if (!skillsService) return { ok: false, message: noSkills.message };
      const options = {
        title: "Import Skills from a folder",
        properties: ["openDirectory" as const],
      };
      const picked = hubWindow
        ? await dialog.showOpenDialog(hubWindow, options)
        : await dialog.showOpenDialog(options);
      const folder = picked.filePaths[0];
      if (picked.canceled || !folder) return { ok: false, cancelled: true };
      try {
        return { ok: true, ...skillsService.importFolder(readSkillFiles(folder)) };
      } catch {
        return { ok: false, message: "That folder could not be read." };
      }
    },
    meetingRename: (id, title) => {
      meetingsStore?.rename(id, title);
      notifyMeetings(id);
    },
    meetingDelete: deleteMeeting,
    meetingNotesSave: (id, body) => meetingNotes?.saveNotes(id, body) ?? false,
    notionPages: () =>
      featureOn("notion-links")
        ? (connectorData?.items({ connector: "notion" }) ?? []).flatMap((item) =>
            item.url ? [{ title: item.title, url: item.url }] : [],
          )
        : [],
    meetingDocAddLink: (id, url, title) => {
      if (!meetingsStore?.get(id) || !meetingNotes) return { ok: false, message: "No meeting." };
      const result = meetingNotes.addLink(id, url, title);
      notifyMeetings(id);
      return result;
    },
    meetingDocAddFile: async (id) => {
      const folder = meetingsStore?.folderOf(id);
      if (!folder || !meetingNotes) return { ok: false, message: "No meeting." };
      const options = { title: "Attach a file", properties: ["openFile" as const] };
      const picked = hubWindow
        ? await dialog.showOpenDialog(hubWindow, options)
        : await dialog.showOpenDialog(options);
      const file = picked.filePaths[0];
      if (picked.canceled || !file) return { ok: false, message: "", canceled: true };
      const result = meetingNotes.addFile(id, folder, file);
      notifyMeetings(id);
      return result;
    },
    meetingDocOpen: async (docId) => {
      const target = meetingNotes?.target(docId);
      if (!target) return;
      // Links were checked to be http or https when they were added.
      if (target.kind === "link") {
        await shell.openExternal(target.value);
      } else await shell.openPath(target.value);
    },
    meetingDocRemove: (docId) => meetingNotes?.removeDoc(docId),
    noteGet: (id) => notes?.get(id) ?? null,
    noteCreate: ({ fromLastDictation }) => {
      if (!notes) return { ok: false, message: "Notes cannot be saved without the database." };
      const text = fromLastDictation ? (history?.lastText() ?? null) : "";
      if (text === null) return { ok: false, message: NOTE_MESSAGES.noDictation };
      const note = notes.create(text);
      checkMilestones(true);
      return { ok: true, note };
    },
    noteSave: (input) => {
      if (!notes) return { ok: false, message: "Notes cannot be saved without the database." };
      const result = notes.save(input);
      // HB-28: a version after five minutes of changes.
      if (result.ok) notes.saveVersion({ noteId: input.id, label: null, reason: "auto" });
      return result;
    },
    noteVersions: (noteId) => notes?.versions(noteId) ?? [],
    noteVersionSave: (input) => notes?.saveVersion(input) ?? null,
    noteVersionText: (id) => notes?.versionText(id) ?? null,
    noteVersionRestore: (id) => notes?.restore(id) ?? null,
    notePin: (noteId, pinned) =>
      notes?.pin(noteId, pinned) ?? {
        ok: false,
        message: "Notes cannot be changed without the database.",
      },
    notePinMove: (noteId, step) => notes?.movePin(noteId, step),
    noteDelete: (id) => {
      notes?.remove(id);
      // The rows went with the note; its image files go now.
      noteImages?.removeFolder(id);
    },
    noteImageAdd: (input) =>
      noteImages?.add(input) ??
      Promise.resolve({
        ok: false as const,
        message: "Images cannot be saved without the database.",
      }),
    noteRewrites: () => noteRewriteChoices(rewrites?.enabled() ?? [], meetingSkills?.list() ?? []),
    noteRewriteRun: async ({ rewriteId, text }) => {
      const skill = rewriteId.startsWith(SKILL_CHOICE)
        ? (meetingSkills?.get(rewriteId.slice(SKILL_CHOICE.length)) ?? null)
        : null;
      const rewrite = skill
        ? { instruction: skillInstruction(skill), example: null, enabled: true }
        : (rewrites?.get(rewriteId) ?? null);
      if (!rewrite || !rewrite.enabled)
        return { ok: false, message: "That Rewrite is not available." };
      try {
        // A note is not an app: no style, Memory or samples go in, only the instruction.
        const run = generation.generate({
          kind: "rewrite",
          instruction: rewrite.instruction,
          ...(rewrite.example ? { example: rewrite.example } : {}),
          text,
        });
        const result = await run.result;
        return { ok: true, text: result.text };
      } catch (error) {
        return { ok: false, message: GENERATION_MESSAGES[generationErrorCode(error)] };
      }
    },
    noteRewriteRecord: (input) => {
      if (!notes) return;
      notes.recordRewrite(input);
      if (input.outcome === "discarded") return;
      rewrites?.markUsed(input.rewriteId);
      if (input.outcome === "replaced") {
        const name =
          rewrites?.get(input.rewriteId)?.name ??
          meetingSkills?.get(input.rewriteId.slice(SKILL_CHOICE.length))?.name ??
          "Rewrite";
        notes.saveVersion({
          noteId: input.noteId,
          label: `${name} applied`.slice(0, 60),
          reason: "manual",
        });
      }
      checkMilestones(true);
    },
    noteExport: async ({ noteId, format }) => {
      const note = notes?.get(noteId) ?? null;
      if (!note || !noteImages) return { saved: false };
      const extension = format === "markdown" ? "md" : "html";
      const options = {
        title: format === "markdown" ? "Export as Markdown" : "Export as HTML",
        defaultPath: path.join(app.getPath("documents"), `${noteFileName(note)}.${extension}`),
        filters: [
          format === "markdown"
            ? { name: "Markdown", extensions: ["md"] }
            : { name: "HTML", extensions: ["html"] },
        ],
      };
      const owner = scratchpadWindow && !scratchpadWindow.isDestroyed() ? scratchpadWindow : null;
      const choice = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options);
      if (choice.canceled || !choice.filePath) return { saved: false };
      if (format === "markdown") writeNoteMarkdown(note, choice.filePath, noteImages);
      else writeNoteHtml(note, choice.filePath, noteImages);
      return { saved: true };
    },
    noteImport: ({ fileName, markdown }) => {
      if (!notes) return { ok: false, message: "Notes cannot be saved without the database." };
      const note = notes.createRich(markdownTitle(markdown, fileName), markdownToRich(markdown));
      if (!note) return { ok: false, message: NOTE_MESSAGES.tooBig };
      checkMilestones(true);
      return { ok: true, note };
    },
    noteImageData: (id) => noteImages?.dataUrl(id) ?? null,
    scratchpadOpen: (noteId) => openScratchpad(noteId ?? undefined),
    homeView: () => {
      const today = localDate(Date.now());
      const days = insights?.days(null) ?? [];
      const todayRow = days.find((day) => day.date === today);
      const typingWpm = settingsStore.get().insights.typingWpm;
      const last = history?.page({}).rows.find((row) => row.finalText) ?? null;
      return {
        todayWords: todayRow?.words ?? 0,
        todayDictations: todayRow?.dictations ?? 0,
        todayTimeSavedMs: todayRow
          ? buildInsights([todayRow], "7", today, typingWpm).timeSavedMs
          : 0,
        totalDictations: days.reduce((total, day) => total + day.dictations, 0),
        last: last
          ? { text: last.finalText!, appName: last.appName ?? last.appBundleId, at: last.createdAt }
          : null,
      };
    },
    historyRetry: (id) => retryFromHub(id),
    historyCopyAudioPath: (id) => {
      // DC-38: where a failed dictation's recording is, for the person to find it.
      const file = history?.retrySource(id)?.audioPath;
      if (file) void clipboard.writeText(file);
      return file !== undefined;
    },
    dictationState: () => hubDictationState,
    milestonesList: () => {
      checkMilestones(false);
      return milestones?.list() ?? [];
    },
    milestonesSeen: () => milestones?.markSeen(Date.now()),
    progressCardSave: async (png) => {
      const options = {
        title: "Save progress card",
        defaultPath: path.join(
          app.getPath("pictures"),
          `murmur-progress-${localDate(Date.now())}.png`,
        ),
        filters: [{ name: "PNG image", extensions: ["png"] }],
      };
      const choice = hubWindow
        ? await dialog.showSaveDialog(hubWindow, options)
        : await dialog.showSaveDialog(options);
      if (choice.canceled || !choice.filePath) return { saved: false };
      writeFileSync(choice.filePath, png);
      return { saved: true };
    },
    progressCardCopy: async (png) => {
      const image = new Blob([Buffer.from(png)], { type: "image/png" });
      await clipboard.write([new ClipboardItem({ "image/png": image })]);
    },
    insightsView: (range) =>
      buildInsights(
        insights?.days(null) ?? [],
        range,
        localDate(Date.now()),
        settingsStore.get().insights.typingWpm,
      ),
    insightsExport: async (range) => {
      const days = insights?.days(rangeFirstDay(range, localDate(Date.now()))) ?? [];
      const options = {
        title: "Save Insights",
        defaultPath: path.join(
          app.getPath("documents"),
          `murmur-insights-${localDate(Date.now())}.csv`,
        ),
        filters: [{ name: "CSV", extensions: ["csv"] }],
      };
      const choice = hubWindow
        ? await dialog.showSaveDialog(hubWindow, options)
        : await dialog.showSaveDialog(options);
      if (choice.canceled || !choice.filePath) return { saved: false, rows: 0 };
      writeFileSync(choice.filePath, insightsCsv(days));
      return { saved: true, rows: days.length };
    },
    historyPage: (query) =>
      history ? history.page(query) : { rows: [], total: 0, apps: [], languages: [] },
    historyArchive: (ids, archived) => history?.setArchived(ids, archived) ?? 0,
    historyFeedback: (input) => history?.setFeedback(input),
    historyDelete: (ids) => {
      const result = history?.remove(ids) ?? { rows: 0, files: 0 };
      console.log(`[history] deleted ${result.rows} rows and ${result.files} audio files`);
      return result;
    },
    loginItemGet: () => loginItem(),
    loginItemSet: (enabled) => {
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: enabled });
      return loginItem();
    },
    hubSetPage: (page) => {
      hubSaved = { ...hubSaved, page };
      hubState.update({ page });
    },
    getAppInfo: () => ({
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
    }),
    getHelperStatus: () => helper.getStatus(),
    getPermissions: () => permissions.check("hub refresh"),
    requestPermission: (kind) => permissions.request(kind),
    openPermissionSettings,
    getSettings: () => settingsService.view(),
    updateSettings: (patch) => settingsService.update(patch),
    setShortcut: (slot, key) => settingsService.setShortcut(slot, key),
    resetShortcuts: (slot) => settingsService.resetShortcuts(slot),
    captureShortcut: (active) => hotkeys.setPaused(active),
    getSetupStatus: async () => ({ model: modelDownload.status(), blockers: blockersNow() }),
    micCheckStart: () => micCheck.start(),
    micCheckStop: () => micCheck.stop(),
    getMediaPlayback: () => helper.getPlayback().catch(() => null),
    dictionaryList: () => dictionary?.list() ?? [],
    dictionarySave: (input) =>
      dictionary?.save(input) ?? {
        ok: false,
        reason: "not-found",
        message: "The dictionary could not be opened.",
      },
    dictionaryDelete: async (id) => {
      // A pronunciation clip goes with its entry.
      await clips?.remove(id);
      dictionary?.remove(id);
    },
    dictionaryClipStart: (id) =>
      settingsStore.get().experimental.pronunciationClips && clips
        ? clips.start(id)
        : Promise.resolve({ ok: false, message: "Pronunciation clips are off." }),
    dictionaryClipStop: () =>
      clips?.stop() ?? Promise.resolve({ ok: false, message: "Nothing is being recorded." }),
    dictionaryClipPlay: (id) => clips?.play(id) ?? Promise.resolve(null),
    dictionaryClipDelete: (id) => clips?.remove(id) ?? Promise.resolve(),
    dictionaryKeep: (id) => dictionary?.keep(id),
    snippetsList: () => snippets?.list() ?? [],
    snippetsSave: (input) =>
      snippets?.save(input) ?? {
        ok: false,
        reason: "not-found",
        message: "Snippets could not be opened.",
      },
    snippetsDelete: (id) => snippets?.remove(id),
    stylesView: () => styles?.view() ?? { styles: [], overrides: [], recentApps: [] },
    stylesUpdate: (update) => {
      styles?.update(update);
      return styles?.view() ?? { styles: [], overrides: [], recentApps: [] };
    },
    stylesSetOverride: (override) => {
      styles?.setOverride(override);
      return styles?.view() ?? { styles: [], overrides: [], recentApps: [] };
    },
    writingSamplesList: () => writingSamples?.list() ?? [],
    writingSamplesSave: (input) =>
      writingSamples?.save(input) ?? {
        ok: false,
        reason: "full",
        message: "Writing samples could not be opened.",
      },
    writingSamplesDelete: (id) => writingSamples?.remove(id),
    voiceProfileView: () => profileView(),
    voiceProfileReset: () => {
      voiceProfile?.reset();
      return profileView();
    },
    importPreview: (request) => importer.preview(request),
    importApply: (request) => importer.apply(request),
    memoryList: () => memory?.list() ?? [],
    memorySave: (input) =>
      memory?.save(input) ?? {
        ok: false,
        reason: "not-found",
        message: "Memory could not be opened.",
      },
    memoryDelete: (id) => memory?.remove(id),
    rewritesList: () => withShortcutLabels(rewrites?.list() ?? [], keys),
    rewritesSave: (input) => {
      if (!rewrites) {
        return { ok: false, reason: "not-found", message: "Rewrites could not be opened." };
      }
      const refused =
        input.id === undefined ? refuseNewRewrite(settingsStore.get().plan, rewrites.list()) : null;
      return refused ?? rewrites.save(input);
    },
    rewritesSetEnabled: (id, enabled) => {
      rewrites?.setEnabled(id, enabled);
      refreshBindings();
    },
    rewritesSetShortcut: (id, key) => {
      if (!rewrites) return { ok: false, message: "Rewrites could not be opened." };
      const locked =
        key === null ? null : refuseRewriteShortcut(settingsStore.get().plan, rewrites.list(), id);
      if (locked) return { ok: false, message: locked };
      const result = setRewriteShortcut(
        { store: rewrites, settings: () => settingsStore.get(), platform: keys },
        id,
        key,
      );
      if (result.ok) refreshBindings();
      return result;
    },
    rewritesSetApplyDirectly: (id, applyDirectly) => rewrites?.setApplyDirectly(id, applyDirectly),
    rewritesSetAutoApply: (id, settings) => {
      // Free has no auto-apply (RW-22); turning it off is always allowed.
      if (settings.enabled && !allows("autoApply")) return;
      rewrites?.setAutoApply(id, settings);
    },
    instructThreads: (query) => instructThreads?.list(query) ?? [],
    instructThread: (id) => instructThreads?.get(id) ?? null,
    instructDelete: (id) => instructThreads?.delete(id),
    instructDeleteAll: () => instructThreads?.deleteAll(),
    instructReuse: (id) => instructController.reuse(id),
    instructModelStatus: () => qualityModel.status(),
    instructModelDownload: () => qualityModel.download(),
    instructModelRemove: () => qualityModel.remove(),
    focusState: () => focus.state(),
    focusStart: (duration) => {
      focus.start(duration);
      return focus.state();
    },
    focusStop: () => {
      focus.stop("user");
      return focus.state();
    },
    focusApps: () => focusStore?.apps() ?? [],
    focusAddApp: (input) => {
      if (!focusStore) return { ok: false, message: "Focus Mode could not open its list." };
      if (/^(com\.github\.electron|com\.electron\.)/i.test(input.bundleId)) {
        return { ok: false, message: FOCUS_MESSAGES.self };
      }
      const added = focusStore.addApp(input.bundleId, input.label);
      if (added === "duplicate") return { ok: false, message: FOCUS_MESSAGES.duplicate };
      if (added === "limit") return { ok: false, message: FOCUS_MESSAGES.limit };
      focus.refresh();
      return { ok: true, rule: added };
    },
    focusRemoveApp: (id) => {
      focusStore?.remove(id);
      focus.refresh();
    },
    focusInstalledApps: () => helper.listApps(),
    focusSites: () => ({
      rules: focusStore?.sites() ?? [],
      unavailableIn: focus.unavailableBrowsers(),
    }),
    focusAddSite: (input) => {
      if (!focusStore) return { ok: false, message: "Focus Mode could not open its list." };
      const parsed = parseSiteEntry(input.site);
      if (!parsed) return { ok: false, message: FOCUS_MESSAGES.notASite };
      const added = focusStore.addSite(parsed.value);
      if (added === "duplicate") return { ok: false, message: FOCUS_MESSAGES.siteDuplicate };
      if (added === "limit") return { ok: false, message: FOCUS_MESSAGES.sitesLimit };
      focus.refresh();
      return { ok: true, rule: added };
    },
    rewritesMove: (id, step) => rewrites?.move(id, step),
    rewritesDuplicate: (id) => {
      if (!rewrites) {
        return { ok: false, reason: "not-found", message: "Rewrites could not be opened." };
      }
      return refuseNewRewrite(settingsStore.get().plan, rewrites.list()) ?? rewrites.duplicate(id);
    },
    rewritesDelete: (id) => {
      const result = rewrites?.remove(id) ?? null;
      refreshBindings();
      return result;
    },
    stylesClearOverride: (bundleId) => {
      styles?.clearOverride(bundleId);
      return styles?.view() ?? { styles: [], overrides: [], recentApps: [] };
    },
    downloadSpeechModel: async () => {
      modelDownload.start();
      return { model: modelDownload.status(), blockers: blockersNow() };
    },
  });
  for (const channel of Object.values(IPC_CHANNELS)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => handle(channel, event, args));
  }

  /** DC-46: the Bar's right-click menu. */
  async function openBarMenu(): Promise<void> {
    const window = barWindow.menuWindow();
    if (!window) return;
    const settings = nextSession.settings();
    const [devices, deviceId] = await Promise.all([
      helper.listAudioDevices().catch(() => null),
      inputDevice(settings),
    ]);
    if (window.isDestroyed()) return;
    const rows = barMenu({
      settings,
      devices,
      deviceId,
      pending: nextSession.pending(),
      typingReminder: reminderStatus(settings.typingReminder, Date.now()),
    });
    Menu.buildFromTemplate(
      menuTemplate<BarMenuAction>(rows, (action) => {
        if (action.type === "choose") nextSession.choose(action.change);
        else if (action.type === "save") nextSession.save();
        else typingReminder.snooze(action.choice);
      }),
    ).popup({ window });
  }

  const handleBar = createBarIpcHandler({
    entryUrl: barEntryUrl,
    getView: () => bar.getView(),
    dragStart: () => barWindow.dragStart(),
    drag: (dx, dy) => barWindow.drag(dx, dy),
    dragEnd: () => void barWindow.dragEnd(),
    click: () => {
      // The recorder reports "retrying", which moves the Bar to processing.
      const action = bar.click();
      if (action === "retry") recorder.retryLast();
      // A click on the recording indicator opens the Notetaker page, where Stop is.
      else if (bar.getView().state === "idle" && meetingBadge) openHubPage("notetaker");
      else if (action === "start" || action === "stop") recorder.toggle();
    },
    answer: (choice) => answerBar(choice),
    menu: () => void openBarMenu(),
  });
  const handleRewritePanel = createRewritePanelIpcHandler({
    entryUrl: rewriteEntryUrl,
    controller: rewriteController,
  });
  for (const channel of Object.values(REWRITE_PANEL_CHANNELS)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) =>
      handleRewritePanel(channel, event.senderFrame?.url, args),
    );
  }
  const handleFocusOverlay = createFocusOverlayIpcHandler({
    entryUrl: focusEntryUrl,
    state: () => focusOverlay.state(),
    goBack: () => focus.goBack(),
    pause: () => focus.pause(),
    turnOff: () => focus.stop("user"),
  });
  for (const channel of Object.values(FOCUS_OVERLAY_CHANNELS)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) =>
      handleFocusOverlay(channel, event.senderFrame?.url, args),
    );
  }
  const handleInstructPanel = createInstructPanelIpcHandler({
    entryUrl: instructEntryUrl,
    controller: instructController,
  });
  for (const channel of Object.values(INSTRUCT_PANEL_CHANNELS)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) =>
      handleInstructPanel(channel, event.senderFrame?.url, args),
    );
  }
  ipcMain.handle(BAR_IPC_CHANNELS.ready, (event) =>
    handleBar(BAR_IPC_CHANNELS.ready, event.senderFrame?.url, []),
  );
  for (const channel of [
    BAR_IPC_CHANNELS.dragStart,
    BAR_IPC_CHANNELS.drag,
    BAR_IPC_CHANNELS.dragEnd,
    BAR_IPC_CHANNELS.click,
    BAR_IPC_CHANNELS.answer,
    BAR_IPC_CHANNELS.menu,
  ]) {
    ipcMain.on(channel, (event, ...args: unknown[]) => {
      try {
        handleBar(channel, event.senderFrame?.url, args);
      } catch (error) {
        console.warn(`[bar] ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
}

void app.whenReady().then(() => {
  // HB-24: the weekly summary is checked at start and every hour.
  weeklySummary();
  setInterval(weeklySummary, 60 * 60_000).unref();
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    denyPermissionRequest(permission, callback),
  );
  session.defaultSession.setPermissionCheckHandler(denyPermissionCheck);
  // HB-52: in strict local mode no page may reach the network.
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (details, callback) => callback({ cancel: !networkGuard.allowsUrl(details.url) }),
  );
  importNewRecordings();
  // HB-50: the daily retention job, at start when due and checked every hour.
  runRetention();
  setInterval(runRetention, 60 * 60_000).unref();

  registerIpc();
  // Configures the dictation key whenever the helper becomes ready, restarts included.
  hotkeys.start();
  recorder.start();
  speech.start();
  // NT-05: sleep closes the recording cleanly (ADR-0076); on wake a new one is offered.
  let stoppedBySleep = false;
  powerMonitor.on("suspend", () => {
    const now = meetings?.state();
    if (now?.status !== "recording") return;
    stoppedBySleep = true;
    meetingsStore?.addWarning(now.meetingId, "sleep");
    void meetings?.stop();
  });
  powerMonitor.on("resume", () => {
    if (!stoppedBySleep) return;
    stoppedBySleep = false;
    if (!settingsStore.get().notetaker.resumeAfterSleep) return;
    bar.dispatch({
      type: "ask",
      message: RESUME_QUESTION,
      detail: "Sleep stopped the meeting recording.",
      actions: [
        { answer: "yes", label: "Record again", primary: true },
        { answer: "no", label: "Not now" },
      ],
    });
  });
  // The app works without the helper; its status is shown in the Hub.
  helper.start().then(
    // Read-only: nothing is requested at launch, only the current status is checked.
    () => void permissions.check("launch"),
    (error: unknown) => {
      console.error(
        `[helper] not available: ${error instanceof Error ? error.message : String(error)}`,
      );
      void permissions.check("launch");
    },
  );
  if (isSmokeRun) startSmokeRun();
  else
    void hubState.load().then((saved) => {
      hubSaved = saved;
      // HB-17: setup always shows the Hub; afterwards the setting decides.
      const settings = settingsStore.get();
      if (!hubWindow && (!settings.setupComplete || settings.openHubOnLaunch)) createHubWindow();
    });
  createTray();
  // The Bar never takes focus; it shows itself on the first state push.
  void barWindow.open().then(
    () => barWindow.render(bar.getView()),
    (error: unknown) => console.error(`[bar] could not open: ${String(error)}`),
  );

  app.on("activate", () => {
    // The Bar is always open, so check for the Hub itself.
    if (!hubWindow && !isSmokeRun) createHubWindow();
  });
});

// The app stays in the menu bar when its last window closes.
app.on("window-all-closed", () => {});

// Stop the helper before quitting so no child process outlives the app.
let helperStopped = false;
app.on("before-quit", (event) => {
  void hubState.flush();
  void mcpService?.stop();
  calendarSync?.stop();
  calendarReminders?.stop();
  focus.quit();
  focusOverlay.close();
  if (helperStopped) return;
  event.preventDefault();
  helperStopped = true;
  // A meeting being recorded is closed first, so its last chunk is stored.
  void (meetings?.stop() ?? Promise.resolve(null))
    .catch(() => null)
    .then(() => helper.shutdown("app-quit"))
    .finally(() => app.quit());
});

// Last resort if main exits without going through a clean quit.
process.on("exit", () => helper.terminate());
