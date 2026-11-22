/**
 * What the framework needs to know about a provider (CN-01). Each connector (Google Calendar,
 * Slack, ...) is one of these; the OAuth steps, the token storage and the refresh are the same for
 * all of them.
 */
export interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds until the access token expires, when the provider says. */
  expiresIn: number | null;
  scopes: string[];
}

export type Http = (url: string, init?: RequestInit) => Promise<Response>;

export interface ConnectorProvider {
  /** Stable id used in settings, tables and the Keychain service name, for example `googleCalendar`. */
  id: string;
  /** Shown on the Connectors page. */
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** Where a token is revoked; null when the provider has no such endpoint. */
  revokeUrl: string | null;
  /** The scopes asked for when connecting, unless the caller asks for others. */
  scopes: readonly string[];
  /** Extra sign-in parameters, for example `access_type: "offline"`. */
  authorizeParams?: Readonly<Record<string, string>>;
  /** A fixed loopback port for providers that need an exact redirect address; null picks one. */
  loopbackPort: number | null;
  /** `localhost` for providers that register that name for a loopback redirect. Default `127.0.0.1`. */
  redirectHost?: "127.0.0.1" | "localhost";
  /** The path of the redirect address. Default `/callback`. */
  callbackPath?: string;
  /** The provider wants a client secret even with PKCE. It is kept in the Keychain. */
  needsClientSecret?: boolean;
  /** The sign-in parameter that carries the scopes: `scope` (default), `user_scope` (Slack's user token), or none. */
  scopeParam?: "scope" | "user_scope" | null;
  /** What separates the scopes in that parameter: a space (default) or a comma. */
  scopeSeparator?: " " | ",";
  /** How the app proves itself at the token address: in the body (default) or as HTTP Basic. */
  tokenAuth?: "body" | "basic";
  /** The token request is a form (default) or JSON. */
  tokenBody?: "form" | "json";
  /** Extra headers sent with a token request. */
  tokenHeaders?: Readonly<Record<string, string>>;
  /** Reads an answer to a token request that is not the standard shape; null when it cannot be read. */
  parseTokenResponse?(body: unknown): TokenResponse | null;
  /**
   * Learns which account just signed in: its email, or the name the provider shows. It may call
   * the provider with the new access token.
   */
  accountLabel(access: { token: TokenResponse; http: Http }): Promise<string>;
  /** Revokes a token. When missing, the framework posts `token` to `revokeUrl` if there is one. */
  revoke?(input: { token: string; clientId: string; http: Http }): Promise<void>;
}

export interface ConnectorRegistry {
  get(id: string): ConnectorProvider | null;
  list(): ConnectorProvider[];
}

export function createConnectorRegistry(
  providers: readonly ConnectorProvider[],
): ConnectorRegistry {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  if (byId.size !== providers.length) throw new Error("Two connectors have the same id.");
  return {
    get: (id) => byId.get(id) ?? null,
    list: () => [...providers],
  };
}
