import { describe, expect, it } from "vitest";
import type { HotkeyTrigger } from "@murmur/shared";
import {
  MAC_CAPS_LOCK,
  MAC_FUNCTION_KEYS,
  MAC_MODIFIER_KEYS,
  MAC_RESERVED,
  macKeyCode,
  macTriggerLabel,
} from "../platform/mac-keymap";
import { checkShortcut, type KeyPlatform } from "./shortcuts";

const mac: KeyPlatform = {
  keyCode: macKeyCode,
  label: macTriggerLabel,
  modifierKeys: MAC_MODIFIER_KEYS,
  capsLock: MAC_CAPS_LOCK,
  functionKeys: MAC_FUNCTION_KEYS,
  reserved: MAC_RESERVED,
};

const rightOption: HotkeyTrigger = { type: "key", keyCode: 61, modifiers: [] };

describe("shortcut checks", () => {
  it("accepts a modifier key on its own, dropping held modifiers", () => {
    expect(checkShortcut({ code: "AltRight", modifiers: ["shift"] }, "hold", {}, mac)).toEqual({
      ok: true,
      trigger: rightOption,
    });
  });

  it("accepts a chord and a bare function key", () => {
    expect(
      checkShortcut({ code: "Space", modifiers: ["control", "option"] }, "handsFree", {}, mac),
    ).toMatchObject({
      ok: false,
    });
    expect(
      checkShortcut({ code: "KeyD", modifiers: ["control", "option"] }, "handsFree", {}, mac),
    ).toEqual({
      ok: true,
      trigger: { type: "key", keyCode: 2, modifiers: ["control", "option"] },
    });
    expect(checkShortcut({ code: "F5", modifiers: [] }, "hold", {}, mac)).toMatchObject({
      ok: true,
    });
  });

  it("refuses Command+Space and says what macOS uses it for", () => {
    expect(checkShortcut({ code: "Space", modifiers: ["command"] }, "hold", {}, mac)).toEqual({
      ok: false,
      message: "Command+Space is used by macOS for Spotlight.",
    });
    expect(
      checkShortcut({ code: "Digit4", modifiers: ["shift", "command"] }, "hold", {}, mac),
    ).toMatchObject({
      ok: false,
      message: "Shift+Command+4 is used by macOS for screenshots.",
    });
  });

  it("refuses a shortcut the other slot uses, naming that action", () => {
    expect(
      checkShortcut({ code: "AltRight", modifiers: [] }, "handsFree", { hold: rightOption }, mac),
    ).toEqual({
      ok: false,
      message: "Right Option is already used for Push to talk.",
    });
    const chord: HotkeyTrigger = { type: "key", keyCode: 2, modifiers: ["control", "option"] };
    expect(
      checkShortcut(
        { code: "KeyD", modifiers: ["option", "control"] },
        "hold",
        { handsFree: chord },
        mac,
      ),
    ).toMatchObject({ ok: false, message: "Control+Option+D is already used for Hands-free." });
  });

  it("allows keeping a slot's own shortcut", () => {
    expect(
      checkShortcut({ code: "AltRight", modifiers: [] }, "hold", { hold: rightOption }, mac),
    ).toMatchObject({
      ok: true,
    });
  });

  it("refuses plain letters, Caps Lock and unknown keys", () => {
    expect(checkShortcut({ code: "KeyA", modifiers: [] }, "hold", {}, mac)).toEqual({
      ok: false,
      message: "A alone would type into apps. Add Command, Option, Control or Shift.",
    });
    expect(checkShortcut({ code: "CapsLock", modifiers: [] }, "hold", {}, mac)).toMatchObject({
      ok: false,
    });
    expect(checkShortcut({ code: "MediaPlayPause", modifiers: [] }, "hold", {}, mac)).toMatchObject(
      { ok: false },
    );
    expect(checkShortcut({ code: "toString", modifiers: [] }, "hold", {}, mac)).toMatchObject({
      ok: false,
    });
  });
});

describe("mac key labels", () => {
  it("names keys the way the Mac does", () => {
    expect(macTriggerLabel(rightOption)).toBe("Right Option");
    expect(macTriggerLabel({ type: "key", keyCode: 49, modifiers: ["command", "control"] })).toBe(
      "Control+Command+Space",
    );
    expect(macTriggerLabel({ type: "key", keyCode: 96, modifiers: [] })).toBe("F5");
    expect(macTriggerLabel({ type: "key", keyCode: 18, modifiers: ["option"] })).toBe("Option+1");
  });
});
