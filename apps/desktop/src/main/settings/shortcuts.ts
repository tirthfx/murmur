import type { CapturedKey, HotkeyTrigger, ShortcutSlot } from "@murmur/shared";

/** What validation needs from the platform (key codes are platform specific). */
export interface KeyPlatform {
  keyCode(code: string): number | null;
  label(trigger: HotkeyTrigger): string;
  modifierKeys: ReadonlySet<number>;
  capsLock: number;
  functionKeys: ReadonlySet<number>;
  reserved: readonly { keyCode: number; modifiers: readonly string[]; use: string }[];
  /** The key that cancels a dictation (Escape), or null if the platform has none. */
  cancelKeyCode: number | null;
}

export const SLOT_NAMES: Record<ShortcutSlot, string> = {
  hold: "Push to talk",
  handsFree: "Hands-free",
  rewrite: "Rewrite",
};

function sameTrigger(a: HotkeyTrigger, b: HotkeyTrigger): boolean {
  return (
    a.keyCode === b.keyCode &&
    a.modifiers.length === b.modifiers.length &&
    a.modifiers.every((modifier) => b.modifiers.includes(modifier))
  );
}

/**
 * Turns a captured key into a trigger, or explains why it cannot be one. `others` are the
 * shortcuts Murmur already uses in other slots.
 */
export function checkShortcut(
  key: CapturedKey,
  slot: ShortcutSlot,
  others: Partial<Record<ShortcutSlot, HotkeyTrigger | null>>,
  platform: KeyPlatform,
): { ok: true; trigger: HotkeyTrigger } | { ok: false; message: string } {
  const keyCode = platform.keyCode(key.code);
  if (keyCode === null) return { ok: false, message: "This key cannot be used as a shortcut." };
  if (keyCode === platform.capsLock)
    return { ok: false, message: "Caps Lock cannot be used as a shortcut." };
  const isModifier = platform.modifierKeys.has(keyCode);
  const trigger: HotkeyTrigger = {
    type: "key",
    keyCode,
    modifiers: isModifier ? [] : [...new Set(key.modifiers)],
  };
  if (!isModifier && trigger.modifiers.length === 0 && !platform.functionKeys.has(keyCode)) {
    return {
      ok: false,
      message: `${platform.label(trigger)} alone would type into apps. Add Command, Option, Control or Shift.`,
    };
  }
  const reserved = platform.reserved.find(
    (entry) =>
      entry.keyCode === keyCode &&
      entry.modifiers.length === trigger.modifiers.length &&
      entry.modifiers.every((modifier) => trigger.modifiers.includes(modifier as never)),
  );
  if (reserved) {
    return {
      ok: false,
      message: `${platform.label(trigger)} is used by macOS for ${reserved.use}.`,
    };
  }
  for (const [otherSlot, other] of Object.entries(others) as [
    ShortcutSlot,
    HotkeyTrigger | null,
  ][]) {
    if (otherSlot !== slot && other && sameTrigger(other, trigger)) {
      return {
        ok: false,
        message: `${platform.label(trigger)} is already used for ${SLOT_NAMES[otherSlot]}.`,
      };
    }
  }
  return { ok: true, trigger };
}
