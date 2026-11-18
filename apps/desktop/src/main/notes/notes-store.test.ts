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
