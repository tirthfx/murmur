import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  ipcMain,
  screen,
  session,
  shell,
  utilityProcess,
} from "electron";
import {
  BAR_IPC_CHANNELS,
  MEMORY_LIMITS,
  PRESETS,
  REWRITE_PANEL_BINDING_ID,
  REWRITE_PANEL_CHANNELS,
  STYLE_CATEGORIES,
  type StyleCategory,
  EDIT_WATCH_MAX_MS,
  DEFAULT_CLEANUP_MODEL,
  DEFAULT_EMAIL,
  DEFAULT_JARGON_PACKS,
  DEFAULT_DEVELOPER_TOOLS,
  DEFAULT_COMMAND_MODE,
  DEFAULT_INSTRUCT,
  INSTRUCT_PANEL_CHANNELS,
  INSTRUCT_PANEL_PUSH,
  INSTRUCT_PANEL_SIZE,
  type InstructPanelState,
  GENERATION_LIMITS,
  DEFAULT_SOUNDS,
  DEFAULT_SPEECH_MODEL,
  IPC_CHANNELS,
  IPC_EVENTS,
  blockerMessage,
  type DictationBlocker,
  type PermissionKind,
  type PermissionSnapshot,
  type SoundName,
} from "@murmur/shared";
import {
  createNavigationGuard,
  denyPermissionCheck,
  denyPermissionRequest,
  denyWindowOpen,
} from "../security/guards";
import { createHubWindowOptions } from "../security/window-options";
import { createBarController } from "./bar/bar-controller";
import { barEventFor } from "./bar/bar-events";
import { createBarIpcHandler } from "./bar/bar-ipc";
import { BarWindow, barPositionFile } from "./bar/bar-window";
import { createCleanupService } from "./cleanup/cleanup-service";
import { databasePath, openDatabase } from "./db/database";
import { createHistoryStore, type HistoryStore } from "./history/history-store";
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
import { createRewritePanelIpcHandler } from "./rewrites/panel-ipc";
import {
  rewriteBindings,
  rewriteShortcutsInUse,
  setRewriteShortcut,
  withShortcutLabels,
} from "./rewrites/rewrite-shortcuts";
import { createGenerationService } from "./generation/service";
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
import { createLlmClient, type LlmReply } from "./cleanup/llm-client";
import { createConsoleLogger, systemClock } from "./helper/node-runtime";
import { HelperError } from "./helper/types";
import { createHotkeyService } from "./hotkeys";
import { createIpcHandler } from "./ipc";
import { createPermissionsService } from "./permissions";
import {
  appActivator,
  createPlatformHelper,
  defaultHotkeyBindings,
  defaultCommandShortcut,
  defaultInstructShortcut,
  defaultRewriteShortcut,
  keyPlatform,
} from "./platform";
import {
  bindingsFor,
  createSettingsService,
  deviceFor,
  languagesFor,
  wantsLatinHindi,
} from "./settings/settings-service";
import { createSettingsStore } from "./settings/settings-store";
import { createRecorder, type DictationRecord, type RecorderEvent } from "./recorder";
import { createSessionEffects } from "./media/session-effects";
import { createSpeechService } from "./speech/speech-service";
import { checkModel, downloadModel, modelLocation } from "./speech/model-store";
import { createModelDownload } from "./setup/model-download";
import { dictationBlockers, hasPermissionBlocker } from "./setup/readiness";
import { cleanupModelRoot, speechModelRoot } from "./speech/paths";
import { insertionRules } from "./insertion/app-rules";
import { createTypingReminder } from "./reminder/typing-reminder";
import { createMicCheck } from "./mic-check/mic-check";
import { toLatinHindi } from "./speech/latin-hindi";
import { profilePaths } from "./profile";
import { createSmokeRun, SMOKE_PAGE, type SmokeRun } from "./smoke";
import { createSmokeChecks, type SmokeChecks } from "./smoke-checks";
import { permissionSettingsUrl } from "./platform/mac-settings-links";
import { createTrayController, type TrayController } from "./tray/tray-controller";
import { createElectronTray } from "./tray/tray-electron";

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

