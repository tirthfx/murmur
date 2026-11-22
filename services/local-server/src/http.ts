import type { IncomingMessage, ServerResponse } from "node:http";
import type { ActionName } from "./permissions.ts";
import type { UserView } from "./accounts.ts";

export const MAX_BODY = 64 * 1024;

export class HttpError extends Error {
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

/** What a service says when it refuses; a route turns it into an HTTP error. */
export interface Failure {
  ok: false;
  status: number;
  code: string;
  message: string;
  extra?: Record<string, unknown>;
}
export const fail = (status: number, code: string, message: string): Failure => ({
  ok: false,
  status,
  code,
  message,
});

/** Throws the failure as an HTTP error; otherwise gives the success back. */
export function orThrow<T extends { ok: true }>(result: T | Failure): T {
  if (!result.ok) throw new HttpError(result.status, result.code, result.message, result.extra);
  return result;
}

export type Json = Record<string, unknown>;

export interface Reply {
  status: number;
  body?: unknown;
  /** A body that is already text (an export). */
  raw?: string;
  headers?: Record<string, string>;
}
export const reply = (status: number, body?: unknown): Reply =>
  body === undefined ? { status } : { status, body };

/**
 * `public` needs no sign-in; `optional` uses one when it is there; `signed_in` needs one; an
 * action is checked against the permission matrix before the handler runs.
 */
export type Access = "public" | "optional" | "signed_in" | { action: ActionName };

export interface Ctx {
  req: IncomingMessage;
  url: URL;
  params: Record<string, string>;
  user: UserView | null;
  token: string | null;
  /** The `Host` header, for building links. */
  host: string;
  /** The JSON object in the request body. */
  json(): Promise<Json>;
}

export interface Route {
  method: string;
  /** `/v1/teams/:teamId/members`; a `:name` segment is a parameter. */
  path: string;
  access: Access;
  handler(ctx: Ctx): Reply | Promise<Reply>;
}

/** A route's description without its handler: what the tests and the admin console read. */
export type RouteInfo = Pick<Route, "method" | "path" | "access">;

export function send(res: ServerResponse, out: Reply): void {
  if (out.raw !== undefined) {
    res
      .writeHead(out.status, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
        ...out.headers,
      })
      .end(out.raw);
    return;
  }
  if (out.body === undefined) {
    res.writeHead(out.status, out.headers).end();
    return;
  }
  const text = JSON.stringify(out.body);
  res
    .writeHead(out.status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(text),
      "cache-control": "no-store",
      ...out.headers,
    })
    .end(text);
}

export async function readJson(req: IncomingMessage): Promise<Json> {
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
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Json;
  } catch {
    // Falls through to the error below.
  }
  throw new HttpError(400, "bad_json", "The request body must be a JSON object.");
}

/** A string field, or "" when it is missing or not a string. */
export const text = (body: Json, key: string): string => {
  const value = body[key];
  return typeof value === "string" ? value : "";
};

/** An integer field, or undefined when it is missing; NaN when it is not a whole number. */
export const whole = (body: Json, key: string): number | undefined => {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  return typeof value === "number" && Number.isInteger(value) ? value : Number.NaN;
};

/** Splits `/v1/a/:id/b` and a request path into the parameters, or null when they differ. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split("/");
  const have = path.split("/");
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const part = want[i]!;
    const actual = have[i]!;
    if (part.startsWith(":")) {
      if (actual === "") return null;
      try {
        params[part.slice(1)] = decodeURIComponent(actual);
      } catch {
        return null;
      }
    } else if (part !== actual) return null;
  }
  return params;
}
