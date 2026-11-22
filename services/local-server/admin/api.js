/**
 * The console's only way to reach the server: a call to a documented route, named as
 * "METHOD /path/:param". The route names are literal strings so a test can check each one against
 * the server's route table. The session is an HttpOnly cookie; this code never sees the token.
 */
export class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra ?? {};
  }
}

const fill = (path, params) =>
  path.replace(/:([A-Za-z]+)/g, (_, name) => encodeURIComponent(params[name] ?? ""));

/**
 * @param {string} route "GET /v1/teams/:teamId/members"
 * @param {{ params?: Record<string,string>, query?: Record<string,string|number|undefined>, body?: unknown }} [options]
 * @returns {Promise<any>} the JSON answer, the text of an export, or null for no content
 */
export async function call(route, options = {}) {
  const space = route.indexOf(" ");
  const method = route.slice(0, space);
  let path = fill(route.slice(space + 1), options.params ?? {});
  const query = Object.entries(options.query ?? {}).filter(
    ([, value]) => value !== undefined && value !== "",
  );
  if (query.length > 0)
    path += `?${new URLSearchParams(query.map(([key, value]) => [key, String(value)]))}`;
  const headers = { "x-murmur-admin": "1" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new ApiError(0, "unreachable", "The server did not answer.");
  }
  const text = await res.text();
  const type = res.headers.get("content-type") ?? "";
  const data = !text ? null : type.includes("json") ? JSON.parse(text) : text;
  if (!res.ok) {
    const error = data && typeof data === "object" ? data.error : null;
    if (res.status === 401) window.dispatchEvent(new Event("admin-signed-out"));
    const { code, message, ...extra } = error ?? {};
    throw new ApiError(res.status, code ?? "error", message ?? "The request was refused.", extra);
  }
  return data;
}