const helper = createPlatformHelper({
  platform: process.platform,
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
let commandQuestion: { answer: (yes: boolean) => void; timer: NodeJS.Timeout } | null = null;
/** How long a Command Mode question waits before it counts as No. */
const COMMAND_ASK_MS = 60_000;
function askOnBar(message: string, detail: string): Promise<boolean> {
  commandQuestion?.answer(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (commandQuestion?.timer !== timer) return;
      commandQuestion = null;
      bar.dispatch({ type: "answered" });
      resolve(false);
    }, COMMAND_ASK_MS);
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
function answerBar(choice: "yes" | "no"): void {
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
const history: HistoryStore | null = database
  ? createHistoryStore(database, path.join(profile.appData, "Murmur", "audio"))
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

const platformDefaults = defaultHotkeyBindings(process.platform);
const settingsStore = createSettingsStore(database, {
  holdShortcut:
    platformDefaults[0]?.trigger.type === "key"
      ? platformDefaults[0].trigger
      : { type: "key", keyCode: 61, modifiers: [] },
  handsFreeShortcut: null,
  rewriteShortcut: defaultRewriteShortcut(process.platform),
  commandShortcut: defaultCommandShortcut(process.platform),
  commandMode: DEFAULT_COMMAND_MODE,
  instructShortcut: defaultInstructShortcut(process.platform),
  instruct: DEFAULT_INSTRUCT,
  inputDevice: "auto",
  languages: [],
  cleanupLevel: "standard",
  sounds: DEFAULT_SOUNDS,
  muteWhileDictating: false,
  setupComplete: false,
  pressEnterCommand: true,
  contextAwareness: true,
  mouseButtons: { hold: null, handsFree: null },
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
  },
});
const keys = keyPlatform(process.platform);
const settingsService = createSettingsService({
  store: settingsStore,
  platform: keys,
  listDevices: () => helper.listAudioDevices(),
  otherShortcuts: () => rewriteShortcutsInUse(rewrites?.list() ?? []),
});
const bindingsNow = () =>
  platformDefaults.length > 0
    ? [
        ...bindingsFor(settingsStore.get(), keys.cancelKeyCode),
        ...rewriteBindings(rewrites?.list() ?? []),
      ]
    : [];

const hotkeys = createHotkeyService({
  helper,
  bindings: bindingsNow(),
  logger: createConsoleLogger("[hotkeys]"),
});
// New shortcuts reach the helper at once; no restart.
const refreshBindings = () => hotkeys.setBindings(bindingsNow());
settingsStore.onChange(refreshBindings);
permissions.onChecked((statuses) => hotkeys.handlePermissions(statuses));

const speech = createSpeechService({
  helper,
  model: DEFAULT_SPEECH_MODEL,
  root: speechModelRoot(profile.modelsAppData),
  logger: createConsoleLogger("[speech]"),
  languages: () => languagesFor(settingsStore.get()),
});

// First-run setup: the model download behind the setup screen, and what blocks dictation.
const modelDownload = createModelDownload({
  model: DEFAULT_SPEECH_MODEL,
  download: (onProgress) =>
    downloadModel(speechModelRoot(profile.modelsAppData), DEFAULT_SPEECH_MODEL, { onProgress }),
  speechState: () => speech.getState(),
  onDownloaded: () => speech.recheck(),
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
async function dictationBlocked(): Promise<string | null> {
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
  positionFile: barPositionFile(profile.userData),
  displays: () => screen.getAllDisplays().map(displayArea),
  primaryDisplay: () => displayArea(screen.getPrimaryDisplay()),
  logger: createConsoleLogger("[bar]"),
});
const bar = createBarController(barWindow, systemClock);
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
    barWindow.sound(name);
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
  level: () => settingsStore.get().cleanupLevel,
});
// The microphone for a session. In Auto: a real microphone over a virtual one, and not the
// built-in one while the lid is closed (roadmap M2 epic 7). Asked at each start.
let lastAutoChoice: string | null = null;
async function inputDevice(): Promise<string | null> {
  const chosen = deviceFor(settingsStore.get());
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

const recorder = createRecorder({
  helper,
  logger: createConsoleLogger("[audio]"),
  newSessionId: randomUUID,
  transcribe: (file, { prompt }) => {
    if (smokeFailNextTranscription) {
      smokeFailNextTranscription = false;
      return Promise.reject(
        new HelperError("TRANSCRIPTION_FAILED", "failed on purpose by the smoke test"),
      );
    }
    return speech.transcribe(file, prompt);
  },
  readContext: async () => {
    // With context awareness off, only the app and its window are asked for (for the style);
    // no text around the caret. Without Accessibility there is no context at all.
    const on = settingsStore.get().contextAwareness;
    const context = await helper
      .focusContext(on ? {} : { maxBefore: 0, maxAfter: 0 })
      .catch(() => null);
    smokeChecks?.handleContext(context);
    // File tags: index the editor's workspace while the owner speaks.
    if (context) {
      void workspaceFor(context).then((root) => {
        if (root) void workspaceIndexer.prepare(root);
      });
    }
    return context;
  },
  useContextText: () => settingsStore.get().contextAwareness,
  logTranscripts: process.env.MURMUR_LOG_TRANSCRIPTS === "1",
  insert: (text, { pressEnter, html }) => {
    // During a smoke run text may only go into the test box.
    smoke?.assertFieldFocused();
    return helper.insertText({
      text,
      method: "auto",
      restoreClipboard: true,
      restoreDelayMs: 350,
      pressEnter,
      ...(html ? { html } : {}),
      ...insertionRules(),
    });
  },
  pressEnterCommand: () => settingsStore.get().pressEnterCommand,
  copy: (text) => helper.copyText(text),
  onEvent: (event) => {
    bar.dispatch(barEventFor(event));
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
  clean: (text, options) => cleanup.clean(text, options),
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
    const id = history?.add(dictation) ?? null;
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
  deviceId: () => inputDevice(),
  whisperMode: () => settingsStore.get().whisperMode,
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
  ...(dictionary ? { dictionary } : {}),
  ...(snippets ? { snippets } : {}),
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
  rewriteText: (text) => (wantsLatinHindi(settingsStore.get()) ? toLatinHindi(text) : text),
  // Command Mode (RW-08, experimental). The runner below exists before any recording ends.
  command: {
    enabled: () => settingsStore.get().experimental.commandMode,
    wakePhrase: () => {
      const options = settingsStore.get().commandMode;
      return options.wakePhraseEnabled ? options.wakePhrase : null;
    },
    run: (phrase, trigger) => commandRunner.run(phrase, trigger),
  },
  // Instruct Mode (RW-11). The controller below exists before any recording ends.
  instruct: { run: (instruction) => instructController.spoken(instruction) },
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
const activateApp = appActivator(process.platform);
const rewriteController = createRewriteController({
  helper,
  rewrites: rewrites ?? { enabled: () => [], get: () => null, markUsed: () => {} },
  runs: rewriteRuns,
  generation,
  panel: rewritePanel,
  notify: (message) => bar.dispatch({ type: "warn", message }),
  activateApp,
  context: (appId, text) => rewriteContext(appId, text),
  // Web editors (Google Docs and the like) report the wrong selection through Accessibility.
  clipboardFirstInApps: () => [...BROWSERS],
  insertRules: () => insertionRules(),
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
  rewrites: rewrites ?? { list: () => [], markUsed: () => {} },
  generation,
  context: rewriteContext,
  runs: rewriteRuns,
  logger: createConsoleLogger("[rewrite]"),
});
// Instruct Mode (RW-11, RW-17): drafts from a spoken instruction, with the allowed context.
const instructThreads = database ? createInstructThreadStore(database) : null;
const instructController = createInstructController({
  helper,
  generation,
  panel: instructPanel,
  threads: instructThreads,
  modelId: () => DEFAULT_CLEANUP_MODEL.id,
  notify: (message) => bar.dispatch({ type: "warn", message }),
  activateApp,
  context: (appId, text) => rewriteContext(appId, text),
  settings: () => {
    const settings = settingsStore.get();
    return { instruct: settings.instruct, contextAwareness: settings.contextAwareness };
  },
  clipboardFirstInApps: () => [...BROWSERS],
  insertRules: () => insertionRules(),
  logger: createConsoleLogger("[instruct]"),
});
// Command Mode (RW-08, RW-09): rules first, then the model may pick a command id.
const commandLogger = createConsoleLogger("[command]");
const commandRunner = createCommandRunner({
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
  clipboardFirstInApps: () => [...BROWSERS],
  insertRules: () => insertionRules(),
  logger: commandLogger,
});
// Source text of old runs is cut to 200 characters after 7 days.
const trimRewriteRuns = () => {
  try {
    const trimmed = (rewriteRuns?.trimOld() ?? 0) + (commandRuns?.trimOld() ?? 0);
    if (trimmed > 0) console.log(`[rewrite] trimmed ${trimmed} old runs`);
    // Instruct threads (RW-14): text gone after 30 days, counts kept; at most 1,000 threads.
    const threads = instructThreads?.applyRetention();
    if (threads && threads.textRemoved + threads.deleted > 0) {
      console.log(
        `[instruct] removed the text of ${threads.textRemoved} threads, deleted ${threads.deleted}`,
      );
    }
  } catch (error) {
    console.warn(`[rewrite] could not trim old runs: ${String(error)}`);
  }
};
trimRewriteRuns();
setInterval(trimRewriteRuns, 24 * 60 * 60_000).unref();

hotkeys.onEvent((event) => {
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
    lastTranscript: () => history?.lastText() ?? null,
    toggleDictation: () => recorder.toggle(),
    canRetry: () => recorder.canRetry(),
    retryLast: () => void recorder.retryLast(),
    snoozeReminder: (choice) => typingReminder.snooze(choice),
    copy: (text) => clipboard.writeText(text),
    quit: () => app.quit(),
  });
  tray = controller;
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
  const url = process.platform === "darwin" ? permissionSettingsUrl(kind) : null;
  if (url === null) {
    throw new Error("No System Settings pane is known for this permission on this platform");
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
  if (reached !== null) {
    console.log(`[voice] milestone: ${reached} words`);
    bar.dispatch({ type: "warn", message: `${reached.toLocaleString("en")} words dictated` });
    effects.sound("success");
    return;
  }
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

function createHubWindow(): BrowserWindow {
  const window = new BrowserWindow(
    createHubWindowOptions({
      preloadPath: path.join(__dirname, "preload.cjs"),
      platform: process.platform,
      isDevelopment,
    }),
  );
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (hubWindow === window) hubWindow = null;
  });
  void window.loadURL(hubEntryUrl);
  hubWindow = window;
  return window;
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
    rewritesSave: (input) =>
      rewrites?.save(input) ?? {
        ok: false,
        reason: "not-found",
        message: "Rewrites could not be opened.",
      },
    rewritesSetEnabled: (id, enabled) => {
      rewrites?.setEnabled(id, enabled);
      refreshBindings();
    },
    rewritesSetShortcut: (id, key) => {
      if (!rewrites) return { ok: false, message: "Rewrites could not be opened." };
      const result = setRewriteShortcut(
        { store: rewrites, settings: () => settingsStore.get(), platform: keys },
        id,
        key,
      );
      if (result.ok) refreshBindings();
      return result;
    },
    rewritesSetApplyDirectly: (id, applyDirectly) => rewrites?.setApplyDirectly(id, applyDirectly),
    rewritesSetAutoApply: (id, settings) => rewrites?.setAutoApply(id, settings),
    instructThreads: (query) => instructThreads?.list(query) ?? [],
    instructThread: (id) => instructThreads?.get(id) ?? null,
    instructDelete: (id) => instructThreads?.delete(id),
    instructDeleteAll: () => instructThreads?.deleteAll(),
    instructReuse: (id) => instructController.reuse(id),
    rewritesMove: (id, step) => rewrites?.move(id, step),
    rewritesDuplicate: (id) =>
      rewrites?.duplicate(id) ?? {
        ok: false,
        reason: "not-found",
        message: "Rewrites could not be opened.",
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

  const handleBar = createBarIpcHandler({
    entryUrl: barEntryUrl,
    getView: () => bar.getView(),
    dragStart: () => barWindow.dragStart(),
    drag: (dx, dy) => barWindow.drag(dx, dy),
    dragEnd: () => void barWindow.dragEnd(),
    click: () => {
      // The recorder reports "retrying", which moves the Bar to processing.
      if (bar.click() === "retry") recorder.retryLast();
    },
    answer: (choice) => answerBar(choice),
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
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    denyPermissionRequest(permission, callback),
  );
  session.defaultSession.setPermissionCheckHandler(denyPermissionCheck);

  registerIpc();
  // Configures the dictation key whenever the helper becomes ready, restarts included.
  hotkeys.start();
  recorder.start();
  speech.start();
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
  else createHubWindow();
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Stop the helper before quitting so no child process outlives the app.
let helperStopped = false;
app.on("before-quit", (event) => {
  if (helperStopped) return;
  event.preventDefault();
  helperStopped = true;
  void helper.shutdown("app-quit").finally(() => app.quit());
});

// Last resort if main exits without going through a clean quit.
process.on("exit", () => helper.terminate());
