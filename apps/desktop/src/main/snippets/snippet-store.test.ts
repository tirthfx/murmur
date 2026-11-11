import { describe, expect, it } from "vitest";
import { SNIPPET_LIMITS, type RichDoc, type SnippetInput } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createSnippetStore } from "./snippet-store";

const plain = (trigger: string, body: string, id?: string): SnippetInput => ({
  ...(id ? { id } : {}),
  trigger,
  plain: body,
  rich: null,
});

function setup() {
  let id = 0;
  const db = openDatabase(":memory:");
  return {
    db,
    store: createSnippetStore(
      db,
      () => 5,
      () => `s${++id}`,
    ),
  };
}

describe("snippet store", () => {
  it("saves plain and rich bodies, and keeps a document without marks as plain", () => {
    const { store } = setup();
    const address = store.save(plain("my address", "12 Hill Road\nPune"));
    expect(address).toMatchObject({
      ok: true,
      snippet: { format: "plain", plain: "12 Hill Road\nPune" },
    });
    const rich: RichDoc = {
      blocks: [
        { type: "paragraph", inlines: [{ text: "Best, " }, { text: "Tirth", bold: true }] },
        { type: "bullet", items: [[{ text: "one" }], [{ text: "two" }]] },
      ],
    };
    const sign = store.save({ trigger: "sign off", plain: "", rich });
    expect(sign).toMatchObject({
      ok: true,
      snippet: { format: "rich_json", plain: "Best, Tirth\n• one\n• two", rich },
    });
    const flat = store.save({
      trigger: "just text",
      plain: "",
      rich: { blocks: [{ type: "paragraph", inlines: [{ text: "hi" }] }] },
    });
    expect(flat).toMatchObject({ ok: true, snippet: { format: "plain", plain: "hi", rich: null } });
    expect(store.list().map((snippet) => snippet.trigger)).toEqual([
      "just text",
      "my address",
      "sign off",
    ]);
  });

  it("refuses duplicate triggers, bad lengths, empty and oversized bodies", () => {
    const { store } = setup();
    store.save(plain("my address", "x"));
    expect(store.save(plain("My Address!", "y"))).toMatchObject({ ok: false, reason: "duplicate" });
    expect(store.save(plain("a", "y"))).toMatchObject({ ok: false, reason: "trigger-length" });
    expect(store.save(plain("...", "y"))).toMatchObject({ ok: false, reason: "empty-trigger" });
    expect(store.save(plain("empty one", "  "))).toMatchObject({ ok: false, reason: "empty-body" });
    expect(store.save(plain("big one", "x".repeat(SNIPPET_LIMITS.bodyBytes + 1)))).toMatchObject({
      ok: false,
      reason: "too-large",
    });
  });

  it("edits, counts uses and deletes", () => {
    const { store } = setup();
    const saved = store.save(plain("my address", "old"));
    const id = saved.ok ? saved.snippet.id : "";
    expect(store.save(plain("my address", "new", id))).toMatchObject({
      ok: true,
      snippet: { plain: "new" },
    });
    store.recordUse(id);
    expect(store.list()[0]!.useCount).toBe(1);
    store.remove(id);
    expect(store.list()).toEqual([]);
    expect(store.save(plain("gone", "x", id))).toMatchObject({ ok: false, reason: "not-found" });
  });
});
