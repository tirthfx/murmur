import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Accounts, UserView } from "./accounts.ts";
import type { Plan } from "./plan.ts";
import type { Teams } from "./teams.ts";

/**
 * The admin console (TM-11): a web page at `/admin` served by this server. The pages are plain
 * files (no build step, no framework: ADR-0093) and every action they take is a call to the
 * documented API; the console has no access to the database. The session is an `HttpOnly`,
 * `SameSite=Strict` cookie that holds the same token an app would send as a Bearer header, so the
 * page's own scripts never see it.
 */
export const ADMIN_COOKIE = "murmur_admin";
/** A cookie request that changes something must carry this header; a form on another site cannot. */
export const ADMIN_HEADER = "x-murmur-admin";

const ADMIN_ROLES = ["owner", "admin", "manager"];

export function cookieToken(req: IncomingMessage): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === ADMIN_COOKIE) return rest.join("=") || null;
  }
  return null;
}

export const sessionCookie = (token: string, maxAgeSeconds: number): string =>
  `${ADMIN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;

export const clearedCookie = (): string =>
  `${ADMIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

/** Whether the person may open the console: the server owner, or an owner, admin or manager somewhere. */
export function adminEligible(user: UserView, teams: Pick<Teams, "list">): boolean {
  if (user.isOwner) return true;
  return teams.list(user).some((team) => ADMIN_ROLES.includes(team.myRole));
}

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
};

/** The page's own files only; nothing outside them can be asked for. */
const FILE = /^[a-z][a-z0-9-]*\.(html|js|css)$/;
const ROOT = new URL("../admin/", import.meta.url);

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function page(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { "content-type": type, ...SECURITY_HEADERS }).end(body);
}

export function readAsset(name: string): string | null {
  const parts = name.split("/");
  if (parts.length > 2 || !parts.every((part) => FILE.test(part) || part === "pages")) return null;
  if (parts.length === 2 && parts[0] !== "pages") return null;
  try {
    return readFileSync(new URL(name, ROOT), "utf8");
  } catch {
    return null;
  }
}

export interface AdminPages {
  /** True when the request was for the console (and has been answered). */
  handle(req: IncomingMessage, res: ServerResponse, pathname: string): boolean;
}

export function createAdminPages(deps: {
  accounts: Pick<Accounts, "authenticate">;
  teams: Pick<Teams, "list">;
  plan: Pick<Plan, "require">;
}): AdminPages {
  const forbidden = (res: ServerResponse, why: string) =>
    page(
      res,
      403,
      TYPES["html"]!,
      (readAsset("forbidden.html") ?? "<h1>403</h1>").replace("{{reason}}", why),
    );

  return {
    handle(req, res, pathname) {
      if (pathname !== "/admin" && !pathname.startsWith("/admin/")) return false;
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD", ...SECURITY_HEADERS }).end();
        return true;
      }
      const rest = pathname.replace(/^\/admin\/?/, "");
      // The files carry no data, so the sign-in form can load them. Only the first page checks who is asking.
      if (rest !== "") {
        const asset = readAsset(rest);
        if (asset === null) {
          page(res, 404, "text/plain; charset=utf-8", "Not found");
        } else {
          page(res, 200, TYPES[rest.split(".").pop()!] ?? "text/plain", asset);
        }
        return true;
      }
      const token = cookieToken(req);
      const user = token ? deps.accounts.authenticate(token) : null;
      if (user) {
        if (!adminEligible(user, deps.teams)) {
          forbidden(
            res,
            "This account is not an admin of any team, so it cannot open the console.",
          );
          return true;
        }
        const missing = deps.plan.require("adminConsole");
        if (missing) {
          forbidden(res, missing.message);
          return true;
        }
      }
      page(res, 200, TYPES["html"]!, readAsset("index.html") ?? "");
      return true;
    },
  };
}
