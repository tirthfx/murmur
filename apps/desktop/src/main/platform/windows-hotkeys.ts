import type { HotkeyBinding, HotkeyTrigger } from "@murmur/shared";

/** Windows virtual key codes of the keys the defaults use. */
export const WINDOWS_KEY_RIGHT_CONTROL = 0xa3;
export const WINDOWS_KEY_ESCAPE = 0x1b;

/**
 * Default bindings on Windows (vault ADR-0108): hold Right Ctrl to dictate. Not Right Alt,
 * which types characters (Alt Gr) on many layouts. Hands-free is a double tap of the same key.
 */
export const WINDOWS_DEFAULT_HOTKEY_BINDINGS: readonly HotkeyBinding[] = [
  {
    id: "dictate-hold",
    action: "dictate.hold",
    trigger: { type: "key", keyCode: WINDOWS_KEY_RIGHT_CONTROL, modifiers: [] },
    mode: "hold",
  },
];

/** `option` is the Alt key on Windows. */
function controlAlt(letter: string): HotkeyTrigger {
  return { type: "key", keyCode: letter.charCodeAt(0), modifiers: ["control", "option"] };
}

export const WINDOWS_DEFAULT_REWRITE_TRIGGER = controlAlt("R");
export const WINDOWS_DEFAULT_COMMAND_TRIGGER = controlAlt("C");
export const WINDOWS_DEFAULT_INSTRUCT_TRIGGER = controlAlt("I");
export const WINDOWS_DEFAULT_FOCUS_TRIGGER = controlAlt("F");
export const WINDOWS_DEFAULT_SCRATCHPAD_TRIGGER = controlAlt("S");
export const WINDOWS_DEFAULT_PASTE_LAST_TRIGGER = controlAlt("V");
/** With Shift, because Ctrl+Alt+C is Command Mode here. */
export const WINDOWS_DEFAULT_COPY_LAST_TRIGGER: HotkeyTrigger = {
  type: "key",
  keyCode: "C".charCodeAt(0),
  modifiers: ["control", "option", "shift"],
};
