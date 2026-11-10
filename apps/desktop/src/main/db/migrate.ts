import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
  checksum: string;
}

const UP = "-- migrate:up";
const DOWN = "-- migrate:down";

/** Reads `NNNN_name.sql` with `-- migrate:up` and `-- migrate:down` sections. */
export function parseMigration(fileName: string, content: string): Migration {
  const match = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(fileName);
  if (!match) throw new Error(`Migration file name must be NNNN_snake_case.sql: ${fileName}`);
  const upAt = content.indexOf(UP);
  const downAt = content.indexOf(DOWN);
  if (upAt === -1 || downAt === -1 || downAt < upAt) {
    throw new Error(`${fileName} needs "${UP}" then "${DOWN}" sections`);
  }
  return {
    version: Number(match[1]),
    name: `${match[1]}_${match[2]}`,
    up: content.slice(upAt + UP.length, downAt).trim(),
    down: content.slice(downAt + DOWN.length).trim(),
    checksum: createHash("sha256").update(content).digest("hex"),
  };
}

/** Sorted by version, checked for gaps and duplicates. */
export function orderMigrations(migrations: Migration[]): Migration[] {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  sorted.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `Migrations must be numbered from 0001 with no gaps (found ${migration.name})`,
      );
    }
  });
  return sorted;
}

interface Applied {
  version: number;
  name: string;
  checksum: string;
}

function ensureTable(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
}

function applied(db: DatabaseSync): Applied[] {
  return db
    .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
    .all() as unknown as Applied[];
}

function inTransaction(db: DatabaseSync, work: () => void): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    work();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function schemaVersion(db: DatabaseSync): number {
  ensureTable(db);
  return applied(db).at(-1)?.version ?? 0;
}

/**
 * Applies every pending migration, each in its own transaction. Refuses to run if a migration
 * that was already applied has changed since (its checksum differs): shipped migrations are
 * never edited.
 */
export function migrateUp(db: DatabaseSync, migrations: Migration[], now = Date.now()): number[] {
  ensureTable(db);
  const ordered = orderMigrations(migrations);
  const done = new Map(applied(db).map((row) => [row.version, row]));
  for (const [version, row] of done) {
    const known = ordered.find((migration) => migration.version === version);
    if (!known)
      throw new Error(`The database has migration ${row.name}, which this app does not know`);
    if (known.checksum !== row.checksum)
      throw new Error(`Migration ${row.name} was edited after it was applied`);
  }
  const ran: number[] = [];
  for (const migration of ordered) {
    if (done.has(migration.version)) continue;
    inTransaction(db, () => {
      db.exec(migration.up);
      db.prepare(
        "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      ).run(migration.version, migration.name, migration.checksum, now);
    });
    ran.push(migration.version);
  }
  return ran;
}

/** Undoes migrations newer than `target`, newest first. */
export function migrateDown(db: DatabaseSync, migrations: Migration[], target: number): number[] {
  ensureTable(db);
  const ordered = orderMigrations(migrations);
  const undone: number[] = [];
  for (const row of [...applied(db)].reverse()) {
    if (row.version <= target) break;
    const migration = ordered.find((item) => item.version === row.version);
    if (!migration) throw new Error(`No down step for ${row.name}`);
    inTransaction(db, () => {
      db.exec(migration.down);
      db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(row.version);
    });
    undone.push(row.version);
  }
  return undone;
}
