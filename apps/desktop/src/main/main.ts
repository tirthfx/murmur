import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import { DEFAULT_SPEECH_MODEL, IPC_CHANNELS, type PermissionKind } from "@murmur/shared";
import {
  createNavigationGuard,
  denyPermissionCheck,
  denyPermissionRequest,
  denyWindowOpen,
} from "../security/guards";
import { createHubWindowOptions } from "../security/window-options";
import { createConsoleLogger } from "./helper/node-runtime";
import { createHotkeyService } from "./hotkeys";
import { createIpcHandler } from "./ipc";
import { createPermissionsService } from "./permissions";
import { createPlatformHelper, defaultHotkeyBindings } from "./platform";
import { createRecorder } from "./recorder";
import { createSpeechService } from "./speech/speech-service";
import { speechModelRoot } from "./speech/paths";
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

const hotkeys = createHotkeyService({
  helper,
  bindings: defaultHotkeyBindings(process.platform),
  logger: createConsoleLogger("[hotkeys]"),
});
permissions.onChecked((statuses) => hotkeys.handlePermissions(statuses));

const speech = createSpeechService({
  helper,
  model: DEFAULT_SPEECH_MODEL,
  root: speechModelRoot(app.getPath("appData")),
  logger: createConsoleLogger("[speech]"),
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
});
hotkeys.onEvent((event) => recorder.handleHotkey(event));

async function openPermissionSettings(kind: PermissionKind): Promise<void> {
  const url = process.platform === "darwin" ? permissionSettingsUrl(kind) : null;
  if (url === null) {
    throw new Error("No System Settings pane is known for this permission on this platform");
  }
  await shell.openExternal(url);
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
  void window.loadURL(hubEntryUrl);
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
  });
  for (const channel of Object.values(IPC_CHANNELS)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => handle(channel, event, args));
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

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createHubWindow();
    }
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
