import { describe, expect, it } from "vitest";
import type { Settings } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { keyPlatform } from "../platform";
import { createRewriteStore } from "./rewrite-store";
import {
  rewriteBindings,
  rewriteShortcutsInUse,
  setRewriteShortcut,
  withShortcutLabels,
} from "./rewrite-shortcuts";

const mac = keyPlatform("darwin");
const settings = {
  holdShortcut: { type: "key", keyCode: 61, modifiers: [] },
  handsFreeShortcut: null,
  rewriteShortcut: { type: "key", keyCode: 15, modifiers: ["control", "option"] },
} as unknown as Settings;

function setup() {
  const store = createRewriteStore(openDatabase(":memory:"));
  const deps = { store, settings: () => settings, platform: mac };
  return { store, deps };
}

describe("named Rewrite shortcuts", () => {
  it("saves a free chord and binds it while the Rewrite is on", () => {
    const { store, deps } = setup();
    expect(
      setRewriteShortcut(deps, "builtin:concise", {
        code: "KeyT",
        modifiers: ["control", "option"],
      }),
    ).toEqual({ ok: true });
    expect(rewriteBindings(store.list())).toEqual([
      {
        id: "rewrite:builtin:concise",
        action: "rewrite",
        trigger: { type: "key", keyCode: 17, modifiers: ["control", "option"] },
        mode: "press",
        rewriteId: "builtin:concise",
      },
    ]);
    store.setEnabled("builtin:concise", false);
    expect(rewriteBindings(store.list())).toEqual([]);
  });

  it("refuses a Settings shortcut, another Rewrite's, a lone modifier and plain letters", () => {
    const { deps } = setup();
    expect(
      setRewriteShortcut(deps, "builtin:clarify", {
        code: "KeyR",
        modifiers: ["option", "control"],
      }),
    ).toEqual({ ok: false, message: "Control+Option+R is already used for Rewrite." });
    setRewriteShortcut(deps, "builtin:concise", { code: "KeyT", modifiers: ["control", "option"] });
    expect(
      setRewriteShortcut(deps, "builtin:clarify", {
        code: "KeyT",
        modifiers: ["control", "option"],
      }),
    ).toEqual({
      ok: false,
      message: "Control+Option+T is already used for the “Tighten” Rewrite.",
    });
    expect(
      setRewriteShortcut(deps, "builtin:clarify", { code: "AltRight", modifiers: [] }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("on its own"),
    });
    expect(
      setRewriteShortcut(deps, "builtin:clarify", { code: "KeyT", modifiers: [] }),
    ).toMatchObject({
      ok: false,
    });
  });

  it("removes a shortcut, and names shortcuts for Settings and the Hub", () => {
    const { store, deps } = setup();
    setRewriteShortcut(deps, "builtin:concise", { code: "KeyT", modifiers: ["control", "option"] });
    expect(rewriteShortcutsInUse(store.list())).toEqual([
      {
        use: "the “Tighten” Rewrite",
        trigger: { type: "key", keyCode: 17, modifiers: ["control", "option"] },
      },
    ]);
    expect(withShortcutLabels(store.list(), mac)[1]!.shortcutLabel).toBe("Control+Option+T");
    expect(setRewriteShortcut(deps, "builtin:concise", null)).toEqual({ ok: true });
    expect(rewriteShortcutsInUse(store.list())).toEqual([]);
    expect(setRewriteShortcut(deps, "nope", null)).toMatchObject({ ok: false });
  });
});
