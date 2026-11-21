import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { MCP_LIMITS } from "@murmur/shared";
import type { McpClient, McpServer } from "./mcp-server";
import type { McpClientIdentity, RunningTransport } from "./socket-transport";

export const HTTP_PATH = "/mcp";

/** The token in an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: string | undefined): string | null {
  return /^Bearer (\S+)$/.exec(header ?? "")?.[1] ?? null;
}

/** A page of the owner's own machine, not of a site that points a name at this address. */
const isLocalOrigin = (origin: string) => {
  try {
    const { hostname } = new URL(origin);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
};

/**
 * MCP over HTTP on 127.0.0.1 (CN-11): POST /mcp with `Authorization: Bearer <token>`. A request
 * without the token is refused with 401 before its body is read. The Host and Origin checks stop
 * a web page from reaching the server by pointing a name at this address. There are no streams:
 * each POST gets one JSON reply (or 202 for a notification).
 */
export function startHttpTransport(options: {
  port: number;
  server: McpServer;
  /**
   * Whose token this is, or null. Asked for each request, so a token that is removed or replaced
   * stops working at once.
   */
  authenticate(token: string): McpClientIdentity | null;
}): Promise<RunningTransport & { port: number }> {
  const { server } = options;

  const reply = (
    response: ServerResponse,
    status: number,
    body?: string,
    headers: Record<string, string> = {},
  ) => {
    response.writeHead(status, {
      "cache-control": "no-store",
      ...(body === undefined ? {} : { "content-type": "application/json; charset=utf-8" }),
      ...headers,
    });
    response.end(body);
  };

  const readBody = (request: IncomingMessage) =>
    new Promise<string | null>((resolve) => {
      let size = 0;
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MCP_LIMITS.messageBytes) {
          resolve(null);
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      request.on("error", () => resolve(null));
    });

  const listener = createServer((request, response) => {
    void (async () => {
      const host = (request.headers.host ?? "").toLowerCase();
      const port = (listener.address() as { port: number } | null)?.port;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
        return reply(response, 403, JSON.stringify({ error: "Wrong host." }));
      const origin = request.headers.origin;
      if (origin !== undefined && !isLocalOrigin(origin))
        return reply(response, 403, JSON.stringify({ error: "Wrong origin." }));
      if (new URL(request.url ?? "/", "http://127.0.0.1").pathname !== HTTP_PATH)
        return reply(response, 404, JSON.stringify({ error: "Not found." }));

      const token = bearerToken(request.headers.authorization);
      const found = token === null ? null : options.authenticate(token);
      if (!found)
        return reply(response, 401, JSON.stringify({ error: "A bearer token is needed." }), {
          "www-authenticate": 'Bearer realm="murmur"',
        });
      if (request.method !== "POST")
        return reply(response, 405, JSON.stringify({ error: "Use POST." }), { allow: "POST" });
      if (!(request.headers["content-type"] ?? "").toLowerCase().includes("application/json"))
        return reply(response, 415, JSON.stringify({ error: "Send application/json." }));
      const body = await readBody(request);
      if (body === null)
        return reply(response, 413, JSON.stringify({ error: "The message is too long." }));
      const client: McpClient = { id: `client:${found.id}`, name: found.name };
      const answer = await server.handleText(body, client);
      if (answer === null) return reply(response, 202);
      reply(response, 200, answer);
    })().catch(() => {
      if (!response.headersSent) reply(response, 500, JSON.stringify({ error: "Failed." }));
    });
  });

  return new Promise((resolve, reject) => {
    listener.once("error", (error: NodeJS.ErrnoException) =>
      reject(
        new Error(
          error.code === "EADDRINUSE"
            ? `Port ${options.port} is in use. Choose another port.`
            : `Murmur could not listen on port ${options.port} (${error.code ?? "error"}).`,
        ),
      ),
    );
    listener.listen(options.port, "127.0.0.1", () => {
      resolve({
        port: (listener.address() as { port: number }).port,
        close: () =>
          new Promise<void>((done) => {
            listener.close(() => done());
            listener.closeAllConnections();
          }),
      });
    });
  });
}
