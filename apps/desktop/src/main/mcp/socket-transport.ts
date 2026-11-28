import { chmodSync, existsSync, rmSync } from "node:fs";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { MCP_LIMITS } from "@murmur/shared";
import type { McpClient, McpServer } from "./mcp-server";

export interface RunningTransport {
  close(): Promise<void>;
}

/** An app the owner approved, as the transports see it. */
export interface McpClientIdentity {
  id: string;
  name: string;
}

/** The longest a socket path may be on macOS, bytes, with room for the terminator. */
export const SOCKET_PATH_MAX = 100;

/** The first message on a connection: `{"jsonrpc":"2.0","method":"murmur/authorize","params":{"token":"..."}}`. */
export const AUTHORIZE_METHOD = "murmur/authorize";

/** What a connection is told when it is not allowed in. */
const REFUSED = {
  noToken: "Murmur needs the app's token first. Write the app's config again in Murmur.",
  badToken: "That token is not valid. It may have been replaced or removed in Murmur.",
  ended: "This app's access was removed in Murmur.",
};

/**
 * The socket the `murmur-mcp` command talks to (CN-11): one JSON-RPC message per line, in both
 * directions. It is a file in the data folder that only this user can open (mode 0600), and it
 * exists only while the server is on. Each connection is one client and must begin with its
 * token (the command sends it from `MURMUR_MCP_TOKEN`); a token that is removed or replaced ends
 * its connections at once.
 */
export function startSocketTransport(options: {
  path: string;
  server: McpServer;
  logger: { warn(message: string): void };
  /** Whose token this is, or null. */
  authenticate(token: string): McpClientIdentity | null;
  /** Whether an approved app still is one. Asked before each message. */
  isActive(clientId: string): boolean;
}): Promise<RunningTransport & { disconnect(clientId: string): void }> {
  const { path, server } = options;
  if (Buffer.byteLength(path) > SOCKET_PATH_MAX)
    return Promise.reject(
      new Error("The data folder's path is too long for a local socket. Use a shorter one."),
    );
  if (existsSync(path)) rmSync(path, { force: true });

  const sockets = new Map<net.Socket, string | null>();
  const listener = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.set(socket, null);
    socket.once("close", () => sockets.delete(socket));
    const client: McpClient = { id: `socket:${randomUUID()}`, name: null };
    let identity: McpClientIdentity | null = null;
    let buffer = "";
    let inFlight = 0;
    let ended = false;
    const finish = () => {
      if (ended && inFlight === 0 && !socket.destroyed) socket.end();
    };
    const refuse = (id: unknown, message: string) => {
      const reply = {
        jsonrpc: "2.0",
        id: typeof id === "string" || typeof id === "number" ? id : null,
        error: { code: -32001, message },
      };
      socket.end(`${JSON.stringify(reply)}\n`);
    };
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (line === "") continue;
        if (socket.destroyed || socket.writableEnded) return;

        if (identity === null) {
          let first: { id?: unknown; method?: unknown; params?: { token?: unknown } } = {};
          try {
            first = JSON.parse(line) as typeof first;
          } catch {
            /* not JSON: refused below */
          }
          if (first.method !== AUTHORIZE_METHOD || typeof first.params?.token !== "string")
            return refuse(first.id, REFUSED.noToken);
          const found = options.authenticate(first.params.token);
          if (!found) return refuse(first.id, REFUSED.badToken);
          identity = found;
          sockets.set(socket, found.id);
          // Counted and named as the approved app, whatever the connection says it is.
          client.id = `client:${found.id}`;
          client.name = found.name;
          continue;
        }
        if (!options.isActive(identity.id)) return refuse(null, REFUSED.ended);

        inFlight++;
        void server
          .handleText(line, client)
          .then((reply) => {
            if (reply !== null && !socket.destroyed) socket.write(`${reply}\n`);
          })
          .catch(() => undefined)
          .finally(() => {
            inFlight--;
            finish();
          });
      }
      if (Buffer.byteLength(buffer) > MCP_LIMITS.messageBytes) {
        options.logger.warn(
          "[mcp] a message on the socket was too long; the connection was closed",
        );
        socket.destroy();
      }
    });
    socket.on("end", () => {
      ended = true;
      finish();
    });
    socket.on("error", () => socket.destroy());
  });

  return new Promise((resolve, reject) => {
    listener.once("error", (error: NodeJS.ErrnoException) =>
      reject(new Error(`Murmur could not open the local socket (${error.code ?? "error"}).`)),
    );
    // Created with mode 0600 from the start, and set again once it exists.
    const previous = process.umask(0o177);
    try {
      listener.listen(path, () => {
        try {
          chmodSync(path, 0o600);
        } catch {
          /* the umask already did it */
        }
        resolve({
          disconnect(clientId) {
            for (const [socket, owner] of sockets) if (owner === clientId) socket.destroy();
          },
          close: () =>
            new Promise<void>((done) => {
              for (const socket of sockets.keys()) socket.destroy();
              listener.close(() => {
                rmSync(path, { force: true });
                done();
              });
            }),
        });
      });
    } finally {
      process.umask(previous);
    }
  });
}
