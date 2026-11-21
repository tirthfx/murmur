import type { DatabaseSync } from "node:sqlite";
import { MCP_STATUS_OFF, type Keychain, type McpSettings, type McpStatus } from "@murmur/shared";
import type { Logger } from "../helper/types";
import { HTTP_PATH, startHttpTransport } from "./http-transport";
import { createMcpAudit, type McpAudit } from "./mcp-audit";
import { createMcpClients, MCP_KEYCHAIN_SERVICE, type McpClients } from "./mcp-clients";
import { createMcpServer, type McpServer } from "./mcp-server";
import { createMcpTools, type McpData } from "./mcp-tools";
import { createRateLimiter } from "./rate-limit";
import { startSocketTransport, type RunningTransport } from "./socket-transport";

export interface McpService {
  status(): McpStatus;
  /** Starts and stops what the settings now ask for. Calls queue, so they never overlap. */
  apply(): Promise<McpStatus>;
  stop(): Promise<void>;
  /** The apps the owner approved, and their tokens. */
  readonly clients: McpClients;
  /** What the apps called. */
  readonly audit: McpAudit;
  readonly server: McpServer;
  /** "Delete all data and reset": removes every app and the log. */
  reset(): Promise<void>;
}

export function createMcpService(deps: {
  settings(): McpSettings;
  db: DatabaseSync;
  data: McpData;
  keychain: Keychain;
  /** Where the socket is made, in the data folder. */
  socketPath: string;
  serverVersion: string;
  logger: Logger;
  now(): number;
  newId(): string;
}): McpService {
  const { logger } = deps;

  let socket: (RunningTransport & { disconnect(clientId: string): void }) | null = null;
  let http: (RunningTransport & { port: number }) | null = null;
  const problems = { stdio: null as string | null, http: null as string | null };
  let queue: Promise<unknown> = Promise.resolve();

  const clients = createMcpClients(deps.db, {
    keychain: deps.keychain,
    newId: deps.newId,
    now: deps.now,
    logger,
    // A token that was removed or replaced ends the app's connections now.
    onEnded: (id) => socket?.disconnect(id),
  });
  const audit = createMcpAudit(deps.db);

  const server = createMcpServer({
    tools: createMcpTools(deps.data),
    serverName: "murmur",
    serverVersion: deps.serverVersion,
    rateLimiter: createRateLimiter({
      limit: () => deps.settings().rateLimitPerMinute,
      now: deps.now,
    }),
    // A tool that writes works only while its switch is on.
    writeAllowed: (tool) => {
      const write = deps.settings().write;
      return tool.name === "create_task"
        ? write.createTask
        : tool.name === "add_note"
          ? write.addNote
          : false;
    },
    onCall: (event) => {
      // Names and sizes only: the arguments and the result stay out of the log and the table.
      logger.info(
        `[mcp] ${event.client} ${event.tool} ${event.ok ? "ok" : "refused"} (${event.resultBytes} bytes)`,
      );
      try {
        audit.record({ at: deps.now(), ...event });
      } catch {
        logger.warn("[mcp] a call could not be written to the log");
      }
    },
  });

  async function reconcile(): Promise<McpStatus> {
    const settings = deps.settings();
    const wantSocket = settings.enabled && settings.transport.stdio;
    const wantHttp = settings.enabled && settings.transport.http;

    if (!wantSocket && socket) {
      await socket.close();
      socket = null;
    }
    if (http && (!wantHttp || http.port !== settings.http.port)) {
      await http.close();
      http = null;
    }

    problems.stdio = null;
    problems.http = null;
    if (wantSocket && !socket) {
      try {
        socket = await startSocketTransport({
          path: deps.socketPath,
          server,
          logger,
          authenticate: (token) => {
            const client = clients.authenticate(token);
            return client ? { id: client.id, name: client.name } : null;
          },
          isActive: (id) => clients.get(id) !== null,
        });
        logger.info("[mcp] the local socket is on");
      } catch (error) {
        problems.stdio = (error as Error).message;
        logger.warn(`[mcp] ${problems.stdio}`);
      }
    }
    if (wantHttp && !http) {
      try {
        http = await startHttpTransport({
          port: settings.http.port,
          server,
          authenticate: (token) => {
            const client = clients.authenticate(token);
            return client ? { id: client.id, name: client.name } : null;
          },
        });
        logger.info(`[mcp] listening on 127.0.0.1:${http.port}`);
      } catch (error) {
        problems.http = (error as Error).message;
        logger.warn(`[mcp] ${problems.http}`);
      }
    }
    return status();
  }

  function status(): McpStatus {
    const settings = deps.settings();
    if (!settings.enabled && !socket && !http) return MCP_STATUS_OFF;
    return {
      running: socket !== null || http !== null,
      stdio: {
        wanted: settings.enabled && settings.transport.stdio,
        listening: socket !== null,
        path: socket ? deps.socketPath : null,
        problem: problems.stdio,
      },
      http: {
        wanted: settings.enabled && settings.transport.http,
        listening: http !== null,
        url: http ? `http://127.0.0.1:${http.port}${HTTP_PATH}` : null,
        problem: problems.http,
      },
    };
  }

  return {
    server,
    clients,
    audit,
    status,
    apply() {
      const next = queue.then(reconcile, reconcile);
      queue = next.catch(() => undefined);
      return next;
    },
    async stop() {
      await queue.catch(() => undefined);
      if (socket) await socket.close();
      if (http) await http.close();
      socket = null;
      http = null;
    },
    async reset() {
      await clients.reset();
      audit.clear();
      // The one token an earlier version kept for HTTP.
      await deps.keychain.delete(MCP_KEYCHAIN_SERVICE, "http-token").catch(() => false);
    },
  };
}
