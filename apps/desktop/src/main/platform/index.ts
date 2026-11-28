/**
 * The Mac side of the app: everything that knows about macOS is in this folder, and the rest of
 * main reaches the helper through `PlatformHelper` (`@murmur/shared`).
 */
import type { KeyPlatform } from "../settings/shortcuts";
import {
  MAC_CAPS_LOCK,
  MAC_FUNCTION_KEYS,
  MAC_MODIFIER_KEYS,
  MAC_RESERVED,
  macKeyCode,
  macTriggerLabel,
} from "./mac-keymap";

export { createMacHelper } from "./mac-helper";
export { activateMacApp } from "./mac-apps";
export { convertMacImageToPng } from "./mac-image";
export { permissionSettingsUrl } from "./mac-settings-links";
export {
  MAC_DEFAULT_COMMAND_TRIGGER,
  MAC_DEFAULT_COPY_LAST_TRIGGER,
  MAC_DEFAULT_FOCUS_TRIGGER,
  MAC_DEFAULT_HOTKEY_BINDINGS,
  MAC_DEFAULT_INSTRUCT_TRIGGER,
  MAC_DEFAULT_PASTE_LAST_TRIGGER,
  MAC_DEFAULT_REWRITE_TRIGGER,
  MAC_DEFAULT_SCRATCHPAD_TRIGGER,
  MAC_KEY_RIGHT_OPTION,
} from "./mac-hotkeys";

/** Mac key codes, key names and the shortcuts macOS keeps for itself. */
export const MAC_KEYS: KeyPlatform = {
  keyCode: macKeyCode,
  label: macTriggerLabel,
  modifierKeys: MAC_MODIFIER_KEYS,
  capsLock: MAC_CAPS_LOCK,
  functionKeys: MAC_FUNCTION_KEYS,
  reserved: MAC_RESERVED,
  /** Escape. */
  cancelKeyCode: 53,
};
