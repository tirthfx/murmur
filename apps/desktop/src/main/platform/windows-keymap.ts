import type { HotkeyModifier, HotkeyTrigger } from "@murmur/shared";

const range = (count: number) => Array.from({ length: count }, (_, index) => index);

/** Browser `KeyboardEvent.code` to Windows virtual key code (US layout positions for symbols). */
const CODE_TO_KEY: Record<string, number> = {
  ShiftLeft: 0xa0,
  ShiftRight: 0xa1,
  ControlLeft: 0xa2,
  ControlRight: 0xa3,
  AltLeft: 0xa4,
  AltRight: 0xa5,
  MetaLeft: 0x5b,
  MetaRight: 0x5c,
  CapsLock: 0x14,
  Backspace: 0x08,
  Tab: 0x09,
  Enter: 0x0d,
  Escape: 0x1b,
  Space: 0x20,
  PageUp: 0x21,
  PageDown: 0x22,
  End: 0x23,
  Home: 0x24,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  Insert: 0x2d,
  Delete: 0x2e,
  Semicolon: 0xba,
  Equal: 0xbb,
  Comma: 0xbc,
  Minus: 0xbd,
  Period: 0xbe,
  Slash: 0xbf,
  Backquote: 0xc0,
  BracketLeft: 0xdb,
  Backslash: 0xdc,
  BracketRight: 0xdd,
  Quote: 0xde,
  ...Object.fromEntries(
    range(26).map((i) => [`Key${String.fromCharCode(65 + i)}`, 65 + i] as const),
  ),
  ...Object.fromEntries(range(10).map((i) => [`Digit${i}`, 48 + i] as const)),
  ...Object.fromEntries(range(24).map((i) => [`F${i + 1}`, 0x70 + i] as const)),
};

const KEY_NAMES: Record<number, string> = {
  0xa0: "Left Shift",
  0xa1: "Right Shift",
  0xa2: "Left Ctrl",
  0xa3: "Right Ctrl",
  0xa4: "Left Alt",
  0xa5: "Right Alt",
  0x5b: "Left Win",
  0x5c: "Right Win",
  0x14: "Caps Lock",
  0x25: "Left Arrow",
  0x26: "Up Arrow",
  0x27: "Right Arrow",
  0x28: "Down Arrow",
  0x21: "Page Up",
  0x22: "Page Down",
  0x2e: "Delete",
  0xba: ";",
  0xbb: "=",
  0xbc: ",",
  0xbd: "-",
  0xbe: ".",
  0xbf: "/",
  0xc0: "`",
  0xdb: "[",
  0xdc: "\\",
  0xdd: "]",
  0xde: "'",
};

for (const [code, key] of Object.entries(CODE_TO_KEY)) {
  if (KEY_NAMES[key]) continue;
  KEY_NAMES[key] = code.replace(/^(Key|Digit)/, "");
}

export const WINDOWS_MODIFIER_KEYS = new Set([0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0x5b, 0x5c]);
export const WINDOWS_CAPS_LOCK = 0x14;
export const WINDOWS_FUNCTION_KEYS = new Set(range(24).map((i) => 0x70 + i));

export function windowsKeyCode(code: string): number | null {
  return Object.hasOwn(CODE_TO_KEY, code) ? CODE_TO_KEY[code]! : null;
}

const MODIFIER_ORDER: HotkeyModifier[] = ["control", "option", "shift", "command", "fn"];
const MODIFIER_NAMES: Record<HotkeyModifier, string> = {
  control: "Ctrl",
  option: "Alt",
  shift: "Shift",
  command: "Win",
  fn: "Fn",
};

/** "Right Ctrl", "Ctrl+Alt+Space", "Win+Shift+5". */
export function windowsTriggerLabel(trigger: HotkeyTrigger): string {
  const key = KEY_NAMES[trigger.keyCode] ?? `Key ${trigger.keyCode}`;
  const modifiers = MODIFIER_ORDER.filter((modifier) => trigger.modifiers.includes(modifier)).map(
    (modifier) => MODIFIER_NAMES[modifier],
  );
  return [...modifiers, key].join("+");
}

const reserved = (code: string, use: string, ...modifiers: HotkeyModifier[]) => ({
  keyCode: CODE_TO_KEY[code]!,
  modifiers,
  use,
});

/** Shortcuts Windows keeps for itself, with what they do. Murmur refuses them. */
export const WINDOWS_RESERVED: { keyCode: number; modifiers: HotkeyModifier[]; use: string }[] = [
  reserved("KeyL", "locking the PC", "command"),
  reserved("KeyD", "showing the desktop", "command"),
  reserved("KeyE", "File Explorer", "command"),
  reserved("KeyR", "the Run box", "command"),
  reserved("KeyI", "Settings", "command"),
  reserved("KeyS", "search", "command"),
  reserved("KeyX", "the quick menu", "command"),
  reserved("KeyV", "clipboard history", "command"),
  reserved("KeyH", "voice typing", "command"),
  reserved("KeyS", "screenshots", "command", "shift"),
  reserved("Tab", "task view", "command"),
  reserved("Space", "switching input languages", "command"),
  reserved("Tab", "switching apps", "option"),
  reserved("Tab", "switching apps", "option", "shift"),
  reserved("Escape", "switching windows", "option"),
  reserved("F4", "closing windows", "option"),
  reserved("Space", "the window menu", "option"),
  reserved("Escape", "the Start menu", "control"),
  reserved("Escape", "Task Manager", "control", "shift"),
  reserved("Delete", "the security screen", "control", "option"),
];
