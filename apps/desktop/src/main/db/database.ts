import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import m0001 from "./migrations/0001_core_settings_dictation.sql?raw";
import m0002 from "./migrations/0002_pending_sessions.sql?raw";
import m0003 from "./migrations/0003_dictionary.sql?raw";
import m0004 from "./migrations/0004_snippets.sql?raw";
import m0005 from "./migrations/0005_styles.sql?raw";
import m0006 from "./migrations/0006_memory.sql?raw";
import m0007 from "./migrations/0007_learn_candidates.sql?raw";
import m0008 from "./migrations/0008_voice_profile.sql?raw";
import { migrateUp, parseMigration, type Migration } from "./migrate";

/** Every migration, in the order the files are numbered. */
export const MIGRATIONS: Migration[] = [
  parseMigration("0001_core_settings_dictation.sql", m0001),
  parseMigration("0002_pending_sessions.sql", m0002),
  parseMigration("0003_dictionary.sql", m0003),
  parseMigration("0004_snippets.sql", m0004),
  parseMigration("0005_styles.sql", m0005),
  parseMigration("0006_memory.sql", m0006),
  parseMigration("0007_learn_candidates.sql", m0007),
  parseMigration("0008_voice_profile.sql", m0008),
];

/** `<appData>/Murmur/murmur.db`, shared by the dev build and the packaged app. */
export function databasePath(appData: string): string {
  return path.join(appData, "Murmur", "murmur.db");
}

/**
 * Opens the database with the house pragmas and brings the schema up to date. Uses Node's
 * built-in SQLite, so there is no native module to rebuild for Electron.
 */
export function openDatabase(file: string, migrations: Migration[] = MIGRATIONS): DatabaseSync {
  // A first run has no data folder yet.
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  migrateUp(db, migrations);
  return db;
}
