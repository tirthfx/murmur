import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createAccounts, type Accounts, type UserView } from "./accounts.ts";
import { createAudit, type Audit, type AuditFilter } from "./audit.ts";
import { openDatabase } from "./database.ts";
import { createSettings } from "./settings.ts";
import { createSiem, type Siem, type SiemConfig } from "./siem.ts";

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
  /** Where SIEM file mode writes. Next to the database by default. */
  siemFile?: string;
  /** Send audit entries to the SIEM as they are written, and retry on a timer (on by default). */
  siemAutoFlush?: boolean;
  /** Receives a webhook line; for tests. */
  siemPost?: (url: string, line: string) => Promise<number>;
}

export interface LocalServer {
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
  accounts: Accounts;
  audit: Audit;
  siem: Siem;
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
  const settings = createSettings(db, now);
  const siem = createSiem({
    db,
    settings,
    now,
    filePath:
      config.siemFile ??
      join(config.dbPath === ":memory:" ? tmpdir() : dirname(config.dbPath), "audit.jsonl"),
    ...(config.siemPost ? { post: config.siemPost } : {}),
  });
  const autoFlush = config.siemAutoFlush ?? true;
  const audit = createAudit({
    db,
    settings,
    now,
    onRecorded: (event) => {
      siem.enqueue(event);
      if (autoFlush) void siem.flush().catch(() => undefined);
    },
  });
  const accounts = createAccounts(db, {
    sessionDays: config.sessionDays ?? 30,
    now,
    audit: (input) => audit.record(input),
  });
  const log = config.log ?? (() => undefined);
  let timer: NodeJS.Timeout | null = null;

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

  function auditFilter(url: URL): AuditFilter {
    const filter: AuditFilter = {};
    const get = (key: string) => url.searchParams.get(key) || undefined;
    const actor = get("actor");
    const action = get("action");
    const target = get("target");
    if (actor) filter.actor = actor;
    if (action) filter.action = action;
    if (target) filter.target = target;
    if (url.searchParams.has("from")) filter.from = Number(url.searchParams.get("from"));
    if (url.searchParams.has("to")) filter.to = Number(url.searchParams.get("to"));
    return filter;
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
        const owner = requireOwner(req);
        const body = await readJson(req);
        const result = accounts.createAccount(
          {
            name: text(body, "name"),
            email: text(body, "email"),
            password: text(body, "password"),
          },
          owner.id,
        );
        if (!result.ok)
          throw new HttpError(
            result.code === "email_taken" ? 409 : 400,
            result.code,
            result.message,
          );
        return send(res, 201, result.user);
      }

      case "GET /v1/audit": {
        requireOwner(req);
        const page = audit.list(auditFilter(url), {
          limit: Number(url.searchParams.get("limit") ?? 50) || 50,
          ...(url.searchParams.has("before")
            ? { before: Number(url.searchParams.get("before")) }
            : {}),
        });
        return send(res, 200, page);
      }

      case "GET /v1/audit/export": {
        const owner = requireOwner(req);
        const body = audit.exportJsonLines(auditFilter(url));
        audit.record({
          actorId: owner.id,
          action: "audit.exported",
          detail: { rows: body === "" ? 0 : body.trimEnd().split("\n").length },
        });
        res
          .writeHead(200, {
            "content-type": "application/x-ndjson; charset=utf-8",
            "content-disposition": 'attachment; filename="murmur-audit.jsonl"',
            "cache-control": "no-store",
          })
          .end(body);
        return;
      }

      case "POST /v1/audit/verify":
        requireOwner(req);
        return send(res, 200, audit.verify());

      case "GET /v1/audit/settings": {
        requireOwner(req);
        return send(res, 200, { retentionDays: audit.retentionDays(), siem: siem.status() });
      }

      case "PUT /v1/audit/settings": {
        const owner = requireOwner(req);
        const body = await readJson(req);
        const changed: Record<string, string | number> = {};
        if (body["retentionDays"] !== undefined) {
          const days = Number(body["retentionDays"]);
          if (!Number.isInteger(days) || days < 30 || days > 3650)
            throw new HttpError(400, "invalid_retention", "Keep the log between 30 and 3650 days.");
          settings.set("team.audit.retentionDays", days);
          changed["retentionDays"] = days;
        }
        const siemPatch: Partial<SiemConfig> = {};
        if (body["siemMode"] !== undefined)
          siemPatch.mode = text(body, "siemMode") as SiemConfig["mode"];
        if (body["siemWebhookUrl"] !== undefined)
          siemPatch.webhookUrl = text(body, "siemWebhookUrl");
        if (Object.keys(siemPatch).length > 0) {
          const result = siem.setConfig(siemPatch);
          if (!result.ok) throw new HttpError(400, "invalid_siem", result.message);
          if (siemPatch.mode !== undefined) changed["siemMode"] = siemPatch.mode;
          if (siemPatch.webhookUrl !== undefined) changed["siemWebhook"] = "changed";
        }
        audit.record({ actorId: owner.id, action: "audit.settings_changed", detail: changed });
        return send(res, 200, { retentionDays: audit.retentionDays(), siem: siem.status() });
      }

      case "POST /v1/audit/siem/retry": {
        const owner = requireOwner(req);
        const count = siem.retryFailed();
        audit.record({ actorId: owner.id, action: "audit.siem_retried", detail: { count } });
        if (autoFlush) void siem.flush().catch(() => undefined);
        return send(res, 200, siem.status());
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
    audit,
    siem,
    db,
    listen: () =>
      new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(config.port ?? DEFAULT_PORT, host, () => {
          const address = http.address() as AddressInfo;
          if (autoFlush) {
            // Retries wait on this timer; the daily retention of the log runs here too.
            let day = Math.floor(now() / 86_400_000);
            timer = setInterval(() => {
              void siem.flush().catch(() => undefined);
              const today = Math.floor(now() / 86_400_000);
              if (today !== day) {
                day = today;
                audit.prune(audit.retentionDays());
              }
            }, 5_000);
            timer.unref();
          }
          resolve({ host, port: address.port });
        });
      }),
    close: () =>
      new Promise((resolve) => {
        if (timer) clearInterval(timer);
        http.close(() => {
          db.close();
          resolve();
        });
        http.closeAllConnections();
      }),
  };
}
