import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  screen,
  session,
  shell,
  utilityProcess,
} from "electron";
import {
  BAR_IPC_CHANNELS,
  DEFAULT_CLEANUP_MODEL,
  DEFAULT_SOUNDS,
  DEFAULT_SPEECH_MODEL,
  IPC_CHANNELS,
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
import { createLlmClient, type LlmReply } from "./cleanup/llm-client";
import { createConsoleLogger, systemClock } from "./helper/node-runtime";
import { createHotkeyService } from "./hotkeys";
import { createIpcHandler } from "./ipc";
import { createPermissionsService } from "./permissions";
import { createPlatformHelper, defaultHotkeyBindings, keyPlatform } from "./platform";
import {
  bindingsFor,
  createSettingsService,
  deviceFor,
  languagesFor,
} from "./settings/settings-service";
import { createSettingsStore } from "./settings/settings-store";
import { createRecorder, type RecorderEvent } from "./recorder";
import { createSessionEffects } from "./media/session-effects";
import { createSpeechService } from "./speech/speech-service";
import { checkModel, downloadModel, modelLocation } from "./speech/model-store";
import { createModelDownload } from "./setup/model-download";
import { dictationBlockers, hasPermissionBlocker } from "./setup/readiness";
import { cleanupModelRoot, speechModelRoot } from "./speech/paths";
import { insertionRules } from "./insertion/app-rules";
import { profilePaths } from "./profile";
import { createSmokeRun, SMOKE_PAGE, type SmokeRun } from "./smoke";
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
const history: HistoryStore | null = database
  ? createHistoryStore(database, path.join(profile.appData, "Murmur", "audio"))
  : null;

const platformDefaults = defaultHotkeyBindings(process.platform);
const settingsStore = createSettingsStore(database, {
  holdShortcut: platformDefaults[0]?.trigger ?? { type: "key", keyCode: 61, modifiers: [] },
  handsFreeShortcut: null,
  inputDevice: "auto",
  language: "auto",
  cleanupLevel: "standard",
  sounds: DEFAULT_SOUNDS,
  muteWhileDictating: false,
  setupComplete: false,
  pressEnterCommand: true,
  contextAwareness: true,
});
const keys = keyPlatform(process.platform);
const settingsService = createSettingsService({
  store: settingsStore,
  platform: keys,
  listDevices: () => helper.listAudioDevices(),
});
const bindingsNow = () =>
  platformDefaults.length > 0 ? bindingsFor(settingsStore.get(), keys.cancelKeyCode) : [];

const hotkeys = createHotkeyService({
  helper,
  bindings: bindingsNow(),
  logger: createConsoleLogger("[hotkeys]"),
});
// New shortcuts reach the helper at once; no restart.
settingsStore.onChange(() => hotkeys.setBindings(bindingsNow()));
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

// Sounds and output mute around each recording. The marker file exists only while Murmur
// holds the output muted, so a crash leaves a note for the next launch to undo.
const muteMarker = path.join(profile.userData, "output-muted-by-murmur.json");
const effects = createSessionEffects({
  settings: () => settingsStore.get(),
  playSound: (name) => barWindow.sound(name),
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
const cleanup = createCleanupService({
  llm: createLlmClient({
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
  }),
  // Every byte is checked once per run (about 2 s for 2.5 GB), then remembered.
  modelReady: () => {
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
  },
  logger: cleanupLogger,
  level: () => settingsStore.get().cleanupLevel,
});

const recorder = createRecorder({
  helper,
  logger: createConsoleLogger("[audio]"),
  newSessionId: randomUUID,
  transcribe: (file, { prompt }) => speech.transcribe(file, prompt),
  readContext: async () => {
    if (!settingsStore.get().contextAwareness) return null;
    // Without Accessibility there is no context, and nothing is asked for.
    return helper.focusContext().catch(() => null);
  },
  logTranscripts: process.env.MURMUR_LOG_TRANSCRIPTS === "1",
  insert: (text, { pressEnter }) => {
    // During a smoke run text may only go into the test box.
    smoke?.assertFieldFocused();
    return helper.insertText({
      text,
      method: "auto",
      restoreClipboard: true,
      restoreDelayMs: 350,
      pressEnter,
      ...insertionRules(),
    });
  },
  pressEnterCommand: () => settingsStore.get().pressEnterCommand,
  copy: (text) => helper.copyText(text),
  onEvent: (event) => {
    bar.dispatch(barEventFor(event));
    tray?.handleRecorderEvent(event);
    smoke?.handleRecorderEvent(event);
    const sound = SOUND_FOR[event.type];
    if (sound) effects.sound(sound);
  },
  blocked: dictationBlocked,
  beforeStart: () => effects.beforeStart(),
  afterEnd: () => effects.afterEnd(),
  clean: (text, { terms }) => cleanup.clean(text, { terms }),
  prepareCleanup: () => cleanup.prepare(),
  record: (dictation) => history?.add(dictation) ?? null,
  deviceId: () => deviceFor(settingsStore.get()),
});
hotkeys.onEvent((event) => recorder.handleHotkey(event));
helper.onAudioLevel((level) => bar.level(level.rmsDb));

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
  void controller.refreshDevices();
}

// The end-to-end smoke run (MURMUR_SMOKE=1, started by `npm run smoke`): a test window takes
// the place of the Hub, the app presses its own dictation key, and the result is printed.
const isSmokeRun = process.env.MURMUR_SMOKE === "1";
let smoke: SmokeRun | null = null;
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
    .then((result) => {
      console.log(`[smoke] result ${JSON.stringify(result)}`);
      process.exitCode = result.ok ? 0 : 1;
      app.quit();
    });
}

async function openPermissionSettings(kind: PermissionKind): Promise<void> {
  const url = process.platform === "darwin" ? permissionSettingsUrl(kind) : null;
  if (url === null) {
    throw new Error("No System Settings pane is known for this permission on this platform");
  }
  await shell.openExternal(url);
}

let hubWindow: BrowserWindow | null = null;

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
      if (bar.click() === "retry" && recorder.retryLast()) bar.dispatch({ type: "retry" });
    },
  });
  ipcMain.handle(BAR_IPC_CHANNELS.ready, (event) =>
    handleBar(BAR_IPC_CHANNELS.ready, event.senderFrame?.url, []),
  );
  for (const channel of [
    BAR_IPC_CHANNELS.dragStart,
    BAR_IPC_CHANNELS.drag,
    BAR_IPC_CHANNELS.dragEnd,
    BAR_IPC_CHANNELS.click,
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
