import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { FOCUS_LIMITS, type FocusEndReason, type FocusRule } from "@murmur/shared";

export interface FocusStore {
  /** Blocked apps, by name. */
  apps(): FocusRule[];
  /** Blocked sites, A to Z. */
  sites(): FocusRule[];
  /** Every rule, apps then sites. */
  all(): FocusRule[];
  /** Adds a blocked app; refused when it is already there or the list is full. */
  addApp(bundleId: string, label: string): FocusRule | "duplicate" | "limit";
  /** Adds a blocked site (`domain` or `domain/path`); refused the same way. */
  addSite(value: string): FocusRule | "duplicate" | "limit";
  remove(id: string): void;
  /** Starts a session row; returns its id. */
  start(plannedMs: number | null): string;
  end(id: string, reason: FocusEndReason): void;
  /** Ends any session left open by a crash, as `quit`. Returns how many. */
  endOpen(reason: FocusEndReason): number;
}

interface RuleRow {
  id: string;
  kind: "app" | "site";
  value: string;
  label: string;
  created_at: number;
}

const toRule = (row: RuleRow): FocusRule => ({
  id: row.id,
  kind: row.kind,
  value: row.value,
  label: row.label,
  createdAt: row.created_at,
});

/** `focus_rules` and `focus_sessions` (migration 0016). */
export function createFocusStore(
  db: DatabaseSync,
  now: () => number = Date.now,
  newId: () => string = randomUUID,
): FocusStore {
  function list(kind: "app" | "site"): FocusRule[] {
    const rows = db
      .prepare("SELECT * FROM focus_rules WHERE kind = ? ORDER BY label COLLATE NOCASE")
      .all(kind) as unknown as RuleRow[];
    return rows.map(toRule);
  }

  function add(
    kind: "app" | "site",
    value: string,
    label: string,
    limit: number,
  ): FocusRule | "duplicate" | "limit" {
    const existing = db
      .prepare("SELECT id FROM focus_rules WHERE kind = ? AND value = ?")
      .get(kind, value);
    if (existing) return "duplicate";
    const count = (
      db.prepare("SELECT COUNT(*) AS n FROM focus_rules WHERE kind = ?").get(kind) as { n: number }
    ).n;
    if (count >= limit) return "limit";
    const rule: FocusRule = { id: newId(), kind, value, label, createdAt: now() };
    db.prepare(
      "INSERT INTO focus_rules (id, kind, value, label, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(rule.id, kind, rule.value, rule.label, rule.createdAt);
    return rule;
  }

  return {
    apps: () => list("app"),
    sites: () => list("site"),
    all: () => [...list("app"), ...list("site")],
    addApp: (bundleId, label) => add("app", bundleId, label, FOCUS_LIMITS.apps),
    addSite: (value) => add("site", value, value, FOCUS_LIMITS.sites),
    remove(id) {
      db.prepare("DELETE FROM focus_rules WHERE id = ?").run(id);
    },
    start(plannedMs) {
      const id = newId();
      db.prepare("INSERT INTO focus_sessions (id, started_at, planned_ms) VALUES (?, ?, ?)").run(
        id,
        now(),
        plannedMs,
      );
      return id;
    },
    end(id, reason) {
      db.prepare(
        "UPDATE focus_sessions SET ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL",
      ).run(now(), reason, id);
    },
    endOpen(reason) {
      const result = db
        .prepare("UPDATE focus_sessions SET ended_at = ?, end_reason = ? WHERE ended_at IS NULL")
        .run(now(), reason);
      return Number(result.changes);
    },
  };
}
