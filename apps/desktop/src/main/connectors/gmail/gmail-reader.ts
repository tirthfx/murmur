import { GMAIL_ID, GMAIL_SCOPE_READ } from "@murmur/shared";
import type { ConnectorService } from "../connector-service";
import { GMAIL_ORIGIN, GmailError } from "./gmail";

/**
 * The first connected Gmail account that may be read, as a fetch that carries its token only to
 * Gmail; null when there is none.
 */
export function gmailReader(
  connectors: Pick<ConnectorService, "list" | "authorizedFetch">,
): { id: string; email: string; fetch(url: string, init?: RequestInit): Promise<Response> } | null {
  const account = connectors
    .list()
    .find(
      (entry) =>
        entry.connector === GMAIL_ID &&
        entry.status === "connected" &&
        entry.scopes.includes(GMAIL_SCOPE_READ),
    );
  if (!account) return null;
  return {
    id: account.id,
    email: account.email,
    fetch: async (url, init) => {
      if (!url.startsWith(`${GMAIL_ORIGIN}/`))
        throw new GmailError("Murmur only talks to Gmail here.");
      return connectors.authorizedFetch(account.id, url, init);
    },
  };
}
