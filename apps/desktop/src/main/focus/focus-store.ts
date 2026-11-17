import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { FOCUS_LIMITS, type FocusEndReason, type FocusRule } from "@murmur/shared";

export interface FocusStore {
  /** Blocked apps, by name. */
  apps(): FocusRule[];
  /** Adds a blocked app; null when the app is already there or the list is full. */
  addApp(bundleId: string, label: string): FocusRule | "duplicate" | "limit";
  remove(id: string): void;
  /** Starts a session row; returns its id. */
  start(plannedMs: number | null): string;
  end(id: string, reason: FocusEndReason): void;
  /** Ends any session left open by a crash, as `quit`. Returns how many. */
  endOpen(reason: FocusEndReason): number;
}

interface RuleRow {
  id: string;
  kind: "app";
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
  return {
    apps() {
      const rows = db
        .prepare("SELECT * FROM focus_rules WHERE kind = 'app' ORDER BY label COLLATE NOCASE")
        .all() as unknown as RuleRow[];
      return rows.map(toRule);
    },
    addApp(bundleId, label) {
      const existing = db
        .prepare("SELECT id FROM focus_rules WHERE kind = 'app' AND value = ?")
        .get(bundleId);
      if (existing) return "duplicate";
      const count = (
        db.prepare("SELECT COUNT(*) AS n FROM focus_rules WHERE kind = 'app'").get() as {
          n: number;
        }
      ).n;
      if (count >= FOCUS_LIMITS.apps) return "limit";
      const rule: FocusRule = {
        id: newId(),
        kind: "app",
        value: bundleId,
        label,
        createdAt: now(),
      };
      db.prepare(
        "INSERT INTO focus_rules (id, kind, value, label, created_at) VALUES (?, 'app', ?, ?, ?)",
      ).run(rule.id, rule.value, rule.label, rule.createdAt);
      return rule;
    },
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
