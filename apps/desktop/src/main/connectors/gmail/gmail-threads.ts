import type { GmailThread } from "@murmur/shared";
import { ConnectorError, type ConnectorService } from "../connector-service";
import type { ConnectorStore } from "../connector-store";
import { GmailError, recentThreadsWith } from "./gmail";
import { gmailReader } from "./gmail-reader";

/** Fifteen minutes: briefs do not ask Gmail again for the same people (CN-04). */
export const THREADS_TTL_MS = 15 * 60_000;

/**
 * Recent threads with some addresses, for a brief (NT-11): read through the first connected Gmail
 * account that has the read permission, as plain text, and kept for 15 minutes so briefs do not
 * ask Gmail again and again. The token only goes to Gmail, and an attachment is never fetched.
 * Throws an `Error` whose message is plain words for the owner.
 */
export function createGmailThreads(deps: {
  connectors: Pick<ConnectorService, "list" | "authorizedFetch">;
  connectorStore: Pick<ConnectorStore, "cacheGet" | "cachePut">;
  now(): number;
}): (emails: string[], max: number) => Promise<GmailThread[]> {
  return async (emails, max) => {
    const reader = gmailReader(deps.connectors);
    if (!reader) throw new Error("Gmail has not been given permission to read mail.");
    const key = `${[...emails].sort().join(",")}|${max}`;
    const kept = deps.connectorStore.cacheGet(reader.id, "brief-threads", key, deps.now());
    if (kept !== null) {
      try {
        return JSON.parse(kept) as GmailThread[];
      } catch {
        // A damaged copy is read again.
      }
    }
    try {
      const threads = await recentThreadsWith({ fetch: reader.fetch, emails, max });
      deps.connectorStore.cachePut(
        reader.id,
        "brief-threads",
        key,
        JSON.stringify(threads),
        deps.now(),
        THREADS_TTL_MS,
      );
      return threads;
    } catch (error) {
      if (error instanceof GmailError || error instanceof ConnectorError)
        throw new Error(error.message, { cause: error });
      throw new Error("Gmail could not be read.", { cause: error });
    }
  };
}
