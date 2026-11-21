import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MIGRATIONS, openDatabase } from "./database";
import { migrateDown, migrateUp, orderMigrations, parseMigration, schemaVersion } from "./migrate";

function tables(db: DatabaseSync): string[] {
  return (
    // `sqlite_sequence` is SQLite's own table for AUTOINCREMENT; it stays after a table is dropped.
    (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'sqlite_sequence' ORDER BY name",
        )
        .all() as {
        name: string;
      }[]
    ).map((row) => row.name)
  );
}

describe("migrations", () => {
  it("runs up, records the version, and runs down cleanly", () => {
    const db = new DatabaseSync(":memory:");
    const versions = MIGRATIONS.map((_, index) => index + 1);
    const latest = versions.length;
    expect(migrateUp(db, MIGRATIONS, 1000)).toEqual(versions);
    expect(schemaVersion(db)).toBe(latest);
    expect(tables(db)).toEqual([
      "app_categories",
      "ask_chunks",
      "ask_fts",
      "ask_fts_config",
      "ask_fts_data",
      "ask_fts_docsize",
      "ask_fts_idx",
      "ask_index",
      "ask_messages",
      "ask_threads",
      "audio_chunks",
      "command_runs",
      "dictionary",
      "focus_rules",
      "focus_sessions",
      "folder_suggestion_dismissals",
      "folders",
      "history",
      "history_fts",
      "history_fts_config",
      "history_fts_data",
      "history_fts_docsize",
      "history_fts_idx",
      "insights_daily",
      "insights_meta",
      "instruct_history",
      "instruct_threads",
      "learn_candidates",
      "meeting_audio_chunks",
      "meeting_docs",
      "meeting_jobs",
      "meeting_notes",
      "meeting_segments",
      "meeting_speakers",
      "meeting_summaries",
      "meetings",
      "memory_items",
      "milestones",
      "note_images",
      "note_rewrites",
      "note_versions",
      "notes",
      "notes_fts",
      "notes_fts_config",
      "notes_fts_data",
      "notes_fts_docsize",
      "notes_fts_idx",
      "pending_sessions",
      "phrase_counts",
      "retention_jobs",
      "rewrite_runs",
      "rewrites",
      "schema_migrations",
      "settings",
      "skill_versions",
      "skills",
      "snippets",
      "styles",
      "tasks",
      "transcript_corrections",
      "transcript_versions",
      "voice_profiles",
      "voice_samples",
      "writing_samples",
    ]);
    const rows = db.prepare("SELECT version, name, applied_at FROM schema_migrations").all();
    expect(rows).toEqual(
      MIGRATIONS.map((migration, index) => ({
        version: index + 1,
        name: migration.name,
        applied_at: 1000,
      })),
    );

    expect(migrateDown(db, MIGRATIONS, 1)).toEqual(versions.slice(1).reverse());
    expect(tables(db)).not.toContain("pending_sessions");
    expect(tables(db)).not.toContain("dictionary");
    expect(migrateDown(db, MIGRATIONS, 0)).toEqual([1]);
    expect(schemaVersion(db)).toBe(0);
    expect(tables(db)).toEqual(["schema_migrations"]);

    expect(migrateUp(db, MIGRATIONS)).toEqual(versions);
    expect(migrateUp(db, MIGRATIONS)).toEqual([]);
  });

  it("refuses a migration edited after it was applied", () => {
    const db = new DatabaseSync(":memory:");
    migrateUp(db, MIGRATIONS);
    const edited = [{ ...MIGRATIONS[0]!, checksum: "different" }];
    expect(() => migrateUp(db, edited)).toThrow("was edited after it was applied");
  });

  it("refuses a database from a newer app", () => {
    const db = new DatabaseSync(":memory:");
    const extra = parseMigration(
      `${String(MIGRATIONS.length + 1).padStart(4, "0")}_extra.sql`,
      "-- migrate:up\nCREATE TABLE x (a);\n-- migrate:down\nDROP TABLE x;",
    );
    migrateUp(db, [...MIGRATIONS, extra]);
    expect(() => migrateUp(db, MIGRATIONS)).toThrow("does not know");
  });

  it("rolls a failing migration back and leaves the version alone", () => {
    const db = new DatabaseSync(":memory:");
    migrateUp(db, MIGRATIONS);
    const broken = parseMigration(
      `${String(MIGRATIONS.length + 1).padStart(4, "0")}_broken.sql`,
      "-- migrate:up\nCREATE TABLE half (a);\nCREATE TABLE settings (a);\n-- migrate:down\nDROP TABLE half;",
    );
    expect(() => migrateUp(db, [...MIGRATIONS, broken])).toThrow();
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    expect(tables(db)).not.toContain("half");
  });

  it("checks file names, sections and numbering", () => {
    expect(() => parseMigration("1_bad.sql", "-- migrate:up\n-- migrate:down")).toThrow("NNNN");
    expect(() => parseMigration("0001_ok.sql", "CREATE TABLE x (a);")).toThrow("sections");
    const two = parseMigration("0002_two.sql", "-- migrate:up\n-- migrate:down");
    expect(() => orderMigrations([two])).toThrow("no gaps");
  });

  it("creates the data folder on a first run", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "murmur-db-"));
    try {
      const file = path.join(root, "Murmur", "murmur.db");
      openDatabase(file).close();
      expect(existsSync(file)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("opens with the house pragmas", () => {
    const db = openDatabase(":memory:");
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
  });
});
