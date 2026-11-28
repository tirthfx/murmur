import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE_CATEGORIES } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createHistoryStore } from "../history/history-store";
import { createMeetingsStore } from "../meetings/meetings-store";
import { createNotesStore } from "../notes/notes-store";
import type { DictationRecord } from "../recorder";
import { createDataDeleter } from "./data-delete";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "delete-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const db = openDatabase(":memory:");
  const audioRoot = path.join(dir, "audio");
  const notesRoot = path.join(dir, "notes");
  mkdirSync(path.join(audioRoot, "tmp"), { recursive: true });
  mkdirSync(path.join(notesRoot, "n1"), { recursive: true });
  writeFileSync(path.join(notesRoot, "n1", "img.jpg"), "jpg");
  const history = createHistoryStore(db, audioRoot);
  const file = path.join(audioRoot, "tmp", "a.pcm");
  writeFileSync(file, "pcm");
  const record: DictationRecord = {
    sessionId: "a",
    source: "hold",
    createdAt: 1,
    durationMs: 1000,
    language: "en",
    rawText: "hi",
    finalText: "Hi.",
    wordCount: 1,
    cleanup: null,
    insertStatus: "inserted",
    insertMethod: "paste_cmd_v",
    errorCode: null,
    audio: { path: file, codec: "pcm_s16le", durationMs: 1000 },
    retryOf: null,
  };
  history.add(record);
  db.prepare(
    "INSERT INTO dictionary (id, term, case_sensitive, source, starred, use_count, created_at, updated_at) VALUES ('d', 'Murmur', 0, 'manual', 0, 0, 1, 1)",
  ).run();
  db.prepare(
    "INSERT INTO snippets (id, trigger_phrase, body, body_format, use_count, created_at, updated_at) VALUES ('s', 'addr', 'x', 'plain', 0, 1, 1)",
  ).run();
  createNotesStore(db).create("note");
  const meetingsRoot = path.join(dir, "meetings");
  mkdirSync(path.join(meetingsRoot, "m1"), { recursive: true });
  writeFileSync(path.join(meetingsRoot, "m1", "mic-000001.m4a"), "aac");
  const meetings = createMeetingsStore(db);
  meetings.create({ id: "m1", title: "Sync", startedAt: 1, source: "ad_hoc", folder: "m1" });
  meetings.addChunk({
    meetingId: "m1",
    channel: "mic",
    seq: 1,
    path: path.join(meetingsRoot, "m1", "mic-000001.m4a"),
    sha256: "a".repeat(64),
    bytes: 3,
    startMs: 0,
    durationMs: 1000,
  });
  const deleter = createDataDeleter({
    db,
    history,
    notesRoot,
    audioRoot,
    clipsRoot: null,
    meetingsRoot,
    skillsRoot: path.join(dir, "Skills"),
  });
  return { db, deleter, file, notesRoot, meetingsRoot };
}

