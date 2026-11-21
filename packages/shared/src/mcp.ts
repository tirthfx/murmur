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
  /** Tools that change something are off until the owner turns each one on. */
  write: z
    .strictObject({
      /** `create_task`: adds a suggested task. */
      createTask: z.boolean(),
      /** `add_note`: adds text to a meeting's My notes. */
      addNote: z.boolean(),
    })
    .default({ createTask: false, addNote: false }),
});
export type McpSettings = z.infer<typeof mcpSettingsSchema>;

export const DEFAULT_MCP_SETTINGS: McpSettings = {
  enabled: false,
  transport: { stdio: true, http: false },
  http: { port: MCP_DEFAULT_PORT },
  rateLimitPerMinute: 60,
  write: { createTask: false, addNote: false },
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

// ------------------------------------------------------------------ clients, config, audit

/** The apps Murmur knows how to write a config file for; `other` is shown a command and an address. */
export const MCP_CLIENT_KINDS = ["claude-desktop", "cursor", "other"] as const;
export type McpClientKind = (typeof MCP_CLIENT_KINDS)[number];

export const MCP_CLIENT_KIND_TEXT: Record<McpClientKind, string> = {
  "claude-desktop": "Claude desktop",
  cursor: "Cursor",
  other: "Another app",
};

export const MCP_CLIENT_NAME_MAX = 60;

/** An app the owner approved. It has a token of its own, which is not in this object. */
export interface McpClientInfo {
  id: string;
  name: string;
  kind: McpClientKind;
  createdAt: number;
  lastUsedAt: number | null;
}

export type McpActionResult = { ok: true; message?: string } | { ok: false; message: string };

/** One line of a before and after view of a file. `skip` stands for lines that did not change. */
export interface McpDiffLine {
  kind: "same" | "add" | "remove" | "skip";
  text: string;
}

/** What writing a client's config file would do, for the owner to approve. The token is masked. */
export interface McpConfigPreview {
  /** Names this preview; the write needs it, and only this file as it was seen. */
  previewId: string;
  clientName: string;
  path: string;
  /** False when the file is not there and would be made. */
  exists: boolean;
  /** False when the file already says what Murmur would write. */
  changed: boolean;
  lines: McpDiffLine[];
  /** Where a copy of the current file is kept first; null when there is no file. */
  backupPath: string | null;
}

export type McpConfigPreviewResult =
  { ok: true; preview: McpConfigPreview } | { ok: false; message: string };

/** The apps the owner approved, and what the page needs to tell another app how to connect. */
export interface McpClientsView {
  clients: McpClientInfo[];
  /** The `murmur-mcp` command's path, for an app that is set up by hand. */
  command: string;
  /** The socket the command talks to. */
  socketPath: string;
}

/** A line of the call log. It has the names and sizes, never the arguments or the result. */
export interface McpAuditEntry {
  id: number;
  at: number;
  client: string;
  tool: string;
  ok: boolean;
  resultBytes: number;
  /** The tool changes data. */
  write: boolean;
}
