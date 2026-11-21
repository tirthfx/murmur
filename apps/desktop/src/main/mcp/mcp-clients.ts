import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  MCP_CLIENT_KINDS,
  MCP_CLIENT_NAME_MAX,
  type Keychain,
  type McpActionResult,
  type McpClientInfo,
  type McpClientKind,
} from "@murmur/shared";

/** A client's token is the Keychain item `com.murmur.mcp`, account `client:<id>`. */
export const MCP_KEYCHAIN_SERVICE = "com.murmur.mcp";
export const clientTokenAccount = (id: string) => `client:${id}`;

/** Used by a client no more often than this is written down, so a busy client does not write each call. */
const USE_WRITE_EVERY_MS = 60_000;

export interface McpClients {
  list(): McpClientInfo[];
  get(id: string): McpClientInfo | null;
  /** Approves an app: makes its token, keeps it in the Keychain, and notes who it belongs to. */
  issue(
    name: string,
    kind: McpClientKind,
  ): Promise<{ ok: true; client: McpClientInfo } | { ok: false; message: string }>;
  /** Whose token this is, or null. Notes the use. */
  authenticate(token: string): McpClientInfo | null;
  /** A new token for the same client; the old one stops working at once. */
  rotate(id: string): Promise<McpActionResult>;
  /** Forgets the client: its token stops working at once, then the Keychain item goes. */
  revoke(id: string): Promise<McpActionResult>;
  /** The token itself, for main to put in a config file or on the clipboard. Never for the window. */
  token(id: string): Promise<string | null>;
  /** Revokes every client; for "Delete all data and reset". */
  reset(): Promise<void>;
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

interface Row {
  id: string;
  name: string;
  kind: McpClientKind;
  created_at: number;
  last_used_at: number | null;
}

const toClient = (row: Row): McpClientInfo => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
});

const COLUMNS = "id, name, kind, created_at, last_used_at FROM mcp_clients";

export function createMcpClients(
  db: DatabaseSync,
  deps: {
    keychain: Keychain;
    newId(): string;
    now(): number;
    logger: { warn(message: string): void };
    /** Told when a client's token stopped working (revoked or replaced), so its connections can end. */
    onEnded?(id: string): void;
  },
): McpClients {
  const get = (id: string): McpClientInfo | null => {
    const row = db.prepare(`SELECT ${COLUMNS} WHERE id = ?`).get(id) as unknown as Row | undefined;
    return row ? toClient(row) : null;
  };
  const lastWritten = new Map<string, number>();

  return {
    list() {
      return (
        db.prepare(`SELECT ${COLUMNS} ORDER BY created_at, id`).all() as unknown as Row[]
      ).map(toClient);
    },
    get,

    async issue(name, kind) {
      const clean = name.replace(/\s+/g, " ").trim();
      if (clean === "") return { ok: false, message: "Write a name for the app." };
      if (clean.length > MCP_CLIENT_NAME_MAX)
        return { ok: false, message: `A name can be up to ${MCP_CLIENT_NAME_MAX} characters.` };
      if (!MCP_CLIENT_KINDS.includes(kind))
        return { ok: false, message: "That kind of app is not known." };
      if (db.prepare("SELECT 1 FROM mcp_clients WHERE lower(name) = lower(?)").get(clean))
        return { ok: false, message: "There is an app with that name already." };
      const id = deps.newId();
      const token = newToken();
      try {
        await deps.keychain.set(MCP_KEYCHAIN_SERVICE, clientTokenAccount(id), token);
      } catch {
        return { ok: false, message: "Murmur could not keep the token in the Keychain." };
      }
      db.prepare(
        "INSERT INTO mcp_clients (id, name, kind, token_hash, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, clean, kind, hash(token), deps.now());
      return { ok: true, client: get(id)! };
    },

    authenticate(token) {
      const row = db
        .prepare(`SELECT ${COLUMNS} WHERE token_hash = ?`)
        .get(hash(token)) as unknown as Row | undefined;
      if (!row) return null;
      const now = deps.now();
      if (now - (lastWritten.get(row.id) ?? 0) >= USE_WRITE_EVERY_MS) {
        lastWritten.set(row.id, now);
        db.prepare("UPDATE mcp_clients SET last_used_at = ? WHERE id = ?").run(now, row.id);
        row.last_used_at = now;
      }
      return toClient(row);
    },

    async rotate(id) {
      if (!get(id)) return { ok: false, message: "That app is gone." };
      const token = newToken();
      try {
        await deps.keychain.set(MCP_KEYCHAIN_SERVICE, clientTokenAccount(id), token);
      } catch {
        return { ok: false, message: "Murmur could not keep the new token in the Keychain." };
      }
      db.prepare("UPDATE mcp_clients SET token_hash = ? WHERE id = ?").run(hash(token), id);
      deps.onEnded?.(id);
      return {
        ok: true,
        message:
          "The old token no longer works. Write the config again so the app has the new one.",
      };
    },

    async revoke(id) {
      if (!get(id)) return { ok: false, message: "That app is gone." };
      // The row goes first, so the token is refused from this moment.
      db.prepare("DELETE FROM mcp_clients WHERE id = ?").run(id);
      lastWritten.delete(id);
      deps.onEnded?.(id);
      try {
        await deps.keychain.delete(MCP_KEYCHAIN_SERVICE, clientTokenAccount(id));
      } catch {
        deps.logger.warn(`[mcp] the token item of a removed app could not be deleted`);
      }
      return { ok: true, message: "The app can no longer use Murmur." };
    },

    async token(id) {
      if (!get(id)) return null;
      try {
        return await deps.keychain.get(MCP_KEYCHAIN_SERVICE, clientTokenAccount(id));
      } catch {
        return null;
      }
    },

    async reset() {
      for (const client of this.list()) await this.revoke(client.id);
    },
  };
}
