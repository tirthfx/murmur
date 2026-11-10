import type { HotkeyBinding, PlatformHelper } from "@murmur/shared";
import { createConsoleLogger, spawnHelperProcess, systemClock } from "../helper/node-runtime";
import { HelperSupervisor } from "../helper/supervisor";
import { createMacHelper, type MacHelperDeps } from "./mac-helper";
import type { KeyPlatform } from "../settings/shortcuts";
import { MAC_DEFAULT_HOTKEY_BINDINGS } from "./mac-hotkeys";
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
    };
  }
  return {
    keyCode: () => null,
    label: (trigger) => `Key ${trigger.keyCode}`,
    modifierKeys: new Set(),
    capsLock: -1,
    functionKeys: new Set(),
    reserved: [],
  };
}

/** Default hotkey bindings for this OS. Key codes are platform specific. */
export function defaultHotkeyBindings(platform: NodeJS.Platform): HotkeyBinding[] {
  return platform === "darwin" ? [...MAC_DEFAULT_HOTKEY_BINDINGS] : [];
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
