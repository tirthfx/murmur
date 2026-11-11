import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";
import { BAR_PUSH_CHANNELS, type BarView, type SoundName } from "@murmur/shared";
import type { Logger } from "../helper/types";
import type { BarPort } from "./bar-controller";
import {
  BAR_HEIGHT,
  BAR_WIDTH,
  parseSaved,
  restorePosition,
  toSaved,
  type DisplayArea,
} from "./bar-position";

export interface BarWindowOptionsInput {
  preloadPath: string;
  isDevelopment: boolean;
  x: number;
  y: number;
}

/**
 * The Bar never takes keyboard focus: a non-activating panel that cannot become key, shown
 * without activating the app, so the app the user is typing in stays in front.
 * The web preferences match the Hub's locked-down defaults.
 */
export function createBarWindowOptions(
  input: BarWindowOptionsInput,
): BrowserWindowConstructorOptions {
  return {
    x: input.x,
    y: input.y,
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    show: false,
    type: "panel",
    focusable: false,
    acceptFirstMouse: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: "Murmur Bar",
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

export interface BarWindowDeps {
  create: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  preloadPath: string;
  entryUrl: string;
  isDevelopment: boolean;
  positionFile: string;
  displays: () => DisplayArea[];
  primaryDisplay: () => DisplayArea;
  logger: Logger;
}

/** The Bar's window: shows views without taking focus, follows drags, remembers its spot. */
export class BarWindow implements BarPort {
  private window: BrowserWindow | null = null;
  private dragOrigin: [number, number] | null = null;

  constructor(private readonly deps: BarWindowDeps) {}

  async open(): Promise<void> {
    let saved = null;
    try {
      saved = parseSaved(JSON.parse(await readFile(this.deps.positionFile, "utf8")));
    } catch {
      // No saved position yet.
    }
    const { x, y } = restorePosition(saved, this.deps.displays(), this.deps.primaryDisplay());
    const window = this.deps.create(
      createBarWindowOptions({
        preloadPath: this.deps.preloadPath,
        isDevelopment: this.deps.isDevelopment,
        x,
        y,
      }),
    );
    window.setAlwaysOnTop(true, "floating");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    window.on("closed", () => {
      this.window = null;
    });
    this.window = window;
    await window.loadURL(this.deps.entryUrl);
  }

  isBarSender(senderId: number): boolean {
    return this.window !== null && this.window.webContents.id === senderId;
  }

  render(view: BarView): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    window.webContents.send(BAR_PUSH_CHANNELS.view, view);
    if (view.state === "hidden") window.hide();
    else if (!window.isVisible()) window.showInactive();
  }

  level(rmsDb: number): void {
    const window = this.window;
    if (window && !window.isDestroyed()) window.webContents.send(BAR_PUSH_CHANNELS.level, rmsDb);
  }

  sound(name: SoundName): void {
    const window = this.window;
    if (window && !window.isDestroyed()) window.webContents.send(BAR_PUSH_CHANNELS.sound, name);
  }

  dragStart(): void {
    const position = this.window?.getPosition();
    this.dragOrigin = position ? [position[0]!, position[1]!] : null;
  }

  drag(dx: number, dy: number): void {
    if (!this.window || !this.dragOrigin) return;
    this.window.setPosition(
      Math.round(this.dragOrigin[0] + dx),
      Math.round(this.dragOrigin[1] + dy),
    );
  }

  async dragEnd(): Promise<void> {
    this.dragOrigin = null;
    const position = this.window?.getPosition();
    if (!position) return;
    const saved = toSaved({ x: position[0]!, y: position[1]! }, this.deps.displays());
    if (!saved) return;
    try {
      await writeFile(this.deps.positionFile, JSON.stringify(saved));
    } catch (error) {
      this.deps.logger.warn(`could not save the Bar position: ${String(error)}`);
    }
  }

  /** Where the Bar is, or null when it is not open. */
  position(): [number, number] | null {
    const position = this.window?.getPosition();
    return position ? [position[0]!, position[1]!] : null;
  }

  close(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
}

export function barPositionFile(userData: string): string {
  return path.join(userData, "bar-position.json");
}
