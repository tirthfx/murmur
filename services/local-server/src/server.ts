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
import { createAudit, type Audit } from "./audit.ts";
import { openDatabase } from "./database.ts";
import {
  HttpError,
  matchPath,
  readJson,
  send,
  type Access,
  type Ctx,
  type Route,
  type RouteInfo,
} from "./http.ts";
import { createInvites, type Invites } from "./invites.ts";
import { ACTIONS, allows } from "./permissions.ts";
import { createPolicy, type Policy } from "./policy.ts";
import { auditRoutes } from "./routes/audit.ts";
import { authRoutes } from "./routes/auth.ts";
import type { RouteDeps } from "./routes/context.ts";
import { policyRoutes } from "./routes/policy.ts";
import { teamRoutes } from "./routes/teams.ts";
import { vocabularyRoutes } from "./routes/vocabulary.ts";
import { createSettings } from "./settings.ts";
import { createSiem, type Siem } from "./siem.ts";
import { createTeamSettings } from "./team-settings.ts";
import { createTeams, type Teams } from "./teams.ts";
import { createVocabulary, type Vocabulary } from "./vocabulary.ts";

export { SERVER_VERSION } from "./version.ts";
export const DEFAULT_PORT = 7830;
/** Until the allowlist (TM-22) exists, the server listens on this machine only. */
export const LOOPBACK_HOSTS = ["127.0.0.1", "::1"];

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
  teams: Teams;
  invites: Invites;
  vocabulary: Vocabulary;
  policy: Policy;
  /** Every route and who may call it: the permission matrix tests walk this. */
  routes: readonly RouteInfo[];
  db: DatabaseSync;
}

/** The local server (M7): accounts, the audit log, teams and what they build on. */
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
  const record = (input: Parameters<Audit["record"]>[0]) => audit.record(input);
  const accounts = createAccounts(db, {
    sessionDays: config.sessionDays ?? 30,
    now,
    audit: record,
  });
  const teams = createTeams({ db, now, audit: record });
  const invites = createInvites({ db, now, audit: record, settings, teams, accounts });
  const teamSettings = createTeamSettings(db);
  const vocabulary = createVocabulary({ db, now, audit: record, settings: teamSettings });
  const policy = createPolicy({ db, now, audit: record, teams });
  const log = config.log ?? (() => undefined);
  let timer: NodeJS.Timeout | null = null;

  const deps: RouteDeps = {
    accounts,
    audit,
    siem,
    settings,
    teams,
    invites,
    teamSettings,
    vocabulary,
    policy,
    autoFlush,
  };
  const routes: Route[] = [
    ...authRoutes(deps),
    ...auditRoutes(deps),
    ...teamRoutes(deps),
    ...vocabularyRoutes(deps),
    ...policyRoutes(deps),
  ];

  function bearer(req: IncomingMessage): string | null {
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
    return match?.[1] ?? null;
  }

  /** The matrix check for a route that names an action. */
  function authorize(access: Access, user: UserView | null, params: Record<string, string>): void {
    if (access === "public" || access === "optional") return;
    if (!user) throw new HttpError(401, "unauthorized", "Sign in first.");
    if (access === "signed_in") return;
    const rule = ACTIONS[access.action];
    const role = rule.scope === "team" ? teams.roleOf(user, params["teamId"] ?? "") : null;
    if (!allows(access.action, { role, isServerOwner: user.isOwner }))
      throw new HttpError(403, "forbidden", "You are not allowed to do that.");
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

  async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    guard(req);
    const url = new URL(req.url ?? "/", "http://local");
    let found: { route: Route; params: Record<string, string> } | null = null;
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = matchPath(route.path, url.pathname);
      if (params) {
        found = { route, params };
        break;
      }
    }
    if (!found) throw new HttpError(404, "not_found", "There is nothing at that address.");

    const token = bearer(req);
    const user = token ? accounts.authenticate(token) : null;
    authorize(found.route.access, user, found.params);
    const ctx: Ctx = {
      req,
      url,
      params: found.params,
      user,
      token,
      host: req.headers.host ?? "127.0.0.1",
      json: () => readJson(req),
    };
    send(res, await found.route.handler(ctx));
  }

  const http = createHttpServer((req, res) => {
    dispatch(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) {
        log(`${req.method} ${req.url?.split("?")[0]} ${error.status} ${error.code}`);
        return send(res, {
          status: error.status,
          body: { error: { code: error.code, message: error.message, ...error.extra } },
        });
      }
      log(`${req.method} ${req.url?.split("?")[0]} 500`);
      send(res, {
        status: 500,
        body: { error: { code: "server_error", message: "Something went wrong." } },
      });
    });
  });

  return {
    accounts,
    audit,
    siem,
    teams,
    invites,
    vocabulary,
    policy,
    routes: routes.map(({ method, path, access }) => ({ method, path, access })),
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
                vocabulary.pruneHistory();
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
