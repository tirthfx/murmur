import type { DatabaseSync } from "node:sqlite";

/**
 * The server's own schema, in numbered steps. Each step runs once, in a transaction, and is
 * recorded. A step is never edited after it has shipped: a change is a new step.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "accounts_and_sessions",
    sql: `
      CREATE TABLE users (
        id                  TEXT PRIMARY KEY,
        email               TEXT NOT NULL UNIQUE,
        name                TEXT NOT NULL,
        password_hash       TEXT NOT NULL,
        is_owner            INTEGER NOT NULL DEFAULT 0,
        status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
        created_at          INTEGER NOT NULL,
        password_changed_at INTEGER NOT NULL
      );
      -- At most one owner.
      CREATE UNIQUE INDEX users_one_owner ON users (is_owner) WHERE is_owner = 1;

      CREATE TABLE password_history (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        password_hash TEXT NOT NULL,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX password_history_user ON password_history (user_id, id);

      -- Only the hash of a session token is kept.
      CREATE TABLE sessions (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        token_hash   TEXT NOT NULL UNIQUE,
        client_id    TEXT NOT NULL DEFAULT '',
        created_at   INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        revoked_at   INTEGER
      );
      CREATE INDEX sessions_user ON sessions (user_id);

      -- Wrong passwords in a row for an address, whether or not an account has it.
      CREATE TABLE sign_in_throttle (
        email        TEXT PRIMARY KEY,
        failures     INTEGER NOT NULL,
        locked_until INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
];

export function migrate(db: DatabaseSync, migrations: readonly Migration[] = MIGRATIONS): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
  const done = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map(
      (row) => row.version,
    ),
  );
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1)
      throw new Error(`Migrations must be numbered from 1 with no gaps (found ${migration.name})`);
  });
  for (const migration of migrations) {
    if (done.has(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        Date.now(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return migrations.length;
}
