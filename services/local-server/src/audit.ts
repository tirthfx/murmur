import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Settings } from "./settings.ts";

/** The genesis value the first row chains from. */
export const GENESIS_HASH = "0".repeat(64);

export const AUDIT_DEFAULTS = { retentionDays: 365 } as const;
const MAX_DETAIL_STRING = 200;
const MAX_DETAIL_KEYS = 30;
/**
 * The audit log never holds content (TM-12). A key that names content, audio or a secret is
 * refused, so a mistake in a caller fails its test instead of writing a transcript to the log.
 */
const FORBIDDEN_KEY =
  /transcript|dictation|text|content|body|audio|note|password|secret|token|hash|key/i;
const ACTION = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export type DetailValue = string | number | boolean | null;
export type AuditDetail = Record<string, DetailValue>;

export interface AuditInput {
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  /** What changed, in short: counts, names of settings, old and new values. No content. */
  detail?: AuditDetail;
  clientId?: string;
}

export interface AuditEvent {
  seq: number;
  ts: number;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  detail: AuditDetail;
  clientId: string;
  prevHash: string;
  hash: string;
}

export interface AuditFilter {
  actor?: string;
  action?: string;
  target?: string;
  from?: number;
  to?: number;
}

interface Row {
  seq: number;
  ts: number;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  detail_json: string;
  client_id: string;
  prev_hash: string;
  hash: string;
}

const fromRow = (row: Row): AuditEvent => ({
  seq: row.seq,
  ts: row.ts,
  actorId: row.actor_id,
  action: row.action,
  targetType: row.target_type,
  targetId: row.target_id,
  detail: JSON.parse(row.detail_json) as AuditDetail,
  clientId: row.client_id,
  prevHash: row.prev_hash,
  hash: row.hash,
});

/** Keys in sorted order at every level, so the same row always gives the same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 over the row's canonical JSON and the hash before it. */
export function hashRow(
  row: Pick<
    AuditEvent,
    "seq" | "ts" | "actorId" | "action" | "targetType" | "targetId" | "detail" | "clientId"
  >,
  prevHash: string,
): string {
  const { seq, ts, actorId, action, targetType, targetId, detail, clientId } = row;
  return createHash("sha256")
    .update(
      canonicalJson({ seq, ts, actorId, action, targetType, targetId, detail, clientId, prevHash }),
    )
    .digest("hex");
}

/** Throws when a detail could carry content. */
export function checkDetail(detail: AuditDetail): void {
  const keys = Object.keys(detail);
  if (keys.length > MAX_DETAIL_KEYS) throw new Error("An audit detail has too many fields.");
  for (const key of keys) {
    if (FORBIDDEN_KEY.test(key))
      throw new Error(
        `An audit detail cannot have a field named "${key}": the log holds no content.`,
      );
    const value = detail[key];
    if (typeof value === "string" && value.length > MAX_DETAIL_STRING)
      throw new Error(`An audit detail value is too long (${key}).`);
    if (value !== null && !["string", "number", "boolean"].includes(typeof value))
      throw new Error(`An audit detail value must be a string, number, boolean or null (${key}).`);
  }
}

export interface Verification {
  ok: boolean;
  /** How many rows were checked. */
  count: number;
  /** The first sequence number that does not match, when the chain is broken. */
  brokenSeq?: number;
  reason?: string;
}

export interface AuditDeps {
  db: DatabaseSync;
  settings: Settings;
  now(): number;
  /** Called with each new event, after it is stored (the SIEM queue uses it). */
  onRecorded?(event: AuditEvent): void;
}

const LIMIT = 200;

