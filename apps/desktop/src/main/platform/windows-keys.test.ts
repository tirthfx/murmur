import { describe, expect, it } from "vitest";
import { hotkeyBindingSchema, hotkeyTriggerSchema, type CapturedKey } from "@murmur/shared";
import { checkShortcut, checkTrigger } from "../settings/shortcuts";
import {
  defaultCommandShortcut,
  defaultCopyLastShortcut,
  defaultPasteLastShortcut,
  defaultFocusShortcut,
  defaultHotkeyBindings,
  defaultInstructShortcut,
  defaultRewriteShortcut,
  defaultScratchpadShortcut,
  fileManagerAppId,
  keyPlatform,
  permissionSettingsLink,
} from "./index";

const keys = keyPlatform("win32");
const key = (code: string, ...modifiers: CapturedKey["modifiers"]): CapturedKey => ({
  code,
  modifiers,
});

describe("Windows shortcuts", () => {
  it("dictates on Right Ctrl held on its own", () => {
    const [hold] = defaultHotkeyBindings("win32");
    expect(hotkeyBindingSchema.parse(hold)).toEqual(hold);
    expect(hold?.trigger).toEqual({ type: "key", keyCode: 0xa3, modifiers: [] });
    expect(keys.label({ type: "key", keyCode: 0xa3, modifiers: [] })).toBe("Right Ctrl");
  });

  it("has defaults that are valid, distinct and not reserved", () => {
    const defaults = [
      defaultRewriteShortcut("win32"),
      defaultCommandShortcut("win32"),
      defaultInstructShortcut("win32"),
      defaultFocusShortcut("win32"),
      defaultScratchpadShortcut("win32"),
      defaultCopyLastShortcut("win32"),
      defaultPasteLastShortcut("win32"),
    ].map((trigger) => hotkeyTriggerSchema.parse(trigger));
    expect(new Set(defaults.map((t) => keys.label(t))).size).toBe(defaults.length);
    expect(keys.label(defaults[0]!)).toBe("Ctrl+Alt+R");
    for (const trigger of defaults) {
      expect(
        keys.reserved.some(
          (entry) =>
            entry.keyCode === trigger.keyCode &&
            entry.modifiers.join() === trigger.modifiers.join(),
        ),
      ).toBe(false);
    }
  });

  it("takes a captured key and names it", () => {
    expect(checkShortcut(key("AltRight"), "hold", {}, keys)).toEqual({
      ok: true,
      trigger: { type: "key", keyCode: 0xa5, modifiers: [] },
    });
    expect(checkShortcut(key("F13"), "hold", {}, keys)).toMatchObject({ ok: true });
    const combo = checkShortcut(key("KeyK", "control", "shift"), "rewrite", {}, keys);
    expect(combo.ok && keys.label(combo.trigger)).toBe("Ctrl+Shift+K");
  });

  it("refuses what Windows keeps, a bare letter and Caps Lock", () => {
    expect(checkTrigger(key("KeyL", "command"), [], keys)).toEqual({
      ok: false,
      message: "Win+L is used by Windows for locking the PC.",
    });
    expect(checkTrigger(key("KeyK"), [], keys)).toEqual({
      ok: false,
      message: "K alone would type into apps. Add Ctrl, Alt, Shift or Win.",
    });
    expect(checkTrigger(key("CapsLock"), [], keys)).toMatchObject({ ok: false });
    expect(checkTrigger(key("MediaPlayPause"), [], keys)).toMatchObject({ ok: false });
  });

  it("gives every key code the helper accepts", () => {
    for (const code of ["KeyA", "Digit0", "F24", "ArrowUp", "Quote", "MetaRight"]) {
      const value = keys.keyCode(code);
      expect(value, code).not.toBeNull();
      expect(value!).toBeLessThanOrEqual(255);
    }
    expect(keys.cancelKeyCode).toBe(27);
  });

  it("answers the other questions for Windows", () => {
    expect(permissionSettingsLink("win32", "microphone")).toBe("ms-settings:privacy-microphone");
    expect(permissionSettingsLink("win32", "accessibility")).toBeNull();
    expect(fileManagerAppId("win32")).toBe("explorer.exe");
  });
});
