import { describe, expect, it } from "vitest";
import { BUILTIN_REWRITES, REWRITE_LIMITS } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createRewriteStore } from "./rewrite-store";

function setup(db = openDatabase(":memory:")) {
  let clock = 1;
  let id = 0;
  const store = createRewriteStore(
    db,
    () => clock++,
    () => `r${++id}`,
  );
  return { db, store };
}

const custom = {
  name: "Customer reply",
  instruction: "Turn this into a short, warm reply that thanks the customer and offers a call.",
  example: null,
  enabled: true,
};

describe("rewrites", () => {
  it("starts with the five built-ins, all on, in the default order", () => {
    const { store } = setup();
    const list = store.list();
    expect(list.map((rewrite) => rewrite.name)).toEqual([
      "Clarify",
      "Tighten",
      "Keep tone",
      "Structure",
      "Reorder",
    ]);
    expect(list.every((rewrite) => rewrite.enabled && rewrite.builtinKey !== null)).toBe(true);
    expect(list[1]).toMatchObject({
      builtinKey: "concise",
      description: BUILTIN_REWRITES[1]!.description,
      instruction: BUILTIN_REWRITES[1]!.instruction,
      applyDirectly: true,
      autoApply: false,
      autoApplyMinWords: 0,
      autoApplyCategories: ["personal", "work", "email", "other"],
      shortcut: null,
    });
  });

  it("keeps the owner's switches when opened again, and refreshes built-in wording", () => {
    const { db, store } = setup();
    store.setEnabled("builtin:reorder", false);
    db.prepare("UPDATE rewrites SET prompt = 'old wording' WHERE builtin_key = 'clarify'").run();
    const again = setup(db).store;
    expect(again.list()).toHaveLength(5);
    expect(again.get("builtin:reorder")?.enabled).toBe(false);
    expect(again.get("builtin:clarify")?.instruction).toBe(BUILTIN_REWRITES[0]!.instruction);
  });

  it("adds a custom Rewrite at the end, and edits change the next read", () => {
    const { store } = setup();
    const saved = store.save(custom);
    expect(saved).toMatchObject({
      ok: true,
      rewrite: { name: "Customer reply", builtinKey: null },
    });
    expect(store.enabled().at(-1)?.name).toBe("Customer reply");
    const id = saved.ok ? saved.rewrite.id : "";
    store.save({ ...custom, id, instruction: "Reply in one sentence." });
    expect(store.get(id)?.instruction).toBe("Reply in one sentence.");
  });

  it("refuses bad input with a message", () => {
    const { store } = setup();
    expect(store.save({ ...custom, name: "  " })).toMatchObject({
      ok: false,
      reason: "empty-name",
    });
    expect(store.save({ ...custom, name: "x".repeat(41) })).toMatchObject({
      reason: "name-too-long",
    });
    expect(store.save({ ...custom, instruction: "x".repeat(1001) })).toMatchObject({
      reason: "instruction-too-long",
      message: "An instruction can be at most 1,000 characters.",
    });
    expect(store.save({ ...custom, example: "x".repeat(1001) })).toMatchObject({
      reason: "example-too-long",
    });
    expect(store.save({ ...custom, name: "clarify" })).toMatchObject({ reason: "duplicate-name" });
    expect(store.save({ ...custom, id: "nope" })).toMatchObject({ reason: "not-found" });
  });

  it("never edits or deletes a built-in", () => {
    const { store } = setup();
    expect(store.save({ ...custom, id: "builtin:clarify" })).toMatchObject({ reason: "built-in" });
    expect(store.remove("builtin:clarify")).toMatchObject({ ok: false, reason: "built-in" });
    expect(store.list()).toHaveLength(5);
  });

  it("holds at most 50 custom Rewrites", () => {
    const { store } = setup();
    for (let n = 0; n < REWRITE_LIMITS.custom; n++) {
      expect(store.save({ ...custom, name: `Mine ${n}` }).ok).toBe(true);
    }
    expect(store.save({ ...custom, name: "One more" })).toMatchObject({ reason: "full" });
  });

  it("duplicates any Rewrite as a custom copy right after it", () => {
    const { store } = setup();
    const copy = store.duplicate("builtin:concise");
    expect(copy).toMatchObject({
      ok: true,
      rewrite: {
        name: "Tighten copy",
        builtinKey: null,
        instruction: BUILTIN_REWRITES[1]!.instruction,
      },
    });
    expect(
      store
        .list()
        .map((rewrite) => rewrite.name)
        .slice(0, 3),
    ).toEqual(["Clarify", "Tighten", "Tighten copy"]);
    expect(store.duplicate("builtin:concise")).toMatchObject({
      rewrite: { name: "Tighten copy 2" },
    });
  });

  it("moves up and down, and stays put at the ends", () => {
    const { store } = setup();
    store.move("builtin:reorder", -1);
    expect(
      store
        .list()
        .map((rewrite) => rewrite.builtinKey)
        .slice(3),
    ).toEqual(["reorder", "structure"]);
    store.move("builtin:clarify", -1);
    store.move("builtin:structure", 1);
    expect(store.list()[0]!.builtinKey).toBe("clarify");
    expect(store.list().map((rewrite) => rewrite.sortOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  it("deletes a custom Rewrite, and counts runs", () => {
    const { store } = setup();
    const saved = store.save(custom);
    const id = saved.ok ? saved.rewrite.id : "";
    store.markUsed(id);
    store.markUsed(id);
    expect(store.get(id)?.useCount).toBe(2);
    expect(store.remove(id)).toBeNull();
    expect(store.get(id)).toBeNull();
  });

  it("switching off removes it from the panel list", () => {
    const { store } = setup();
    store.setEnabled("builtin:structure", false);
    expect(store.enabled().map((rewrite) => rewrite.name)).not.toContain("Structure");
  });
});
