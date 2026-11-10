import type { CapturedKey } from "@murmur/shared";

const MODIFIER_CODES = new Set([
  "MetaLeft",
  "MetaRight",
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
]);

export interface KeyLike {
  code: string;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

function modifiersOf(event: KeyLike): CapturedKey["modifiers"] {
  const held: CapturedKey["modifiers"] = [];
  if (event.metaKey) held.push("command");
  if (event.altKey) held.push("option");
  if (event.ctrlKey) held.push("control");
  if (event.shiftKey) held.push("shift");
  return held;
}

export type CaptureStep =
  { kind: "wait" } | { kind: "cancel" } | { kind: "done"; key: CapturedKey };

/**
 * Turns key presses into a shortcut. A non-modifier key finishes at once with the modifiers
 * held. A modifier pressed and released on its own (such as Right Option) is the shortcut by
 * itself. Escape on its own cancels.
 */
export class ShortcutCapture {
  private lonelyModifier: string | null = null;

  keyDown(event: KeyLike): CaptureStep {
    if (MODIFIER_CODES.has(event.code)) {
      // Only a modifier pressed with no other modifier held can stand alone.
      this.lonelyModifier = modifiersOf(event).length <= 1 ? event.code : null;
      return { kind: "wait" };
    }
    this.lonelyModifier = null;
    const modifiers = modifiersOf(event);
    if (event.code === "Escape" && modifiers.length === 0) return { kind: "cancel" };
    return { kind: "done", key: { code: event.code, modifiers } };
  }

  keyUp(event: KeyLike): CaptureStep {
    if (this.lonelyModifier === event.code) {
      this.lonelyModifier = null;
      return { kind: "done", key: { code: event.code, modifiers: [] } };
    }
    return { kind: "wait" };
  }
}
