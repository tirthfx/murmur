import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";
import { FOCUS_OVERLAY_PUSH, type FocusOverlayState } from "@murmur/shared";
import type { Rect } from "../bar/bar-position";
import type { Logger } from "../helper/types";

export function createOverlayWindowOptions(input: {
  preloadPath: string;
  isDevelopment: boolean;
  bounds: Rect;
}): BrowserWindowConstructorOptions {
  return {
    ...input.bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    title: "Murmur Focus",
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: input.isDevelopment,
    },
  };
}

export interface FocusOverlayDeps {
  create: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  preloadPath: string;
  entryUrl: string;
  isDevelopment: boolean;
  /** The whole display the pointer is on: the overlay covers it. */
  displayBounds: () => Rect;
  logger: Logger;
}

/**
 * The Focus overlay window (RW-21): borderless, above everything (screen-saver level), on
 * every Space, covering the display the pointer is on. It takes the keyboard so nothing is
 * typed into the blocked app; Murmur's own shortcuts still work through the helper.
 */
export class FocusOverlayWindow {
  private window: BrowserWindow | null = null;
  private loading: Promise<void> | null = null;
  private latest: FocusOverlayState = { stage: "hidden" };

  constructor(private readonly deps: FocusOverlayDeps) {}

  private ensure(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = this.deps.create(
      createOverlayWindowOptions({
        preloadPath: this.deps.preloadPath,
        isDevelopment: this.deps.isDevelopment,
        bounds: this.deps.displayBounds(),
      }),
    );
    window.setAlwaysOnTop(true, "screen-saver");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.on("closed", () => {
      this.window = null;
      this.loading = null;
    });
    this.window = window;
    this.loading = window.loadURL(this.deps.entryUrl).catch((error: unknown) => {
      this.deps.logger.warn(`the Focus overlay did not load: ${String(error)}`);
    });
    return window;
  }

  isOverlaySender(senderId: number): boolean {
    return (
      this.window !== null && !this.window.isDestroyed() && this.window.webContents.id === senderId
    );
  }

  state(): FocusOverlayState {
    return this.latest;
  }

  show(name: string): void {
    this.latest = { stage: "blocked", name };
    const window = this.ensure();
    window.setBounds(this.deps.displayBounds());
    void (this.loading ?? Promise.resolve()).then(() => {
      if (window.isDestroyed() || this.latest.stage === "hidden") return;
      window.webContents.send(FOCUS_OVERLAY_PUSH.state, this.latest);
      window.show();
      window.focus();
    });
  }

  hide(): void {
    this.latest = { stage: "hidden" };
    const window = this.window;
    if (window && !window.isDestroyed()) {
      window.webContents.send(FOCUS_OVERLAY_PUSH.state, this.latest);
      window.hide();
    }
  }

  close(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
}
