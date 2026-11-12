import type { HotkeyBinding, HotkeyTrigger } from "@murmur/shared";

/** macOS virtual key code of Right Option. */
export const MAC_KEY_RIGHT_OPTION = 61;

/**
 * Default bindings on macOS (vault ADR-0021): hold Right Option to dictate. Hands-free
 * comes from a double tap of the same key, which main detects from these events later.
 */
export const MAC_DEFAULT_HOTKEY_BINDINGS: readonly HotkeyBinding[] = [
  {
    id: "dictate-hold",
    action: "dictate.hold",
    trigger: { type: "key", keyCode: MAC_KEY_RIGHT_OPTION, modifiers: [] },
    mode: "hold",
  },
];

/** macOS virtual key code of R. */
export const MAC_KEY_R = 15;

/** Opens the Rewrite panel (RW-01): Control+Option+R. */
export const MAC_DEFAULT_REWRITE_TRIGGER: HotkeyTrigger = {
  type: "key",
  keyCode: MAC_KEY_R,
  modifiers: ["control", "option"],
};
