import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, screen, session, shell, utilityProcess } from "electron";
import {
  BAR_IPC_CHANNELS,
  DEFAULT_CLEANUP_MODEL,
  DEFAULT_SPEECH_MODEL,
  IPC_CHANNELS,
  type PermissionKind,
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
import { createRecorder } from "./recorder";
import { createSpeechService } from "./speech/speech-service";
import { checkModel, modelLocation } from "./speech/model-store";
import { cleanupModelRoot, speechModelRoot } from "./speech/paths";
import { permissionSettingsUrl } from "./platform/mac-settings-links";

const isDevelopment = !app.isPackaged;

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
    return openDatabase(databasePath(app.getPath("appData")));
  } catch (error) {
    console.error(
      `[db] database could not open: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
const database = openMurmurDatabase();
const history: HistoryStore | null = database
  ? createHistoryStore(database, path.join(app.getPath("appData"), "Murmur", "audio"))
  : null;

const platformDefaults = defaultHotkeyBindings(process.platform);
const settingsStore = createSettingsStore(database, {
  holdShortcut: platformDefaults[0]?.trigger ?? { type: "key", keyCode: 61, modifiers: [] },
  handsFreeShortcut: null,
  inputDevice: "auto",
  language: "auto",
  cleanupLevel: "standard",
});
const settingsService = createSettingsService({
  store: settingsStore,
  platform: keyPlatform(process.platform),
  listDevices: () => helper.listAudioDevices(),
});
const bindingsNow = () => (platformDefaults.length > 0 ? bindingsFor(settingsStore.get()) : []);

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
  root: speechModelRoot(app.getPath("appData")),
  logger: createConsoleLogger("[speech]"),
  languages: () => languagesFor(settingsStore.get()),
});

const displayArea = (display: Electron.Display) => ({ id: display.id, workArea: display.workArea });
const barWindow = new BarWindow({
  create: (options) => new BrowserWindow(options),
  preloadPath: path.join(__dirname, "bar-preload.cjs"),
  entryUrl: barEntryUrl,
  isDevelopment,
  positionFile: barPositionFile(app.getPath("userData")),
  displays: () => screen.getAllDisplays().map(displayArea),
  primaryDisplay: () => displayArea(screen.getPrimaryDisplay()),
  logger: createConsoleLogger("[bar]"),
});
const bar = createBarController(barWindow, systemClock);

const cleanupRoot = cleanupModelRoot(app.getPath("appData"));
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
  transcribe: (file) => speech.transcribe(file),
  logTranscripts: process.env.MURMUR_LOG_TRANSCRIPTS === "1",
  insert: (text) =>
    helper.insertText({ text, method: "auto", restoreClipboard: true, restoreDelayMs: 350 }),
  copy: (text) => helper.copyText(text),
  onEvent: (event) => bar.dispatch(barEventFor(event)),
  clean: (text) => cleanup.clean(text),
  prepareCleanup: () => cleanup.prepare(),
  record: (dictation) => history?.add(dictation) ?? null,
  deviceId: () => deviceFor(settingsStore.get()),
});
hotkeys.onEvent((event) => recorder.handleHotkey(event));
helper.onAudioLevel((level) => bar.level(level.rmsDb));

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
  createHubWindow();
  // The Bar never takes focus; it shows itself on the first state push.
  void barWindow.open().then(
    () => barWindow.render(bar.getView()),
    (error: unknown) => console.error(`[bar] could not open: ${String(error)}`),
  );

  app.on("activate", () => {
    // The Bar is always open, so check for the Hub itself.
    if (!hubWindow) createHubWindow();
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
