import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { createMeetingNotesStore, cleanLink } from "./meeting-notes-store";
import { createMeetingsStore } from "./meetings-store";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "murmur-docs-"));
  dirs.push(dir);
  const db = openDatabase(":memory:");
  createMeetingsStore(db).create({
    id: "m",
    title: "Sync",
    startedAt: 0,
    source: "ad_hoc",
    folder: path.join(dir, "m"),
  });
  let n = 0;
  const store = createMeetingNotesStore(
    db,
    () => 100,
    () => `doc-${++n}`,
  );
  return { dir, db, store };
}

describe("meeting notes and docs", () => {
  it("saves notes and refuses ones over the limit", () => {
    const { store } = setup();
    expect(store.notes("m")).toEqual({ body: "", updatedAt: null });
    expect(store.saveNotes("m", "Agenda: @[contact:1|Priya]")).toBe(true);
    expect(store.notes("m")).toEqual({ body: "Agenda: @[contact:1|Priya]", updatedAt: 100 });
    expect(store.saveNotes("m", "x".repeat(200_001))).toBe(false);
  });

  it("keeps web links only, titled by host when no title is given", () => {
    const { store } = setup();
    expect(cleanLink("javascript:alert(1)")).toBeNull();
    expect(store.addLink("m", "file:///etc/passwd", "")).toMatchObject({ ok: false });
    const added = store.addLink("m", "https://example.com/spec", "");
    expect(added).toMatchObject({ ok: true, doc: { title: "example.com", kind: "link" } });
    expect(store.target("doc-1")).toEqual({ kind: "link", value: "https://example.com/spec" });
  });

  it("copies a file so it stays openable after the original is deleted", () => {
    const { dir, store } = setup();
    const source = path.join(dir, "agenda.txt");
    writeFileSync(source, "items");
    const added = store.addFile("m", path.join(dir, "m"), source);
    expect(added).toMatchObject({ ok: true, doc: { title: "agenda.txt", bytes: 5 } });
    rmSync(source);
    const target = store.target("doc-1")!;
    expect(readFileSync(target.value, "utf8")).toBe("items");
    store.removeDoc("doc-1");
    expect(existsSync(target.value)).toBe(false);
    expect(store.docs("m")).toEqual([]);
  });
});
