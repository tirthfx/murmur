import type {
  HotkeyBinding,
  HotkeyTrigger,
  MatcherOs,
  PermissionKind,
  PlatformHelper,
} from "@murmur/shared";
import { convertMacImageToPng } from "./mac-image";
import { createConsoleLogger, spawnHelperProcess, systemClock } from "../helper/node-runtime";
import { HelperSupervisor } from "../helper/supervisor";
import { createMacHelper, type MacHelperDeps } from "./mac-helper";
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
      cancelKeyCode: 53,
    };
  }
  return {
    keyCode: () => null,
    label: (trigger) => `Key ${trigger.keyCode}`,
    modifierKeys: new Set(),
    capsLock: -1,
    functionKeys: new Set(),
    reserved: [],
    cancelKeyCode: null,
  };
}

/** Default hotkey bindings for this OS. Key codes are platform specific. */
export function defaultHotkeyBindings(platform: NodeJS.Platform): HotkeyBinding[] {
  return platform === "darwin" ? [...MAC_DEFAULT_HOTKEY_BINDINGS] : [];
}

/** The default Rewrite panel shortcut for this OS, or null when there is none. */
export function defaultRewriteShortcut(platform: NodeJS.Platform): HotkeyTrigger | null {
  return platform === "darwin" ? MAC_DEFAULT_REWRITE_TRIGGER : null;
}

/** The default Command Mode key for this OS, or null when there is none. */
export function defaultCommandShortcut(platform: NodeJS.Platform): HotkeyTrigger | null {
  return platform === "darwin" ? MAC_DEFAULT_COMMAND_TRIGGER : null;
}

/** The default Focus Mode shortcut for this OS, or null when there is none. */
export function defaultFocusShortcut(platform: NodeJS.Platform): HotkeyTrigger | null {
  return platform === "darwin" ? MAC_DEFAULT_FOCUS_TRIGGER : null;
}

/** The default Scratchpad shortcut for this OS, or null when there is none. */
export function defaultScratchpadShortcut(platform: NodeJS.Platform): HotkeyTrigger | null {
  return platform === "darwin" ? MAC_DEFAULT_SCRATCHPAD_TRIGGER : null;
}

/** The default Instruct key for this OS, or null when there is none. */
export function defaultInstructShortcut(platform: NodeJS.Platform): HotkeyTrigger | null {
  return platform === "darwin" ? MAC_DEFAULT_INSTRUCT_TRIGGER : null;
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

export function appActivator(platform: NodeJS.Platform): (appId: string) => Promise<void> {
  return platform === "darwin" ? activateMacApp : async () => {};
}

export type PlatformHelperDeps = MacHelperDeps & { platform: NodeJS.Platform };

/** Picks the helper implementation for this OS. The rest of main only sees `PlatformHelper`. */
export function createPlatformHelper(deps: PlatformHelperDeps): PlatformHelper {
  if (deps.platform === "darwin") {
    return createMacHelper(deps);
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
  return platform === "darwin" ? permissionSettingsUrl(kind) : null;
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
