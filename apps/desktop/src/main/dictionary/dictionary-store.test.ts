import { describe, expect, it, vi } from "vitest";
import { DICTIONARY_LIMITS, type DictionaryInput } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createDictionaryStore } from "./dictionary-store";

const term = (value: string, extra: Partial<DictionaryInput> = {}): DictionaryInput => ({
  term: value,
  replacement: null,
  caseSensitive: false,
  starred: false,
  ...extra,
});

function setup() {
  let clock = 1000;
  let id = 0;
  const db = openDatabase(":memory:");
  const store = createDictionaryStore(
    db,
    () => clock++,
    () => `id-${++id}`,
  );
  return { db, store };
}

describe("dictionary store", () => {
  it("adds, edits and removes entries, starred first", () => {
    const { store } = setup();
    expect(store.save(term("  Priya  "))).toMatchObject({ ok: true, entry: { term: "Priya" } });
    const added = store.save(term("Kubernetes", { starred: true }));
    expect(added.ok).toBe(true);
    expect(store.list().map((entry) => entry.term)).toEqual(["Kubernetes", "Priya"]);
    const id = added.ok ? added.entry.id : "";
    store.save({ ...term("Kubernetes", { starred: false }), id });
    expect(store.list().map((entry) => entry.term)).toEqual(["Kubernetes", "Priya"]);
    expect(store.list()[0]!.starred).toBe(false);
    store.remove(id);
    expect(store.list().map((entry) => entry.term)).toEqual(["Priya"]);
  });

  it("refuses duplicates in any case, and shows the entry already there", () => {
    const { store } = setup();
    store.save(term("GitHub"));
    const again = store.save(term("github"));
    expect(again).toMatchObject({ ok: false, reason: "duplicate", existing: { term: "GitHub" } });
    expect(store.save(term(" "))).toMatchObject({ ok: false, reason: "empty" });
    expect(store.save(term("x".repeat(DICTIONARY_LIMITS.termLength + 1)))).toMatchObject({
      ok: false,
      reason: "too-long",
    });
  });

  it("refuses a 201st star", () => {
    const { db, store } = setup();
    const insert = db.prepare(
      "INSERT INTO dictionary (id, term, source, starred, created_at, updated_at) VALUES (?, ?, 'manual', 1, 1, 1)",
    );
    for (let index = 0; index < DICTIONARY_LIMITS.starred; index++)
      insert.run(`s${index}`, `star${index}`);
    expect(store.save(term("one more", { starred: true }))).toMatchObject({
      ok: false,
      reason: "too-many-starred",
    });
    expect(store.save(term("one more"))).toMatchObject({ ok: true });
  });

  it("builds the rules: starred terms always, then the most used, replacements newest first", () => {
    const { db, store } = setup();
    store.save(term("Rarely"));
    store.save(term("Often"));
    store.save(term("Starred", { starred: true }));
    store.save(term("k8s", { replacement: "Kubernetes" }));
    store.save(term("my email", { replacement: "me@example.com" }));
    const often = store.list().find((entry) => entry.term === "Often")!;
    store.recordUses([often.id, often.id]);
    const rules = store.rules();
    expect(rules.promptTerms).toEqual(["Starred", "Often", "Rarely"]);
    expect(rules.replacements.map((rule) => rule.term)).toEqual(["my email", "k8s"]);
    expect(rules.spellings.map((rule) => rule.term).sort()).toEqual(["Often", "Rarely", "Starred"]);
    // Only the top ones by use go to the prompt; starred ones are never left out.
    const insert = db.prepare(
      "INSERT INTO dictionary (id, term, source, use_count, created_at, updated_at) VALUES (?, ?, 'manual', ?, 1, 1)",
    );
    for (let index = 0; index < DICTIONARY_LIMITS.promptTerms + 50; index++) {
      insert.run(`u${index}`, `used${index}`, 10 + index);
    }
    store.save(term("trigger a rebuild"));
    const many = store.rules().promptTerms;
    expect(many[0]).toBe("Starred");
    expect(many).toHaveLength(DICTIONARY_LIMITS.promptTerms + 1);
  });

  it("tells listeners about changes and loads 5,000 entries quickly", () => {
    const { db, store } = setup();
    const handler = vi.fn();
    store.onChange(handler);
    store.save(term("one"));
    expect(handler).toHaveBeenCalledOnce();
    const insert = db.prepare(
      "INSERT INTO dictionary (id, term, source, created_at, updated_at) VALUES (?, ?, 'manual', 1, 1)",
    );
    db.exec("BEGIN");
    for (let index = 0; index < DICTIONARY_LIMITS.entries - 1; index++)
      insert.run(`b${index}`, `bulk${index}`);
    db.exec("COMMIT");
    const started = performance.now();
    expect(store.list()).toHaveLength(DICTIONARY_LIMITS.entries);
    expect(performance.now() - started).toBeLessThan(300);
    expect(store.save(term("over"))).toMatchObject({ ok: false, reason: "full" });
  });
});
