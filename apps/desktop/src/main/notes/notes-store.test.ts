import { describe, expect, it } from "vitest";
import { plainToRich } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createNotesStore } from "./notes-store";

function setup() {
  let clock = 1_000;
  let n = 0;
  const store = createNotesStore(
    openDatabase(":memory:"),
    () => (clock += 10),
    () => `note-${++n}`,
  );
  return store;
}

describe("notes store", () => {
  it("creates, saves and reads back a note", () => {
    const store = setup();
    const note = store.create("First line\nsecond");
    expect(note.plain).toBe("First line\nsecond");
    const saved = store.save({ id: note.id, title: "Plan", body: plainToRich("Buy milk") });
    expect(saved.ok).toBe(true);
    expect(store.get(note.id)).toMatchObject({ title: "Plan", plain: "Buy milk" });
    expect(store.count()).toBe(1);
  });

  it("lists newest first with the first line as preview", () => {
    const store = setup();
    const a = store.create("alpha");
    const b = store.create("beta");
    expect(store.list().map((item) => item.id)).toEqual([b.id, a.id]);
    expect(store.list()[0]!.preview).toEqual([{ text: "beta", hit: false }]);
    expect(store.list()[0]!.title).toBe("beta");
  });

  it("finds a word only in a body, marks it, and ranks title matches first", () => {
    const store = setup();
    const body = store.create("The zebra crossing is closed today");
    const titled = store.create("nothing here");
    store.save({ id: titled.id, title: "Zebra notes", body: plainToRich("stripes") });
    const results = store.list("zeb");
    expect(results.map((item) => item.id)).toEqual([titled.id, body.id]);
    const hit = results[1]!.preview.find((part) => part.hit);
    expect(hit?.text.toLowerCase()).toBe("zebra");
  });

  it("refuses a note over 500 KB", () => {
    const store = setup();
    const note = store.create();
    const result = store.save({ id: note.id, title: "", body: plainToRich("x".repeat(600_000)) });
    expect(result).toEqual({ ok: false, message: expect.stringContaining("500 KB") });
  });

  it("keeps control characters out, so search marks cannot be faked", () => {
    const store = setup();
    const note = store.create("a\u0001b\u0002c");
    expect(note.plain).toBe("abc");
  });

  it("deletes a note and its search entry", () => {
    const store = setup();
    const note = store.create("findme");
    store.remove(note.id);
    expect(store.get(note.id)).toBeNull();
    expect(store.list("findme")).toEqual([]);
  });
});

describe("note versions (HB-28)", () => {
  it("saves a version only when the note changed, and labelled ones on request", () => {
    const store = setup();
    const note = store.create("one");
    expect(store.saveVersion({ noteId: note.id, label: null, reason: "close" })).not.toBeNull();
    expect(store.saveVersion({ noteId: note.id, label: null, reason: "close" })).toBeNull();
    expect(store.saveVersion({ noteId: note.id, label: "Draft", reason: "manual" })).toMatchObject({
      label: "Draft",
      words: 1,
    });
  });

  it("waits five minutes between automatic versions", () => {
    let clock = 0;
    const store = createNotesStore(
      openDatabase(":memory:"),
      () => clock,
      () => `id-${clock}-${Math.random()}`,
    );
    const note = store.create("a");
    expect(store.saveVersion({ noteId: note.id, label: null, reason: "auto" })).not.toBeNull();
    clock = 60_000;
    store.save({ id: note.id, title: "", body: plainToRich("a b") });
    expect(store.saveVersion({ noteId: note.id, label: null, reason: "auto" })).toBeNull();
    clock = 6 * 60_000;
    expect(store.saveVersion({ noteId: note.id, label: null, reason: "auto" })).not.toBeNull();
  });

  it("restoring version 3 adds a new version with its text", () => {
    const store = setup();
    const note = store.create("v1");
    const ids: string[] = [];
    for (const text of ["v1", "v2", "v3", "v4"]) {
      store.save({ id: note.id, title: "", body: plainToRich(text) });
      ids.push(store.saveVersion({ noteId: note.id, label: null, reason: "close" })!.id);
    }
    const restored = store.restore(ids[2]!);
    expect(restored?.plain).toBe("v3");
    const versions = store.versions(note.id);
    expect(versions[0]!.label).toMatch(/^Restored from/);
    expect(store.versionText(versions[0]!.id)?.plain).toBe("v3");
    expect(versions).toHaveLength(5);
  });

  it("keeps the newest 50: the 51st deletes the oldest", () => {
    const store = setup();
    const note = store.create("start");
    let first: string | null = null;
    for (let i = 0; i < 51; i++) {
      store.save({ id: note.id, title: "", body: plainToRich(`text ${i}`) });
      const version = store.saveVersion({ noteId: note.id, label: null, reason: "close" })!;
      first ??= version.id;
    }
    const versions = store.versions(note.id);
    expect(versions).toHaveLength(50);
    expect(versions.some((item) => item.id === first)).toBe(false);
  });

  it("deletes versions with their note", () => {
    const store = setup();
    const note = store.create("x");
    store.saveVersion({ noteId: note.id, label: "keep", reason: "manual" });
    store.remove(note.id);
    expect(store.versions(note.id)).toEqual([]);
  });
});

describe("pinned notes (HB-29)", () => {
  it("puts pinned notes first in pin order, and refuses the 21st", () => {
    const store = setup();
    const notes = Array.from({ length: 22 }, (_, i) => store.create(`note ${i}`));
    for (let i = 0; i < 20; i++) expect(store.pin(notes[i]!.id, true)).toEqual({ ok: true });
    expect(store.pin(notes[20]!.id, true)).toEqual({
      ok: false,
      message: expect.stringContaining("20"),
    });
    const list = store.list();
    expect(list.slice(0, 20).every((item) => item.pinned)).toBe(true);
    expect(list[0]!.id).toBe(notes[0]!.id);
  });

  it("moves a pinned note and keeps the order", () => {
    const store = setup();
    const [a, b, c] = [store.create("a"), store.create("b"), store.create("c")];
    for (const note of [a, b, c]) store.pin(note.id, true);
    store.movePin(c.id, -1);
    expect(
      store
        .list()
        .map((item) => item.id)
        .slice(0, 3),
    ).toEqual([a.id, c.id, b.id]);
    store.pin(a.id, false);
    expect(
      store
        .list()
        .map((item) => item.id)
        .slice(0, 2),
    ).toEqual([c.id, b.id]);
  });
});
