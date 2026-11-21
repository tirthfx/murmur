import path from "node:path";
import {
  MCP_CLIENT_KIND_TEXT,
  type McpActionResult,
  type McpConfigPreviewResult,
} from "@murmur/shared";
import { clientConfigPath, diffLines, maskToken, mergeConfig, serverEntry } from "./client-config";
import type { McpClients } from "./mcp-clients";

/** Files, as setup uses them. Tests use a fake. */
export interface ConfigFiles {
  /** The text, or null when there is no such file. */
  read(file: string): string | null;
  /** Writes the whole file, making its folder first; never a half-written file. */
  write(file: string, text: string): void;
}

/** A preview stays valid this long. */
export const PREVIEW_MS = 10 * 60_000;

/**
 * Writing an app's config file (CN-11): Murmur shows what would change and writes only after the
 * owner approves exactly that. The preview remembers the file as it was seen; if the file has
 * changed by the time of the click, nothing is written. A copy of the file that was there is kept
 * beside it first. The token is masked in what the window sees.
 */
export interface McpSetup {
  preview(clientId: string): Promise<McpConfigPreviewResult>;
  /** Writes the file that a preview showed. */
  apply(previewId: string): Promise<McpActionResult>;
}

export function createMcpSetup(deps: {
  clients: McpClients;
  files: ConfigFiles;
  home: string;
  /** The `murmur-mcp` command's path. */
  command(): string;
  socketPath: string;
  newId(): string;
  now(): number;
}): McpSetup {
  interface Pending {
    clientId: string;
    path: string;
    seen: string | null;
    next: string;
    at: number;
  }
  const pending = new Map<string, Pending>();

  return {
    async preview(clientId) {
      const client = deps.clients.get(clientId);
      if (!client) return { ok: false, message: "That app is gone." };
      if (client.kind === "other")
        return {
          ok: false,
          message:
            "Murmur does not know where this app keeps its config. Use the command and address shown for it.",
        };
      const token = await deps.clients.token(clientId);
      if (token === null)
        return {
          ok: false,
          message: "The app's token is not in the Keychain. Make a new token first.",
        };
      const file = clientConfigPath(client.kind, deps.home);
      let seen: string | null;
      try {
        seen = deps.files.read(file);
      } catch {
        return { ok: false, message: "Murmur could not read that file." };
      }
      const merged = mergeConfig(
        seen,
        serverEntry({ command: deps.command(), socketPath: deps.socketPath, token }),
      );
      if (!merged.ok) return merged;

      for (const [id, entry] of pending)
        if (entry.clientId === clientId || deps.now() - entry.at > PREVIEW_MS) pending.delete(id);
      const previewId = deps.newId();
      pending.set(previewId, { clientId, path: file, seen, next: merged.text, at: deps.now() });
      return {
        ok: true,
        preview: {
          previewId,
          clientName: `${client.name} (${MCP_CLIENT_KIND_TEXT[client.kind]})`,
          path: file,
          exists: seen !== null,
          changed: seen !== merged.text,
          lines: diffLines(maskToken(seen ?? "", token), maskToken(merged.text, token)),
          backupPath: seen === null ? null : backupPath(file),
        },
      };
    },

    async apply(previewId) {
      const entry = pending.get(previewId);
      if (!entry || deps.now() - entry.at > PREVIEW_MS)
        return { ok: false, message: "That preview is out of date. Look at the changes again." };
      pending.delete(previewId);
      if (!deps.clients.get(entry.clientId)) return { ok: false, message: "That app is gone." };
      let current: string | null;
      try {
        current = deps.files.read(entry.path);
      } catch {
        return { ok: false, message: "Murmur could not read that file." };
      }
      if (current !== entry.seen)
        return {
          ok: false,
          message:
            "The file changed since you looked at it, so nothing was written. Look at the changes again.",
        };
      try {
        if (current !== null) deps.files.write(backupPath(entry.path), current);
        deps.files.write(entry.path, entry.next);
      } catch {
        return { ok: false, message: "Murmur could not write the file." };
      }
      return {
        ok: true,
        message: `Wrote ${path.basename(entry.path)}. Restart the app so it picks the change up.`,
      };
    },
  };
}

/** Where a copy of a config file is kept before it is changed. */
export const backupPath = (file: string) => `${file}.murmur-backup`;
