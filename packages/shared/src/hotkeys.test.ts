import { describe, expect, it } from "vitest";
import { hotkeyBindingSchema, hotkeyConfigurePayloadSchema, MAX_HOTKEY_BINDINGS } from "./hotkeys";

const binding = {
  id: "dictate-hold",
  action: "dictate.hold",
  trigger: { type: "key", keyCode: 61, modifiers: [] },
  mode: "hold",
};

describe("hotkey binding schema", () => {
  it("accepts a modifier key on its own", () => {
    expect(hotkeyBindingSchema.safeParse(binding).success).toBe(true);
  });

  it("refuses repeated modifiers, unknown actions and out-of-range key codes", () => {
    const withTrigger = (trigger: object) => ({
      ...binding,
      trigger: { ...binding.trigger, ...trigger },
    });
    expect(
      hotkeyBindingSchema.safeParse(withTrigger({ modifiers: ["shift", "shift"] })).success,
    ).toBe(false);
    expect(hotkeyBindingSchema.safeParse(withTrigger({ keyCode: 128 })).success).toBe(false);
    expect(hotkeyBindingSchema.safeParse({ ...binding, action: "open.everything" }).success).toBe(
      false,
    );
  });

  it("caps the number of bindings", () => {
    const many = Array.from({ length: MAX_HOTKEY_BINDINGS + 1 }, (_, i) => ({
      ...binding,
      id: `b${i}`,
    }));
    expect(hotkeyConfigurePayloadSchema.safeParse({ bindings: many }).success).toBe(false);
    expect(hotkeyConfigurePayloadSchema.safeParse({ bindings: [] }).success).toBe(true);
  });
});
