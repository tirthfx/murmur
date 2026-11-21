import { chmodSync, existsSync, rmSync } from "node:fs";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { MCP_LIMITS } from "@murmur/shared";
import type { McpClient, McpServer } from "./mcp-server";

export interface RunningTransport {
  close(): Promise<void>;
}

/** The longest a socket path may be on macOS, bytes, with room for the terminator. */
export const SOCKET_PATH_MAX = 100;

/**
 * The socket the `murmur-mcp` command talks to (CN-11): one JSON-RPC message per line, in both
 * directions. It is a file in the data folder that only this user can open (mode 0600), and it
 * exists only while the server is on. Each connection is one client.
 */
export function startSocketTransport(options: {
  path: string;
  server: McpServer;
  logger: { warn(message: string): void };
}): Promise<RunningTransport> {
  const { path, server } = options;
  if (Buffer.byteLength(path) > SOCKET_PATH_MAX)
    return Promise.reject(
      new Error("The data folder's path is too long for a local socket. Use a shorter one."),
    );
  if (existsSync(path)) rmSync(path, { force: true });

  const sockets = new Set<net.Socket>();
  const listener = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    const client: McpClient = { id: `socket:${randomUUID()}`, name: null };
    let buffer = "";
    let inFlight = 0;
    let ended = false;
    const finish = () => {
      if (ended && inFlight === 0 && !socket.destroyed) socket.end();
    };
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (line === "") continue;
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
          close: () =>
            new Promise<void>((done) => {
              for (const socket of sockets) socket.destroy();
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
