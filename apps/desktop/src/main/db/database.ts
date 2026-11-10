import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import m0001 from "./migrations/0001_core_settings_dictation.sql?raw";
import { migrateUp, parseMigration, type Migration } from "./migrate";

/** Every migration, in the order the files are numbered. */
export const MIGRATIONS: Migration[] = [parseMigration("0001_core_settings_dictation.sql", m0001)];

/** `<appData>/Murmur/murmur.db`, shared by the dev build and the packaged app. */
export function databasePath(appData: string): string {
  return path.join(appData, "Murmur", "murmur.db");
}

/**
 * Opens the database with the house pragmas and brings the schema up to date. Uses Node's
 * built-in SQLite, so there is no native module to rebuild for Electron.
 */
export function openDatabase(file: string, migrations: Migration[] = MIGRATIONS): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  migrateUp(db, migrations);
  return db;
}