const rows = (db: ReturnType<typeof openDatabase>, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("delete by category (HB-47)", () => {
  it("counts each category", () => {
    const { deleter } = setup();
    const counts = Object.fromEntries(
      deleter.counts().categories.map((item) => [item.category, item.count]),
    );
    expect(counts).toMatchObject({ dictations: 1, audio: 1, dictionary: 1, snippets: 1, notes: 1 });
  });

  it("deleting dictations leaves Dictionary and Snippets unchanged, and removes the audio", () => {
    const { db, deleter, file } = setup();
    expect(deleter.delete("dictations")).toMatchObject({ rows: 1, files: 1 });
    expect(rows(db, "history")).toBe(0);
    expect(existsSync(file)).toBe(false);
    expect(rows(db, "dictionary")).toBe(1);
    expect(rows(db, "snippets")).toBe(1);
  });

  it("deletes notes with their image files", () => {
    const { db, deleter, notesRoot } = setup();
    deleter.delete("notes");
    expect(rows(db, "notes")).toBe(0);
    expect(existsSync(path.join(notesRoot, "n1"))).toBe(false);
  });

  it("deletes meetings with their chunk rows and audio files", () => {
    const { db, deleter, meetingsRoot } = setup();
    expect(deleter.counts().categories.find((item) => item.category === "meetings")).toMatchObject({
      count: 1,
      bytes: 3,
    });
    expect(deleter.delete("meetings")).toMatchObject({ rows: 1, files: 1 });
    expect(rows(db, "meetings")).toBe(0);
    expect(rows(db, "meeting_audio_chunks")).toBe(0);
    expect(existsSync(path.join(meetingsRoot, "m1"))).toBe(false);
  });

  it("also deletes the tasks taken from meetings and the Ask conversations, but not tasks written by hand", () => {
    const { db, deleter } = setup();
    const at = Date.now();
    const task = db.prepare(
      `INSERT INTO tasks (id, title, status, source, meeting_id, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    );
    task.run("t1", "From a meeting", "open", "meeting", "m1", at, at);
    task.run("t2", "By hand", "open", "manual", null, at, at);
    db.prepare(
      "INSERT INTO ask_threads (id, title, scope_json, created_at, updated_at) VALUES ('a1', 'Q', '{\"kind\":\"all\"}', ?, ?)",
    ).run(at, at);
    db.prepare(
      "INSERT INTO ask_messages (id, thread_id, seq, role, text, created_at) VALUES ('x1', 'a1', 1, 'user', 'Q', ?)",
    ).run(at);
    db.prepare(
      "INSERT INTO ask_chunks (meeting_id, source, text) VALUES ('m1', 'transcript', 'secret words')",
    ).run();
    deleter.delete("meetings");
    expect(rows(db, "tasks")).toBe(1);
    expect(db.prepare("SELECT title FROM tasks").get()).toEqual({ title: "By hand" });
    expect(rows(db, "ask_threads")).toBe(0);
    expect(rows(db, "ask_messages")).toBe(0);
    expect(rows(db, "ask_chunks")).toBe(0);
  });

  it("deletes recordings but keeps the dictations", () => {
    const { db, deleter, file } = setup();
    deleter.delete("audio");
    expect(existsSync(file)).toBe(false);
    expect(rows(db, "history")).toBe(1);
  });

  it("reset leaves no data rows and no settings", () => {
    const { db, deleter } = setup();
    db.prepare(
      "INSERT INTO settings (key, value_json, updated_at) VALUES ('onboarding.complete', 'true', 1)",
    ).run();
    deleter.deleteAll();
    for (const table of [
      "history",
      "dictionary",
      "snippets",
      "notes",
      "memory_items",
      "settings",
      "insights_daily",
      "meetings",
    ]) {
      expect(rows(db, table), table).toBe(0);
    }
    // Built-in Rewrites and the four default styles stay.
    expect(rows(db, "styles")).toBe(4);
    expect(DELETE_CATEGORIES.length).toBeGreaterThan(5);
  });
});

describe("what reset covers (HB-47)", () => {
  it("empties every table: a new one has to be added to a delete", () => {
    const db = openDatabase(":memory:");
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    )
      .map((row) => row.name)
      .filter((name) => !name.startsWith("sqlite_") && !name.includes("_fts"));
    const source = readFileSync(new URL("./data-delete.ts", import.meta.url), "utf8");
    // Emptied by name, or by the history store; the styles are put back to their defaults.
    const covered = new Set([
      ...[...source.matchAll(/DELETE FROM (\w+)/g)].map((match) => match[1]!),
      "history",
      "styles",
      "schema_migrations",
    ]);
    for (let grew = true; grew;) {
      grew = false;
      for (const table of tables) {
        const keys = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as {
          table: string;
          on_delete: string;
        }[];
        if (
          !covered.has(table) &&
          keys.some((key) => covered.has(key.table) && key.on_delete === "CASCADE")
        ) {
          covered.add(table);
          grew = true;
        }
      }
    }
    expect(tables.filter((table) => !covered.has(table))).toEqual([]);
  });
});
