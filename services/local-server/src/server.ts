import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import { createAccounts, type Accounts, type UserView } from "./accounts.ts";
import { openDatabase } from "./database.ts";

export const SERVER_VERSION = 1;
export const DEFAULT_PORT = 7830;
/** Until the allowlist (TM-22) exists, the server listens on this machine only. */
export const LOOPBACK_HOSTS = ["127.0.0.1", "::1"];
const MAX_BODY = 64 * 1024;

export interface ServerConfig {
  /** A database file, or `:memory:` in tests. */
  dbPath: string;
  host?: string;
  /** 0 picks a free port. */
  port?: number;
  sessionDays?: number;
  now?: () => number;
  /** One line about what happened. Never a password, a hash or a token. */
  log?: (line: string) => void;
}

export interface LocalServer {
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
  accounts: Accounts;
  db: DatabaseSync;
}

class HttpError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  const text = JSON.stringify(body);
  res
    .writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(text),
      "cache-control": "no-store",
    })
    .end(text);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? ""))
    throw new HttpError(415, "json_required", "Send the request as application/json.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "too_large", "That request is too large.");
    chunks.push(chunk);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {
    // Falls through to the error below.
  }
  throw new HttpError(400, "bad_json", "The request body must be a JSON object.");
}

const text = (body: Record<string, unknown>, key: string): string => {
  const value = body[key];
  return typeof value === "string" ? value : "";
};

function bearer(req: IncomingMessage): string | null {
  const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
  return match?.[1] ?? null;
}

/** The local server (M7): accounts and sessions first; teams, policy and the admin console build on it. */
export function createLocalServer(config: ServerConfig): LocalServer {
  const host = config.host ?? "127.0.0.1";
  if (!LOOPBACK_HOSTS.includes(host))
    throw new Error("The local server listens on this machine only (127.0.0.1 or ::1).");
  const now = config.now ?? Date.now;
  const db = openDatabase(config.dbPath);
  const accounts = createAccounts(db, { sessionDays: config.sessionDays ?? 30, now });
  const log = config.log ?? (() => undefined);

  function authenticate(req: IncomingMessage): { user: UserView; token: string } {
    const token = bearer(req);
    const user = token ? accounts.authenticate(token) : null;
    if (!user || !token) throw new HttpError(401, "unauthorized", "Sign in first.");
    return { user, token };
  }

  function requireOwner(req: IncomingMessage): UserView {
    const { user } = authenticate(req);
    // Teams and roles (TM-04) replace this with the permission matrix.
    if (!user.isOwner) throw new HttpError(403, "forbidden", "Only the owner can do that.");
    return user;
  }

  /** A page in a browser could call a loopback address; these checks keep it from being answered. */
  function guard(req: IncomingMessage): void {
    const hostHeader = (req.headers.host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    if (!["127.0.0.1", "localhost", "::1"].includes(hostHeader))
      throw new HttpError(403, "bad_host", "This server answers requests for this machine only.");
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${req.headers.host}`)
      throw new HttpError(403, "bad_origin", "Requests from other pages are not answered.");
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    guard(req);
    const url = new URL(req.url ?? "/", "http://local");
    const key = `${req.method} ${url.pathname}`;

    switch (key) {
      case "GET /v1/health":
        return send(res, 200, { ok: true, version: SERVER_VERSION, setUp: accounts.isSetUp() });

      case "POST /v1/setup": {
        const body = await readJson(req);
        const result = accounts.setupOwner(
          {
            name: text(body, "name"),
            email: text(body, "email"),
            password: text(body, "password"),
          },
          text(body, "clientId"),
        );
        if (!result.ok)
          throw new HttpError(
            result.code === "already_set_up" ? 409 : 400,
            result.code,
            result.message,
          );
        return send(res, 201, result.session);
      }

      case "POST /v1/sessions": {
        const body = await readJson(req);
        const result = accounts.signIn(
          text(body, "email"),
          text(body, "password"),
          text(body, "clientId"),
        );
        if (!result.ok) {
          const status =
            result.code === "delayed" ? 429 : result.code === "deactivated" ? 403 : 401;
          throw new HttpError(
            status,
            result.code,
            result.message,
            result.retryAfterSeconds !== undefined
              ? { retryAfterSeconds: result.retryAfterSeconds }
              : {},
          );
        }
        return send(res, 200, result.session);
      }

      case "DELETE /v1/sessions/current": {
        const { token } = authenticate(req);
        accounts.signOut(token);
        return send(res, 204);
      }

      case "GET /v1/me":
        return send(res, 200, authenticate(req).user);

      case "POST /v1/me/password": {
        const { user, token } = authenticate(req);
        const body = await readJson(req);
        const result = accounts.changePassword(
          user.id,
          text(body, "currentPassword"),
          text(body, "newPassword"),
          token,
        );
        if (!result.ok) throw new HttpError(400, result.code, result.message);
        return send(res, 204);
      }

      case "GET /v1/users":
        requireOwner(req);
        return send(res, 200, { users: accounts.listUsers() });

      case "POST /v1/users": {
        requireOwner(req);
        const body = await readJson(req);
        const result = accounts.createAccount({
          name: text(body, "name"),
          email: text(body, "email"),
          password: text(body, "password"),
        });
        if (!result.ok)
          throw new HttpError(
            result.code === "email_taken" ? 409 : 400,
            result.code,
            result.message,
          );
        return send(res, 201, result.user);
      }

      default:
        throw new HttpError(404, "not_found", "There is nothing at that address.");
    }
  }

  const http = createHttpServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) {
        log(`${req.method} ${req.url?.split("?")[0]} ${error.status} ${error.code}`);
        return send(res, error.status, {
          error: { code: error.code, message: error.message, ...error.extra },
        });
      }
      log(`${req.method} ${req.url?.split("?")[0]} 500`);
      send(res, 500, { error: { code: "server_error", message: "Something went wrong." } });
    });
  });

  return {
    accounts,
    db,
    listen: () =>
      new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(config.port ?? DEFAULT_PORT, host, () => {
          const address = http.address() as AddressInfo;
          resolve({ host, port: address.port });
        });
      }),
    close: () =>
      new Promise((resolve) => {
        http.close(() => {
          db.close();
          resolve();
        });
        http.closeAllConnections();
      }),
  };
}
