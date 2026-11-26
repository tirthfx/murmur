import {
  DEFAULT_SPEECH_MODEL,
  WINDOWS_SPEECH_MODEL,
  type HotkeyBinding,
  type HotkeyTrigger,
  type MatcherOs,
  type PermissionKind,
  type PlatformHelper,
  type SpeechModel,
} from "@murmur/shared";
import path from "node:path";
import { convertMacImageToPng } from "./mac-image";
import { createConsoleLogger, spawnHelperProcess, systemClock } from "../helper/node-runtime";
import { HelperSupervisor } from "../helper/supervisor";
import { createMacHelper, type MacHelperDeps } from "./mac-helper";
import { createWindowsHelper } from "./windows-helper";
import type { KeyPlatform } from "../settings/shortcuts";
import {
  MAC_DEFAULT_COMMAND_TRIGGER,
  MAC_DEFAULT_FOCUS_TRIGGER,
  MAC_DEFAULT_SCRATCHPAD_TRIGGER,
  MAC_DEFAULT_HOTKEY_BINDINGS,
  MAC_DEFAULT_INSTRUCT_TRIGGER,
  MAC_DEFAULT_REWRITE_TRIGGER,
} from "./mac-hotkeys";
import { activateMacApp } from "./mac-apps";
import {
  WINDOWS_DEFAULT_COMMAND_TRIGGER,
  WINDOWS_DEFAULT_FOCUS_TRIGGER,
  WINDOWS_DEFAULT_HOTKEY_BINDINGS,
  WINDOWS_DEFAULT_INSTRUCT_TRIGGER,
  WINDOWS_DEFAULT_REWRITE_TRIGGER,
  WINDOWS_DEFAULT_SCRATCHPAD_TRIGGER,
  WINDOWS_KEY_ESCAPE,
} from "./windows-hotkeys";
import {
  WINDOWS_CAPS_LOCK,
  WINDOWS_FUNCTION_KEYS,
  WINDOWS_MODIFIER_KEYS,
  WINDOWS_RESERVED,
  windowsKeyCode,
  windowsTriggerLabel,
} from "./windows-keymap";
import { permissionSettingsUrl } from "./mac-settings-links";
import {
  MAC_CAPS_LOCK,
  MAC_FUNCTION_KEYS,
  MAC_MODIFIER_KEYS,
  MAC_RESERVED,
  macKeyCode,
  macTriggerLabel,
} from "./mac-keymap";

/** Key codes, names and reserved shortcuts for this OS. */
export function keyPlatform(platform: NodeJS.Platform): KeyPlatform {
  if (platform === "darwin") {
    return {
      keyCode: macKeyCode,
      label: macTriggerLabel,
      modifierKeys: MAC_MODIFIER_KEYS,
      capsLock: MAC_CAPS_LOCK,
      functionKeys: MAC_FUNCTION_KEYS,
      reserved: MAC_RESERVED,
      osName: "macOS",
      modifierHint: "Command, Option, Control or Shift",
      cancelKeyCode: 53,
    };
  }
  if (platform === "win32") {
    return {
      keyCode: windowsKeyCode,
      label: windowsTriggerLabel,
      modifierKeys: WINDOWS_MODIFIER_KEYS,
      capsLock: WINDOWS_CAPS_LOCK,
      functionKeys: WINDOWS_FUNCTION_KEYS,
      reserved: WINDOWS_RESERVED,
      osName: "Windows",
      modifierHint: "Ctrl, Alt, Shift or Win",
      cancelKeyCode: WINDOWS_KEY_ESCAPE,
    };
  }
  return {
    keyCode: () => null,
    label: (trigger) => `Key ${trigger.keyCode}`,
    modifierKeys: new Set(),
    capsLock: -1,
    functionKeys: new Set(),
    reserved: [],
    osName: "the system",
    modifierHint: "a modifier key",
    cancelKeyCode: null,
  };
}

/** Default hotkey bindings for this OS. Key codes are platform specific. */
export function defaultHotkeyBindings(platform: NodeJS.Platform): HotkeyBinding[] {
  if (platform === "darwin") return [...MAC_DEFAULT_HOTKEY_BINDINGS];
  return platform === "win32" ? [...WINDOWS_DEFAULT_HOTKEY_BINDINGS] : [];
}

/** One default shortcut of an OS that has them. */
function byOs(
  platform: NodeJS.Platform,
  mac: HotkeyTrigger,
  windows: HotkeyTrigger,
): HotkeyTrigger | null {
  if (platform === "darwin") return mac;
  return platform === "win32" ? windows : null;
}

/** The default Rewrite panel shortcut for this OS, or null when there is none. */
export function defaultRewriteShortcut(platform: NodeJS.Platform): HotkeyTrigger | null {
  return byOs(platform, MAC_DEFAULT_REWRITE_TRIGGER, WINDOWS_DEFAULT_REWRITE_TRIGGER);
}

/** The default Command Mode key for this OS, or null when there is none. */
export function defaultCommandShortcut(platform: NodeJS.Platform): HotkeyTrigger | null {
  return byOs(platform, MAC_DEFAULT_COMMAND_TRIGGER, WINDOWS_DEFAULT_COMMAND_TRIGGER);
}

