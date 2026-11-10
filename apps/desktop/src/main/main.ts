import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, session } from "electron";
import { IPC_CHANNELS } from "@murmur/shared";
import {
  createNavigationGuard,
  denyPermissionCheck,
  denyPermissionRequest,
  denyWindowOpen,
} from "../security/guards";
import { createHubWindowOptions } from "../security/window-options";
import { createIpcHandler } from "./ipc";

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
