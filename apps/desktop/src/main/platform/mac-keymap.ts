import type { HotkeyModifier, HotkeyTrigger } from "@murmur/shared";

/** Browser `KeyboardEvent.code` to macOS virtual key code (ANSI layout positions). */
const CODE_TO_KEY: Record<string, number> = {
  KeyA: 0,
  KeyS: 1,
  KeyD: 2,
  KeyF: 3,
  KeyH: 4,
  KeyG: 5,
  KeyZ: 6,
  KeyX: 7,
  KeyC: 8,
  KeyV: 9,
  KeyB: 11,
  KeyQ: 12,
  KeyW: 13,
  KeyE: 14,
  KeyR: 15,
  KeyY: 16,
  KeyT: 17,
  Digit1: 18,
  Digit2: 19,
  Digit3: 20,
  Digit4: 21,
  Digit6: 22,
  Digit5: 23,
  Equal: 24,
  Digit9: 25,
  Digit7: 26,
  Minus: 27,
  Digit8: 28,
  Digit0: 29,
  BracketRight: 30,
  KeyO: 31,
  KeyU: 32,
  BracketLeft: 33,
  KeyI: 34,
  KeyP: 35,
  Enter: 36,
  KeyL: 37,
  KeyJ: 38,
  Quote: 39,
  KeyK: 40,
  Semicolon: 41,
  Backslash: 42,
  Comma: 43,
  Slash: 44,
  KeyN: 45,
  KeyM: 46,
  Period: 47,
  Tab: 48,
  Space: 49,
  Backquote: 50,
  Backspace: 51,
  Escape: 53,
  MetaRight: 54,
  MetaLeft: 55,
  ShiftLeft: 56,
  CapsLock: 57,
  AltLeft: 58,
  ControlLeft: 59,
  ShiftRight: 60,
  AltRight: 61,
  ControlRight: 62,
  Fn: 63,
  F1: 122,
  F2: 120,
  F3: 99,
  F4: 118,
  F5: 96,
  F6: 97,
  F7: 98,
  F8: 100,
  F9: 101,
  F10: 109,
  F11: 103,
  F12: 111,
  F13: 105,
  F14: 107,
  F15: 113,
  F16: 106,
  F17: 64,
  F18: 79,
  F19: 80,
  F20: 90,
  Home: 115,
  PageUp: 116,
  Delete: 117,
  End: 119,
  PageDown: 121,
  ArrowLeft: 123,
  ArrowRight: 124,
  ArrowDown: 125,
  ArrowUp: 126,
};

const KEY_NAMES: Record<number, string> = {
  54: "Right Command",
  55: "Left Command",
  56: "Left Shift",
  57: "Caps Lock",
  58: "Left Option",
  59: "Left Control",
  60: "Right Shift",
  61: "Right Option",
  62: "Right Control",
  63: "Fn",
  36: "Return",
  48: "Tab",
  49: "Space",
  51: "Delete",
  53: "Escape",
  117: "Forward Delete",
  115: "Home",
  119: "End",
  116: "Page Up",
  121: "Page Down",
  123: "Left Arrow",
  124: "Right Arrow",
  125: "Down Arrow",
  126: "Up Arrow",
  24: "=",
  27: "-",
  30: "]",
  33: "[",
  39: "'",
  41: ";",
  42: "\\",
  43: ",",
  44: "/",
  47: ".",
  50: "`",
};

for (const [code, key] of Object.entries(CODE_TO_KEY)) {
  if (KEY_NAMES[key]) continue;
  if (code.startsWith("Key")) KEY_NAMES[key] = code.slice(3);
  else if (code.startsWith("Digit")) KEY_NAMES[key] = code.slice(5);
  else if (/^F\d+$/.test(code)) KEY_NAMES[key] = code;
}

export const MAC_MODIFIER_KEYS = new Set([54, 55, 56, 58, 59, 60, 61, 62, 63]);
export const MAC_CAPS_LOCK = 57;
export const MAC_FUNCTION_KEYS = new Set([
  122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106, 64, 79, 80, 90,
]);

export function macKeyCode(code: string): number | null {
  return Object.hasOwn(CODE_TO_KEY, code) ? CODE_TO_KEY[code]! : null;
}

const MODIFIER_ORDER: HotkeyModifier[] = ["control", "option", "shift", "command", "fn"];
const MODIFIER_NAMES: Record<HotkeyModifier, string> = {
  control: "Control",
  option: "Option",
  shift: "Shift",
  command: "Command",
  fn: "Fn",
};

/** "Right Option", "Control+Option+Space", "Command+Shift+5". */
export function macTriggerLabel(trigger: HotkeyTrigger): string {
  const key = KEY_NAMES[trigger.keyCode] ?? `Key ${trigger.keyCode}`;
  const modifiers = MODIFIER_ORDER.filter((modifier) => trigger.modifiers.includes(modifier)).map(
    (modifier) => MODIFIER_NAMES[modifier],
  );
  return [...modifiers, key].join("+");
}

/** Shortcuts macOS keeps for itself, with what they do. Murmur refuses them. */
export const MAC_RESERVED: { keyCode: number; modifiers: HotkeyModifier[]; use: string }[] = [
  { keyCode: 49, modifiers: ["command"], use: "Spotlight" },
  { keyCode: 49, modifiers: ["command", "option"], use: "Finder search" },
  { keyCode: 49, modifiers: ["control"], use: "switching input sources" },
  { keyCode: 49, modifiers: ["control", "option"], use: "switching input sources" },
  { keyCode: 49, modifiers: ["control", "command"], use: "the emoji picker" },
  { keyCode: 48, modifiers: ["command"], use: "switching apps" },
  { keyCode: 48, modifiers: ["command", "shift"], use: "switching apps" },
  { keyCode: 50, modifiers: ["command"], use: "switching windows" },
  { keyCode: 12, modifiers: ["command"], use: "quitting apps" },
  { keyCode: 13, modifiers: ["command"], use: "closing windows" },
  { keyCode: 4, modifiers: ["command"], use: "hiding apps" },
  { keyCode: 46, modifiers: ["command"], use: "minimising windows" },
  { keyCode: 12, modifiers: ["command", "control"], use: "locking the screen" },
  { keyCode: 53, modifiers: ["command", "option"], use: "Force Quit" },
  { keyCode: 20, modifiers: ["command", "shift"], use: "screenshots" },
  { keyCode: 21, modifiers: ["command", "shift"], use: "screenshots" },
  { keyCode: 23, modifiers: ["command", "shift"], use: "screenshots" },
  { keyCode: 126, modifiers: ["control"], use: "Mission Control" },
  { keyCode: 125, modifiers: ["control"], use: "App Exposé" },
  { keyCode: 123, modifiers: ["control"], use: "moving between Spaces" },
  { keyCode: 124, modifiers: ["control"], use: "moving between Spaces" },
];
