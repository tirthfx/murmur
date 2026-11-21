import { z } from "zod";

/**
 * The local MCP server (CN-11): lets AI clients (Claude desktop, Cursor, ...) read meeting notes,
 * summaries, transcripts and tasks. It runs on this Mac only, is off until the owner turns it on,
 * and returns text, never audio, tokens or other files.
 */

export const MCP_LIMITS = {
  /** A response is cut off rather than sent when it is bigger than this (bytes of JSON text). */
  responseBytes: 200 * 1024,
  /** The most of a meeting one `get_transcript` call returns. */
  transcriptMs: 20 * 60_000,
  /** The most meetings `search_meetings` returns. */
  searchMax: 25,
  /** One JSON-RPC message on the socket or over HTTP. */
  messageBytes: 1024 * 1024,
} as const;

export const MCP_DEFAULT_PORT = 7825;

export const mcpSettingsSchema = z.strictObject({
  /** Off until the owner turns it on. */
  enabled: z.boolean(),
  transport: z.strictObject({
    /** A local socket for the `murmur-mcp` command that desktop clients launch. */
    stdio: z.boolean(),
    /** An address on 127.0.0.1 for clients that take a URL; needs the bearer token. */
    http: z.boolean(),
  }),
  http: z.strictObject({
    port: z.number().int().min(1024).max(65535),
  }),
  /** Calls a minute for one client. */
  rateLimitPerMinute: z.number().int().min(1).max(600),
});
export type McpSettings = z.infer<typeof mcpSettingsSchema>;

export const DEFAULT_MCP_SETTINGS: McpSettings = {
  enabled: false,
  transport: { stdio: true, http: false },
  http: { port: MCP_DEFAULT_PORT },
  rateLimitPerMinute: 60,
};

/** What the Connectors page shows about the server. */
export interface McpStatus {
  /** The server is on and at least one transport is listening. */
  running: boolean;
  stdio: {
    /** On in the settings. */
    wanted: boolean;
    listening: boolean;
    /** The socket's path, to put in a client's config; null when it is not listening. */
    path: string | null;
    /** Why it could not start, in plain words; null otherwise. */
    problem: string | null;
  };
  http: {
    wanted: boolean;
    listening: boolean;
    /** `http://127.0.0.1:<port>/mcp`; null when it is not listening. */
    url: string | null;
    problem: string | null;
  };
}

export const MCP_STATUS_OFF: McpStatus = {
  running: false,
  stdio: { wanted: false, listening: false, path: null, problem: null },
  http: { wanted: false, listening: false, url: null, problem: null },
};
