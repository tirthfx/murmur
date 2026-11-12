import type { HotkeyBinding, HotkeyTrigger, PlatformHelper } from "@murmur/shared";
import { createConsoleLogger, spawnHelperProcess, systemClock } from "../helper/node-runtime";
import { HelperSupervisor } from "../helper/supervisor";
import { createMacHelper, type MacHelperDeps } from "./mac-helper";
import type { KeyPlatform } from "../settings/shortcuts";
import { MAC_DEFAULT_HOTKEY_BINDINGS, MAC_DEFAULT_REWRITE_TRIGGER } from "./mac-hotkeys";
import { activateMacApp } from "./mac-apps";
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

/** Brings an app back to the front by its id, so a paste reaches it. */
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
