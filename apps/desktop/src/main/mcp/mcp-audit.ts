import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { McpAuditEntry } from "@murmur/shared";

/** The log keeps this many lines, and nothing older than 90 days. */
export const AUDIT_KEEP = 5000;
export const AUDIT_DAYS = 90;

export interface McpAudit {
  record(event: {
    at: number;
    client: string;
    tool: string;
    /** Only a hash of these is kept. */
    args: unknown;
    ok: boolean;
    resultBytes: number;
    write: boolean;
  }): void;
  /** Newest first. */
  list(limit?: number): McpAuditEntry[];
  clear(): void;
}

/** JSON with the keys of every object in order, so the same arguments always hash the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export const argsHash = (args: unknown) =>
  createHash("sha256").update(canonicalJson(args)).digest("hex");

/**
 * What the clients called (CN-11): who, which tool, a hash of the arguments, the size of the
 * result and whether it worked. Never the arguments or what came back.
 */
export function createMcpAudit(db: DatabaseSync): McpAudit {
  return {
    record(event) {
      db.prepare(
        `INSERT INTO mcp_audit (at, client, tool, args_hash, result_bytes, ok, write)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        event.at,
        event.client.slice(0, 200),
        event.tool,
        argsHash(event.args),
        event.resultBytes,
        event.ok ? 1 : 0,
        event.write ? 1 : 0,
      );
      db.prepare("DELETE FROM mcp_audit WHERE at < ?").run(event.at - AUDIT_DAYS * 86_400_000);
      db.prepare("DELETE FROM mcp_audit WHERE id <= (SELECT MAX(id) FROM mcp_audit) - ?").run(
        AUDIT_KEEP,
      );
    },
    list(limit = 50) {
      return (
        db
          .prepare(
            `SELECT id, at, client, tool, ok, result_bytes, write FROM mcp_audit
             ORDER BY id DESC LIMIT ?`,
          )
          .all(limit) as unknown as {
          id: number;
          at: number;
          client: string;
          tool: string;
          ok: number;
          result_bytes: number;
          write: number;
        }[]
      ).map((row) => ({
        id: row.id,
        at: row.at,
        client: row.client,
        tool: row.tool,
        ok: row.ok === 1,
        resultBytes: row.result_bytes,
        write: row.write === 1,
      }));
    },
    clear() {
      db.prepare("DELETE FROM mcp_audit").run();
    },
  };
}
