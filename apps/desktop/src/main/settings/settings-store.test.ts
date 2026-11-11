import { describe, expect, it, vi } from "vitest";
import type { Settings } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createSettingsStore } from "./settings-store";

const defaults: Settings = {
  holdShortcut: { type: "key", keyCode: 61, modifiers: [] },
  handsFreeShortcut: null,
  inputDevice: "auto",
  language: "auto",
  cleanupLevel: "standard",
  sounds: { start: true, lock: true, success: true, error: true, cancel: false },
  muteWhileDictating: false,
  setupComplete: true,
  pressEnterCommand: true,
  contextAwareness: true,
  mouseButtons: { hold: null, handsFree: null },
};

describe("settings store", () => {
  it("starts from the defaults and keeps changes across a restart", () => {
    const db = openDatabase(":memory:");
    const first = createSettingsStore(db, defaults, () => 7);
    expect(first.get()).toEqual(defaults);
    first.update({ language: "hi", inputDevice: "USB-1" });
    first.setShortcut("handsFree", { type: "key", keyCode: 2, modifiers: ["control", "option"] });

    const again = createSettingsStore(db, defaults);
    expect(again.get()).toEqual({
      ...defaults,
      language: "hi",
      inputDevice: "USB-1",
      handsFreeShortcut: { type: "key", keyCode: 2, modifiers: ["control", "option"] },
    });
    expect(
      db
        .prepare("SELECT key, value_json, updated_at FROM settings WHERE key = 'speech.language'")
        .get(),
    ).toEqual({
      key: "speech.language",
      value_json: '"hi"',
      updated_at: 7,
    });
  });

  it("tells listeners what changed, and nothing when nothing did", () => {
    const store = createSettingsStore(openDatabase(":memory:"), defaults);
    const handler = vi.fn();
    store.onChange(handler);
    store.update({ cleanupLevel: "full" });
    store.update({ cleanupLevel: "full" });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![1]).toEqual(["cleanupLevel"]);
  });

  it("ignores stored values that no longer validate", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, 1)").run(
      "speech.language",
      '"klingon"',
    );
    expect(createSettingsStore(db, defaults).get().language).toBe("auto");
  });

  it("refuses invalid values and clearing the hold key", () => {
    const store = createSettingsStore(null, defaults);
    expect(() => store.update({ language: "xx" as never })).toThrow();
    expect(() => store.setShortcut("hold", null)).toThrow("always needs a key");
    expect(store.setShortcut("handsFree", null).handsFreeShortcut).toBeNull();
  });
});
