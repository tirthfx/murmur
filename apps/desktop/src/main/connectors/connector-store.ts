import type { DatabaseSync } from "node:sqlite";
import type { ConnectorAccount, ConnectorStatus } from "@murmur/shared";

/**
 * Connector accounts and the cache of what was fetched for them (CN-01). No token is ever here:
 * see `token-vault.ts`. Removing an account removes its cache rows with it.
 */
export interface ConnectorStore {
  /**
   * Adds an account, or, when the same provider and email are there already (a reconnect),
   * updates its scopes and makes it connected again. The id of an old account is kept.
   */
  upsertAccount(input: {
    id: string;
    connector: string;
    email: string;
    scopes: readonly string[];
    at: number;
  }): ConnectorAccount;
  get(id: string): ConnectorAccount | null;
  /** All accounts, or those of one provider, oldest first. */
  list(connector?: string): ConnectorAccount[];
  setStatus(id: string, status: ConnectorStatus, reason: string | null): void;
  setLastSync(id: string, at: number): void;
  /** Deletes the account and, with it, its cache. */
  remove(id: string): void;

  cachePut(
    accountId: string,
    kind: string,
    key: string,
    json: string,
    at: number,
    ttlMs: number,
  ): void;
  /** The cached text while it is fresh, else null (an old row is left for `cachePrune`). */
  cacheGet(accountId: string, kind: string, key: string, now: number): string | null;
  /** Deletes what is older than its time to live. Returns how many rows went. */
  cachePrune(now: number): number;
}

interface Row {
  id: string;
  connector: string;
  email: string;
  scopes: string;
  status: ConnectorStatus;
  status_reason: string | null;
  last_sync_at: number | null;
  created_at: number;
}

const toAccount = (row: Row): ConnectorAccount => ({
  id: row.id,
  connector: row.connector,
  email: row.email,
  scopes: JSON.parse(row.scopes) as string[],
  status: row.status,
  statusReason: row.status_reason,
  lastSyncAt: row.last_sync_at,
  createdAt: row.created_at,
});

const COLUMNS =
  "id, connector, email, scopes, status, status_reason, last_sync_at, created_at FROM connector_accounts";

export function createConnectorStore(db: DatabaseSync): ConnectorStore {
  const get = (id: string): ConnectorAccount | null => {
    const row = db.prepare(`SELECT ${COLUMNS} WHERE id = ?`).get(id) as unknown as Row | undefined;
    return row ? toAccount(row) : null;
  };
  return {
    upsertAccount(input) {
      const scopes = JSON.stringify([...new Set(input.scopes)]);
      const existing = db
        .prepare("SELECT id FROM connector_accounts WHERE connector = ? AND email = ?")
        .get(input.connector, input.email) as { id: string } | undefined;
      if (existing) {
        db.prepare(
          "UPDATE connector_accounts SET scopes = ?, status = 'connected', status_reason = NULL WHERE id = ?",
        ).run(scopes, existing.id);
        return get(existing.id)!;
      }
      db.prepare(
        `INSERT INTO connector_accounts (id, connector, email, scopes, status, created_at)
         VALUES (?, ?, ?, ?, 'connected', ?)`,
      ).run(input.id, input.connector, input.email, scopes, input.at);
      return get(input.id)!;
    },
    get,
    list(connector) {
      const rows =
        connector === undefined
          ? db.prepare(`SELECT ${COLUMNS} ORDER BY created_at, id`).all()
          : db
              .prepare(`SELECT ${COLUMNS} WHERE connector = ? ORDER BY created_at, id`)
              .all(connector);
      return (rows as unknown as Row[]).map(toAccount);
    },
    setStatus(id, status, reason) {
      db.prepare("UPDATE connector_accounts SET status = ?, status_reason = ? WHERE id = ?").run(
        status,
        status === "needs_attention" ? reason : null,
        id,
      );
    },
    setLastSync(id, at) {
      db.prepare("UPDATE connector_accounts SET last_sync_at = ? WHERE id = ?").run(at, id);
    },
    remove(id) {
      db.prepare("DELETE FROM connector_accounts WHERE id = ?").run(id);
    },

    cachePut(accountId, kind, key, json, at, ttlMs) {
      db.prepare(
        `INSERT INTO connector_cache (account_id, kind, key, json, fetched_at, ttl_ms)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (account_id, kind, key)
         DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at, ttl_ms = excluded.ttl_ms`,
      ).run(accountId, kind, key, json, at, ttlMs);
    },
    cacheGet(accountId, kind, key, now) {
      const row = db
        .prepare(
          "SELECT json, fetched_at, ttl_ms FROM connector_cache WHERE account_id = ? AND kind = ? AND key = ?",
        )
        .get(accountId, kind, key) as
        { json: string; fetched_at: number; ttl_ms: number } | undefined;
      return row && now - row.fetched_at < row.ttl_ms ? row.json : null;
    },
    cachePrune(now) {
      return Number(
        db.prepare("DELETE FROM connector_cache WHERE fetched_at + ttl_ms <= ?").run(now).changes,
      );
    },
  };
}
