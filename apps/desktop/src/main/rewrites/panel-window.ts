import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";
import { REWRITE_PANEL_PUSH, REWRITE_PANEL_SIZE, type RewritePanelState } from "@murmur/shared";
import { BAR_HEIGHT, BAR_WIDTH, type Rect } from "../bar/bar-position";
import type { Logger } from "../helper/types";
import type { RewritePanelPort } from "./rewrite-controller";

const GAP = 8;

/**
 * Above the Bar, centred on it; below it when there is no room above. Always inside the work
 * area. Without a Bar, centred low on the screen.
 */
export function panelPosition(
  bar: [number, number] | null,
  area: Rect,
  size: { width: number; height: number } = REWRITE_PANEL_SIZE,
): { x: number; y: number } {
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  const maxX = area.x + area.width - size.width;
  const maxY = area.y + area.height - size.height;
  if (!bar) {
    return {
      x: Math.round(area.x + (area.width - size.width) / 2),
      y: Math.round(clamp(area.y + area.height * 0.6 - size.height / 2, area.y, maxY)),
    };
  }
  const x = clamp(Math.round(bar[0] + BAR_WIDTH / 2 - size.width / 2), area.x, maxX);
  const above = bar[1] - GAP - size.height;
  const y = above >= area.y ? above : clamp(bar[1] + BAR_HEIGHT + GAP, area.y, maxY);
  return { x, y };
}

export function createPanelWindowOptions(input: {
  preloadPath: string;
  isDevelopment: boolean;
  x: number;
  y: number;
}): BrowserWindowConstructorOptions {
  return {
    x: input.x,
    y: input.y,
    width: REWRITE_PANEL_SIZE.width,
    height: REWRITE_PANEL_SIZE.height,
    show: false,
    // A floating panel that takes typing for the filter; the app is given the keyboard back
    // when the panel closes (see the controller).
    type: "panel",
    focusable: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: "Murmur Rewrite",
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

export interface PanelWindowDeps {
  create: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  preloadPath: string;
  entryUrl: string;
  isDevelopment: boolean;
  /** Where the Bar is, if it is open. */
  barPosition: () => [number, number] | null;
  /** The work area of the display at a point (the Bar's), or the primary one. */
  workArea: (point: [number, number] | null) => Rect;
  logger: Logger;
}

/** The Rewrite panel's window: created once, moved next to the Bar each time it opens. */
export class RewritePanelWindow implements RewritePanelPort {
  private window: BrowserWindow | null = null;
  private loading: Promise<void> | null = null;
  private latest: RewritePanelState = { stage: "hidden" };

  constructor(private readonly deps: PanelWindowDeps) {}

  private ensure(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const bar = this.deps.barPosition();
    const { x, y } = panelPosition(bar, this.deps.workArea(bar));
    const window = this.deps.create(
      createPanelWindowOptions({
        preloadPath: this.deps.preloadPath,
        isDevelopment: this.deps.isDevelopment,
        x,
        y,
      }),
    );
    window.setAlwaysOnTop(true, "floating");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.on("closed", () => {
      this.window = null;
      this.loading = null;
    });
    this.window = window;
    this.loading = window.loadURL(this.deps.entryUrl).catch((error: unknown) => {
      this.deps.logger.warn(`the Rewrite panel did not load: ${String(error)}`);
    });
    return window;
  }

  isPanelSender(senderId: number): boolean {
    return (
      this.window !== null && !this.window.isDestroyed() && this.window.webContents.id === senderId
    );
  }

  show(state: RewritePanelState): void {
    this.latest = state;
    const window = this.ensure();
    const bar = this.deps.barPosition();
    const { x, y } = panelPosition(bar, this.deps.workArea(bar));
    window.setPosition(x, y);
    void (this.loading ?? Promise.resolve()).then(() => {
      if (window.isDestroyed()) return;
      window.webContents.send(REWRITE_PANEL_PUSH.state, this.latest);
      window.show();
      window.focus();
    });
  }

  update(state: RewritePanelState): void {
    this.latest = state;
    const window = this.window;
    if (window && !window.isDestroyed()) window.webContents.send(REWRITE_PANEL_PUSH.state, state);
  }

  hide(): void {
    this.latest = { stage: "hidden" };
    const window = this.window;
    if (window && !window.isDestroyed()) {
      window.webContents.send(REWRITE_PANEL_PUSH.state, this.latest);
      window.hide();
    }
  }

  close(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
}