/** The default Focus Mode shortcut for this OS, or null when there is none. */
export function defaultFocusShortcut(platform: NodeJS.Platform): HotkeyTrigger | null {
  return byOs(platform, MAC_DEFAULT_FOCUS_TRIGGER, WINDOWS_DEFAULT_FOCUS_TRIGGER);
}

/** The default Scratchpad shortcut for this OS, or null when there is none. */
export function defaultScratchpadShortcut(platform: NodeJS.Platform): HotkeyTrigger | null {
  return byOs(platform, MAC_DEFAULT_SCRATCHPAD_TRIGGER, WINDOWS_DEFAULT_SCRATCHPAD_TRIGGER);
}

/** The default Instruct key for this OS, or null when there is none. */
export function defaultInstructShortcut(platform: NodeJS.Platform): HotkeyTrigger | null {
  return byOs(platform, MAC_DEFAULT_INSTRUCT_TRIGGER, WINDOWS_DEFAULT_INSTRUCT_TRIGGER);
}

/** Brings an app back to the front by its id, so a paste reaches it. */
/**
 * Converts an image the app cannot read itself (HEIC, HEIF, GIF) to PNG, or null on a
 * platform without a converter (those types are then refused).
 */
export function imageToPngConverter(
  platform: NodeJS.Platform,
): ((input: string, output: string) => Promise<boolean>) | null {
  return platform === "darwin" ? (input, output) => convertMacImageToPng(input, output) : null;
}

export function appActivator(
  platform: NodeJS.Platform,
  helper: Pick<PlatformHelper, "activateApp">,
): (appId: string) => Promise<void> {
  if (platform === "darwin") return activateMacApp;
  if (platform !== "win32") return async () => {};
  // Windows has no command that brings a program forward, so the helper does it.
  return async (appId) => {
    await helper.activateApp(appId).catch(() => false);
  };
}

/** The app that is always there, to switch to when there is no earlier one. */
export function fileManagerAppId(platform: NodeJS.Platform): string {
  return platform === "win32" ? "explorer.exe" : "com.apple.finder";
}

export type PlatformHelperDeps = MacHelperDeps & { platform: NodeJS.Platform };

/** Picks the helper implementation for this OS. The rest of main only sees `PlatformHelper`. */
export function createPlatformHelper(deps: PlatformHelperDeps): PlatformHelper {
  if (deps.platform === "darwin") {
    return createMacHelper(deps);
  }
  if (deps.platform === "win32") {
    return createWindowsHelper(deps);
  }
  return new HelperSupervisor({
    binary: { path: null, message: `No helper exists for ${deps.platform} yet.` },
    appVersion: deps.appVersion,
    spawn: deps.spawn ?? spawnHelperProcess,
    clock: deps.clock ?? systemClock,
    logger: deps.logger ?? createConsoleLogger("[helper]"),
  });
}

/**
 * The OS the app is running on. This is the only place in main that reads `process.platform`
 * (SW-09); everything else asks this module a question and gets an answer for the OS.
 */
export function hostPlatform(): NodeJS.Platform {
  return process.platform;
}

/** The settings page that lets the person grant a permission, or null when none is known. */
export function permissionSettingsLink(
  platform: NodeJS.Platform,
  kind: PermissionKind,
): string | null {
  if (platform === "darwin") return permissionSettingsUrl(kind);
  // Windows has a privacy switch for the microphone only.
  return platform === "win32" && kind === "microphone" ? "ms-settings:privacy-microphone" : null;
}

/** Whether closing the last window ends the app. On a Mac the app stays in the menu bar. */
export function quitsWhenLastWindowCloses(platform: NodeJS.Platform): boolean {
  return platform !== "darwin";
}

/** Whether the tray icon can carry text beside it (the elapsed time on a Mac). */
export function trayShowsTitle(platform: NodeJS.Platform): boolean {
  return platform === "darwin";
}

/** Which helper's matchers fit this OS, or null when there is no helper for it. */
export function matcherOs(platform: NodeJS.Platform): MatcherOs | null {
  if (platform === "darwin") return "mac";
  if (platform === "win32") return "windows";
  return null;
}

/** The speech model this OS's helper loads: each OS runs the Whisper build that suits it. */
export function speechModelFor(platform: NodeJS.Platform): SpeechModel {
  return platform === "win32" ? WINDOWS_SPEECH_MODEL : DEFAULT_SPEECH_MODEL;
}

/**
 * The address the local MCP server listens on: a socket file in the data folder on a Mac, a named
 * pipe on Windows (a pipe is per machine, so the name carries the user).
 */
export function mcpSocketAddress(platform: NodeJS.Platform, appData: string, user: string): string {
  if (platform === "win32") {
    return `\\\\.\\pipe\\murmur-mcp-${user.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
  }
  return path.join(appData, "Murmur", "mcp.sock");
}

/** The `murmur-mcp` command's file name in the app's `mcp` folder. */
export function mcpCommandFileName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "murmur-mcp.cmd" : "murmur-mcp";
}

/** Where Claude desktop keeps its settings, as folders under the home folder. */
export function claudeDesktopFolder(platform: NodeJS.Platform): readonly string[] {
  if (platform === "darwin") return ["Library", "Application Support", "Claude"];
  if (platform === "win32") return ["AppData", "Roaming", "Claude"];
  return [".config", "Claude"];
}
