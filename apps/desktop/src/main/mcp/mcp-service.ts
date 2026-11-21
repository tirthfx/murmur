import { randomBytes } from "node:crypto";
import { MCP_STATUS_OFF, type Keychain, type McpSettings, type McpStatus } from "@murmur/shared";
import type { Logger } from "../helper/types";
import { HTTP_PATH, startHttpTransport } from "./http-transport";
import { createMcpServer, type McpCallEvent, type McpServer } from "./mcp-server";
import { createMcpTools, type McpData } from "./mcp-tools";
import { createRateLimiter } from "./rate-limit";
import { startSocketTransport, type RunningTransport } from "./socket-transport";

/** The Keychain item that holds the bearer token for HTTP clients. */
export const MCP_TOKEN_ITEM = { service: "com.murmur.mcp", account: "http-token" } as const;

export interface McpService {
  status(): McpStatus;
  /** Starts and stops what the settings now ask for. Calls queue, so they never overlap. */
  apply(): Promise<McpStatus>;
  stop(): Promise<void>;
  /** The server, for tests and for the audit that comes with MCP setup. */
  readonly server: McpServer;
}

export function createMcpService(deps: {
  settings(): McpSettings;
  data: McpData;
  keychain: Keychain;
  /** Where the socket is made, in the data folder. */
  socketPath: string;
  serverVersion: string;
  logger: Logger;
  now(): number;
  /** Told about each tool call: who, which tool and the sizes, never the result. */
  onCall?(event: McpCallEvent): void;
}): McpService {
  const { logger } = deps;
  const server = createMcpServer({
    tools: createMcpTools(deps.data),
    serverName: "murmur",
    serverVersion: deps.serverVersion,
    rateLimiter: createRateLimiter({
      limit: () => deps.settings().rateLimitPerMinute,
      now: deps.now,
    }),
    onCall: (event) => {
      // Counts and names only: the arguments and the result stay out of the log.
      logger.info(
        `[mcp] ${event.client} ${event.tool} ${event.ok ? "ok" : "refused"} (${event.resultBytes} bytes)`,
      );
      deps.onCall?.(event);
    },
  });

  let socket: RunningTransport | null = null;
  let http: (RunningTransport & { port: number }) | null = null;
  let token: string | null = null;
  const problems = { stdio: null as string | null, http: null as string | null };
  let queue: Promise<unknown> = Promise.resolve();

  /** The token kept in the Keychain; made, and kept, the first time it is needed. */
  async function ensureToken(): Promise<string> {
    const existing = await deps.keychain.get(MCP_TOKEN_ITEM.service, MCP_TOKEN_ITEM.account);
    if (existing) return existing;
    const made = randomBytes(32).toString("base64url");
    await deps.keychain.set(MCP_TOKEN_ITEM.service, MCP_TOKEN_ITEM.account, made);
    return made;
  }

  async function reconcile(): Promise<McpStatus> {
    const settings = deps.settings();
    const wantSocket = settings.enabled && settings.transport.stdio;
    const wantHttp = settings.enabled && settings.transport.http;

    if (!wantSocket && socket) {
      await socket.close();
      socket = null;
    }
    if (!wantHttp || (http && http.port !== settings.http.port)) {
      if (http) await http.close();
      http = null;
      token = wantHttp ? token : null;
    }

    problems.stdio = null;
    problems.http = null;
    if (wantSocket && !socket) {
      try {
        socket = await startSocketTransport({ path: deps.socketPath, server, logger });
        logger.info("[mcp] the local socket is on");
      } catch (error) {
        problems.stdio = (error as Error).message;
        logger.warn(`[mcp] ${problems.stdio}`);
      }
    }
    if (wantHttp && !http) {
      try {
        token = await ensureToken();
      } catch {
        problems.http = "Murmur could not use the Keychain for the access token.";
        logger.warn(`[mcp] ${problems.http}`);
      }
      if (token !== null) {
        try {
          http = await startHttpTransport({
            port: settings.http.port,
            server,
            token: () => token,
          });
          logger.info(`[mcp] listening on 127.0.0.1:${http.port}`);
        } catch (error) {
          problems.http = (error as Error).message;
          logger.warn(`[mcp] ${problems.http}`);
        }
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
      token = null;
    },
  };
}