export function createAudit(deps: AuditDeps) {
  const { db } = deps;

  const last = (): { seq: number; hash: string } => {
    const row = db.prepare("SELECT seq, hash FROM audit_events ORDER BY seq DESC LIMIT 1").get() as
      { seq: number; hash: string } | undefined;
    if (row) return row;
    const anchor = db.prepare("SELECT last_seq, last_hash FROM audit_anchor WHERE id = 1").get() as
      { last_seq: number; last_hash: string } | undefined;
    return anchor
      ? { seq: anchor.last_seq, hash: anchor.last_hash }
      : { seq: 0, hash: GENESIS_HASH };
  };

  function where(filter: AuditFilter): { sql: string; args: (string | number)[] } {
    const parts: string[] = [];
    const args: (string | number)[] = [];
    const add = (clause: string, ...values: (string | number)[]) => {
      parts.push(clause);
      args.push(...values);
    };
    if (filter.actor) add("actor_id = ?", filter.actor);
    if (filter.action) {
      // `auth.` matches every auth action; `auth.sign_in` matches that one.
      if (filter.action.endsWith(".")) add("action LIKE ?", `${filter.action}%`);
      else add("action = ?", filter.action);
    }
    if (filter.target) add("(target_id = ? OR target_type = ?)", filter.target, filter.target);
    if (filter.from !== undefined) add("ts >= ?", filter.from);
    if (filter.to !== undefined) add("ts <= ?", filter.to);
    return { sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "", args };
  }

  return {
    /** Adds one entry to the end of the chain. */
    record(input: AuditInput): AuditEvent {
      if (!ACTION.test(input.action))
        throw new Error(`An audit action is written area.what_happened (${input.action}).`);
      const detail = input.detail ?? {};
      checkDetail(detail);
      db.exec("BEGIN IMMEDIATE");
      try {
        const previous = last();
        const body = {
          seq: previous.seq + 1,
          ts: deps.now(),
          actorId: input.actorId ?? null,
          action: input.action,
          targetType: input.targetType ?? "",
          targetId: input.targetId ?? "",
          detail,
          clientId: (input.clientId ?? "").slice(0, 100),
        };
        const hash = hashRow(body, previous.hash);
        db.prepare(
          `INSERT INTO audit_events
             (seq, ts, actor_id, action, target_type, target_id, detail_json, client_id, prev_hash, hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          body.seq,
          body.ts,
          body.actorId,
          body.action,
          body.targetType,
          body.targetId,
          JSON.stringify(detail),
          body.clientId,
          previous.hash,
          hash,
        );
        db.exec("COMMIT");
        const event: AuditEvent = { ...body, prevHash: previous.hash, hash };
        deps.onRecorded?.(event);
        return event;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    /** Newest first. `before` is the sequence number to continue from. */
    list(filter: AuditFilter = {}, options: { limit?: number; before?: number } = {}) {
      const limit = Math.min(Math.max(options.limit ?? 50, 1), LIMIT);
      const { sql, args } = where(filter);
      const cursor = options.before !== undefined ? `${sql ? `${sql} AND` : "WHERE"} seq < ?` : sql;
      const rows = db
        .prepare(`SELECT * FROM audit_events ${cursor} ORDER BY seq DESC LIMIT ?`)
        .all(
          ...args,
          ...(options.before !== undefined ? [options.before] : []),
          limit + 1,
        ) as unknown as Row[];
      const events = rows.slice(0, limit).map(fromRow);
      return { events, next: rows.length > limit ? (events.at(-1)?.seq ?? null) : null };
    },

    /** Every matching entry, oldest first, one JSON object a line. */
    exportJsonLines(filter: AuditFilter = {}): string {
      const { sql, args } = where(filter);
      const rows = db
        .prepare(`SELECT * FROM audit_events ${sql} ORDER BY seq`)
        .all(...args) as unknown as Row[];
      return rows.map((row) => JSON.stringify(fromRow(row))).join("\n") + (rows.length ? "\n" : "");
    },

    get(seq: number): AuditEvent | null {
      const row = db.prepare("SELECT * FROM audit_events WHERE seq = ?").get(seq) as
        Row | undefined;
      return row ? fromRow(row) : null;
    },

    /** Walks the chain from its start and names the first row that does not match. */
    verify(): Verification {
      const anchor = db
        .prepare("SELECT last_seq, last_hash FROM audit_anchor WHERE id = 1")
        .get() as { last_seq: number; last_hash: string } | undefined;
      let expectedSeq = (anchor?.last_seq ?? 0) + 1;
      let prevHash = anchor?.last_hash ?? GENESIS_HASH;
      let count = 0;
      const rows = db.prepare("SELECT * FROM audit_events ORDER BY seq").iterate() as Iterable<Row>;
      for (const row of rows) {
        if (row.seq !== expectedSeq)
          return { ok: false, count, brokenSeq: expectedSeq, reason: "A row is missing here." };
        if (row.prev_hash !== prevHash)
          return {
            ok: false,
            count,
            brokenSeq: row.seq,
            reason: "The link to the row before does not match.",
          };
        const event = fromRow(row);
        if (hashRow(event, prevHash) !== row.hash)
          return {
            ok: false,
            count,
            brokenSeq: row.seq,
            reason: "The row was changed after it was written.",
          };
        prevHash = row.hash;
        expectedSeq = row.seq + 1;
        count++;
      }
      return { ok: true, count };
    },

    /** Removes entries older than the retention time, keeping the chain checkable from what is left. */
    prune(retentionDays: number): number {
      const cutoff = deps.now() - retentionDays * 86_400_000;
      db.exec("BEGIN IMMEDIATE");
      let removed = 0;
      try {
        const boundary = db
          .prepare("SELECT seq, hash FROM audit_events WHERE ts < ? ORDER BY seq DESC LIMIT 1")
          .get(cutoff) as { seq: number; hash: string } | undefined;
        if (boundary) {
          // Only the oldest unbroken run goes, and the newest row is always kept.
          const newest = (
            db.prepare("SELECT MAX(seq) AS seq FROM audit_events").get() as { seq: number }
          ).seq;
          const upTo = Math.min(boundary.seq, newest - 1);
          const edge = db.prepare("SELECT seq, hash FROM audit_events WHERE seq = ?").get(upTo) as
            { seq: number; hash: string } | undefined;
          if (edge) {
            removed = Number(
              db.prepare("DELETE FROM audit_events WHERE seq <= ?").run(upTo).changes,
            );
            db.prepare(
              `INSERT INTO audit_anchor (id, last_seq, last_hash) VALUES (1, ?, ?)
               ON CONFLICT (id) DO UPDATE SET last_seq = excluded.last_seq, last_hash = excluded.last_hash`,
            ).run(edge.seq, edge.hash);
          }
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      if (removed > 0)
        this.record({ action: "audit.retention_pruned", detail: { removed, retentionDays } });
      return removed;
    },

    retentionDays: (): number =>
      deps.settings.get<number>("team.audit.retentionDays", AUDIT_DEFAULTS.retentionDays),
  };
}

export type Audit = ReturnType<typeof createAudit>;
