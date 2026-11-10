import { describe, expect, it } from "vitest";
import { ShortcutCapture, type KeyLike } from "./shortcut-capture";

function key(code: string, held: Partial<KeyLike> = {}): KeyLike {
  return { code, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, ...held };
}

describe("shortcut capture", () => {
  it("takes a modifier pressed and released on its own", () => {
    const capture = new ShortcutCapture();
    expect(capture.keyDown(key("AltRight", { altKey: true }))).toEqual({ kind: "wait" });
    expect(capture.keyUp(key("AltRight"))).toEqual({
      kind: "done",
      key: { code: "AltRight", modifiers: [] },
    });
  });

  it("takes a chord as soon as the main key goes down", () => {
    const capture = new ShortcutCapture();
    capture.keyDown(key("ControlLeft", { ctrlKey: true }));
    capture.keyDown(key("AltLeft", { ctrlKey: true, altKey: true }));
    expect(capture.keyDown(key("KeyD", { ctrlKey: true, altKey: true }))).toEqual({
      kind: "done",
      key: { code: "KeyD", modifiers: ["option", "control"] },
    });
  });

  it("does not take a modifier released after being part of a chord", () => {
    const capture = new ShortcutCapture();
    capture.keyDown(key("ShiftLeft", { shiftKey: true }));
    capture.keyDown(key("MetaLeft", { shiftKey: true, metaKey: true }));
    expect(capture.keyUp(key("MetaLeft", { shiftKey: true }))).toEqual({ kind: "wait" });
  });

  it("cancels on Escape alone but keeps Escape with modifiers", () => {
    expect(new ShortcutCapture().keyDown(key("Escape"))).toEqual({ kind: "cancel" });
    expect(new ShortcutCapture().keyDown(key("Escape", { metaKey: true }))).toMatchObject({
      kind: "done",
    });
  });
});
