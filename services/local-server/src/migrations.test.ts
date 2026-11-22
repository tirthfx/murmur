import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MIGRATIONS, migrate } from "./migrations.ts";

describe("migrations", () => {
  it("run once and are numbered from 1 with no gaps", () => {
    MIGRATIONS.forEach((migration, index) => expect(migration.version).toBe(index + 1));
    const db = new DatabaseSync(":memory:");
    migrate(db);
    migrate(db);
    const rows = db.prepare("SELECT version FROM schema_migrations").all();
    expect(rows).toHaveLength(MIGRATIONS.length);
  });

  it("refuses a gap, and leaves nothing behind when a step fails", () => {
    const db = new DatabaseSync(":memory:");
    expect(() => migrate(db, [{ version: 2, name: "late", sql: "SELECT 1" }])).toThrow(/no gaps/);
    expect(() =>
      migrate(db, [
        { version: 1, name: "bad", sql: "CREATE TABLE t (a); SELECT nope FROM missing" },
      ]),
    ).toThrow();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE name = 't'").all();
    expect(tables).toHaveLength(0);
  });

  it("allows only one owner", () => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    const add = (id: string, email: string) =>
      db
        .prepare(
          "INSERT INTO users (id, email, name, password_hash, is_owner, created_at, password_changed_at) VALUES (?, ?, 'n', 'h', 1, 0, 0)",
        )
        .run(id, email);
    add("1", "a@example.com");
    expect(() => add("2", "b@example.com")).toThrow();
  });
});
