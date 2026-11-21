import { z } from "zod";
import { connectorKeychainService, type ConnectorAccount, type Keychain } from "@murmur/shared";
import type { Logger } from "../helper/types";
import { clientSecretItem } from "./connector-config";
import type { ConnectorStore } from "./connector-store";
import { startLoopback as realStartLoopback, type Loopback } from "./loopback";
import { createPkce, createState } from "./pkce";
import type { ConnectorProvider, ConnectorRegistry, Http, TokenResponse } from "./providers";

export type ConnectorErrorCode =
  "not-connected" | "disabled" | "needs-attention" | "network" | "keychain" | "failed";

export class ConnectorError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

export type ConnectOutcome =
  | { ok: true; account: ConnectorAccount }
  | {
      ok: false;
      reason: "not-configured" | "busy" | "denied" | "state" | "timeout" | "cancelled" | "failed";
      message: string;
    };

export interface ConnectorConfig {
  /** The OAuth client id the owner registered for a provider; null until they have. */
  clientId(providerId: string): string | null;
  /** The client secret, for providers that need one; kept in the Keychain. */
  clientSecret(providerId: string): Promise<string | null>;
}

export interface ConnectorProviderInfo {
  id: string;
  name: string;
  scopes: string[];
  /** False until the owner has added the OAuth client id for it. */
  configured: boolean;
}

export interface ConnectorService {
  providers(): ConnectorProviderInfo[];
  list(): ConnectorAccount[];
  /**
   * Signs in: opens the provider's page in the system browser, catches the redirect on 127.0.0.1,
   * exchanges the code (PKCE, S256) and keeps the tokens in the Keychain. Several accounts of one
   * provider can be connected; connecting an email that is there already reconnects it.
   */
  connect(
    providerId: string,
    options?: { scopes?: readonly string[]; loginHint?: string },
  ): Promise<ConnectOutcome>;
  /** Stops a sign-in that is waiting for the browser. */
  cancelConnect(providerId: string): void;
  /** Whether a sign-in to this provider is waiting for the browser. */
  isConnecting(providerId: string): boolean;
  /**
   * Revokes the sign-in at the provider (when it can be), deletes the Keychain item and the
   * account with its cache. `revoked` is null when the provider has no revoke endpoint. When the
   * Keychain item cannot be deleted the account is kept and this throws, so it can be retried.
   */
  disconnect(accountId: string): Promise<{ revoked: boolean | null }>;
  /**
   * "Delete all data and reset": disconnects every account, as `disconnect` does, and deletes the
   * client secrets of the providers. An account whose Keychain item cannot be deleted is counted
   * in `kept`.
   */
  reset(): Promise<{ disconnected: number; kept: number }>;
  /** Disabled accounts fetch nothing; turning one on connects it again. */
  setEnabled(accountId: string, enabled: boolean): void;
  /**
   * A valid access token, refreshed first when it ends within 5 minutes. The token is for main's
   * own requests: it is never given to the window.
   */
  accessToken(accountId: string, options?: { rejected?: string }): Promise<string>;
  /** A request with the account's token. A 401 refreshes the token once and asks again. */
  authorizedFetch(accountId: string, url: string, init?: RequestInit): Promise<Response>;
}

/** What is kept in the Keychain for an account: one JSON text. */
interface TokenBlob {
  accessToken: string;
  refreshToken: string | null;
  /** Milliseconds since the epoch; null when the provider gave no lifetime. */
  expiresAt: number | null;
  scopes: string[];
}

const blobSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
  expiresAt: z.number().nullable(),
  scopes: z.array(z.string()),
});

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().positive().optional(),
  scope: z.string().optional(),
});

export const REFRESH_AHEAD_MS = 5 * 60_000;

export interface ConnectorServiceDeps {
  registry: ConnectorRegistry;
  store: ConnectorStore;
  keychain: Keychain;
  config: ConnectorConfig;
  http: Http;
  /** Opens a page in the system browser. */
  openExternal(url: string): Promise<void>;
  now(): number;
  newId(): string;
  logger: Logger;
  onChange?(): void;
  /**
   * Strict local mode: why no network may be used, or null when it may. Connecting is refused
   * with this text before anything is opened.
   */
  networkRefusal?(): string | null;
  /** Tests listen on an address they choose; production uses the real listener. */
  startLoopback?: typeof realStartLoopback;
  random?: Parameters<typeof createPkce>[0];
  refreshAheadMs?: number;
}

const form = (values: Record<string, string>) => new URLSearchParams(values).toString();

const FORM_HEADERS = {
  "content-type": "application/x-www-form-urlencoded",
  accept: "application/json",
};

export function createConnectorService(deps: ConnectorServiceDeps): ConnectorService {
  const { registry, store, keychain, config, http, logger } = deps;
  const refreshAhead = deps.refreshAheadMs ?? REFRESH_AHEAD_MS;
  const startLoopback = deps.startLoopback ?? realStartLoopback;
  const connecting = new Map<string, Loopback>();
  const refreshing = new Map<string, Promise<TokenBlob>>();

  const changed = () => deps.onChange?.();

  const readBlob = async (account: ConnectorAccount): Promise<TokenBlob | null> => {
    let text: string | null;
    try {
      text = await keychain.get(connectorKeychainService(account.connector), account.email);
    } catch {
      throw new ConnectorError("keychain", "Murmur could not read the Keychain just now.");
    }
    if (text === null) return null;
    try {
      return blobSchema.parse(JSON.parse(text));
    } catch {
      return null;
    }
  };

  const writeBlob = async (connector: string, email: string, blob: TokenBlob) => {
    try {
      await keychain.set(connectorKeychainService(connector), email, JSON.stringify(blob));
    } catch {
      throw new ConnectorError("keychain", "Murmur could not save the sign-in to the Keychain.");
    }
  };

  const needsAttention = (account: ConnectorAccount, reason: string): ConnectorError => {
    store.setStatus(account.id, "needs_attention", reason);
    logger.warn(`connector ${account.connector} (${account.id}) needs attention`);
    changed();
    return new ConnectorError("needs-attention", reason);
  };

  const toBlob = (token: TokenResponse, previous: TokenBlob | null): TokenBlob => ({
    accessToken: token.accessToken,
    // A refresh often leaves the refresh token out: the old one stays valid.
    refreshToken: token.refreshToken ?? previous?.refreshToken ?? null,
    expiresAt: token.expiresIn === null ? null : deps.now() + token.expiresIn * 1000,
    scopes: token.scopes.length > 0 ? token.scopes : (previous?.scopes ?? []),
  });

  const parseToken = async (response: Response): Promise<TokenResponse | null> => {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return null;
    }
    const parsed = tokenResponseSchema.safeParse(body);
    if (!parsed.success) return null;
    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token ?? null,
      expiresIn: parsed.data.expires_in ?? null,
      scopes: parsed.data.scope ? parsed.data.scope.split(/[\s,]+/).filter(Boolean) : [],
    };
  };

  const clientAuth = async (
    provider: ConnectorProvider,
  ): Promise<Record<string, string> | null> => {
    const clientId = config.clientId(provider.id);
    if (!clientId) return null;
    if (!provider.needsClientSecret) return { client_id: clientId };
    const secret = await config.clientSecret(provider.id);
    return secret ? { client_id: clientId, client_secret: secret } : null;
  };

  /** One refresh at a time per account: a second caller waits for the first. */
  const refresh = (account: ConnectorAccount, blob: TokenBlob): Promise<TokenBlob> => {
    const running = refreshing.get(account.id);
    if (running) return running;
    const flight = (async (): Promise<TokenBlob> => {
      const provider = registry.get(account.connector);
      if (!provider) throw new ConnectorError("failed", "That connector is not available.");
      if (blob.refreshToken === null)
        throw needsAttention(
          account,
          "The sign-in has ended and cannot be renewed. Connect again.",
        );
      const auth = await clientAuth(provider);
      if (!auth)
        throw new ConnectorError("failed", `The ${provider.name} app is not set up any more.`);
      let response: Response;
      try {
        response = await http(provider.tokenUrl, {
          method: "POST",
          headers: FORM_HEADERS,
          body: form({ grant_type: "refresh_token", refresh_token: blob.refreshToken, ...auth }),
        });
      } catch {
        throw new ConnectorError("network", `Murmur could not reach ${provider.name}.`);
      }
      if (!response.ok) {
        // A refused refresh token will not work later either; a busy provider might.
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408 &&
          response.status !== 429
        )
          throw needsAttention(
            account,
            `${provider.name} no longer accepts this sign-in. Connect again.`,
          );
        throw new ConnectorError("network", `${provider.name} is not answering just now.`);
      }
      const token = await parseToken(response);
      if (!token)
        throw new ConnectorError("failed", `${provider.name} sent an answer Murmur cannot read.`);
      const next = toBlob(token, blob);
      await writeBlob(account.connector, account.email, next);
      return next;
    })().finally(() => refreshing.delete(account.id));
    refreshing.set(account.id, flight);
    return flight;
  };

  const usable = (id: string): ConnectorAccount => {
    const account = store.get(id);
    if (!account) throw new ConnectorError("not-connected", "That account is not connected.");
    if (account.status === "disabled")
      throw new ConnectorError("disabled", "That account is turned off.");
    if (account.status === "needs_attention")
      throw new ConnectorError(
        "needs-attention",
        account.statusReason ?? "That account needs to be connected again.",
      );
    return account;
  };

  const accessToken: ConnectorService["accessToken"] = async (accountId, options = {}) => {
    const account = usable(accountId);
    const running = refreshing.get(account.id);
    if (running) return (await running).accessToken;
    const blob = await readBlob(account);
    if (!blob) throw needsAttention(account, "The saved sign-in is gone. Connect again.");
    // A token another caller already renewed is not renewed again for a late 401.
    const rejected = options.rejected !== undefined && options.rejected === blob.accessToken;
    const due = blob.expiresAt !== null && blob.expiresAt - deps.now() <= refreshAhead;
    if (!rejected && !due) return blob.accessToken;
    return (await refresh(account, blob)).accessToken;
  };

  const withAuth = (init: RequestInit | undefined, token: string): RequestInit => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    return { ...init, headers };
  };

  const revokeAtProvider = async (
    provider: ConnectorProvider,
    blob: TokenBlob,
  ): Promise<boolean | null> => {
    if (!provider.revoke && !provider.revokeUrl) return null;
    const token = blob.refreshToken ?? blob.accessToken;
    const clientId = config.clientId(provider.id) ?? "";
    try {
      if (provider.revoke) {
        await provider.revoke({ token, clientId, http });
        return true;
      }
      const response = await http(provider.revokeUrl!, {
        method: "POST",
        headers: FORM_HEADERS,
        body: form({ token, client_id: clientId }),
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  return {
    providers: () =>
      registry.list().map((provider) => ({
        id: provider.id,
        name: provider.name,
        scopes: [...provider.scopes],
        configured: config.clientId(provider.id) !== null,
      })),
    list: () => store.list(),

    async connect(providerId, options = {}) {
      const provider = registry.get(providerId);
      if (!provider)
        return { ok: false, reason: "failed", message: "That connector is not available." };
      const refusal = deps.networkRefusal?.() ?? null;
      if (refusal !== null) return { ok: false, reason: "failed", message: refusal };
      const auth = await clientAuth(provider);
      if (!auth)
        return {
          ok: false,
          reason: "not-configured",
          message: `Add the OAuth client id for ${provider.name} first.`,
        };
      if (connecting.has(providerId))
        return {
          ok: false,
          reason: "busy",
          message: `A ${provider.name} sign-in is already open.`,
        };

      const path = provider.callbackPath ?? "/callback";
      let loopback: Loopback;
      try {
        loopback = await startLoopback({ port: provider.loopbackPort ?? 0, path });
      } catch (error) {
        return { ok: false, reason: "failed", message: (error as Error).message };
      }
      connecting.set(providerId, loopback);
      try {
        const pkce = createPkce(deps.random);
        const state = createState(deps.random);
        const scopes = [...(options.scopes ?? provider.scopes)];
        const url = new URL(provider.authorizeUrl);
        const query: Record<string, string> = {
          response_type: "code",
          client_id: auth.client_id!,
          redirect_uri: loopback.redirectUri,
          scope: scopes.join(" "),
          state,
          code_challenge: pkce.challenge,
          code_challenge_method: pkce.method,
          ...provider.authorizeParams,
        };
        if (options.loginHint) query.login_hint = options.loginHint;
        for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);

        const redirect = loopback.wait(state);
        try {
          await deps.openExternal(url.toString());
        } catch {
          return { ok: false, reason: "failed", message: "Murmur could not open your browser." };
        }
        const result = await redirect;
        if (!result.ok) return { ok: false, reason: result.reason, message: result.message };

        let response: Response;
        try {
          response = await http(provider.tokenUrl, {
            method: "POST",
            headers: FORM_HEADERS,
            body: form({
              grant_type: "authorization_code",
              code: result.code,
              redirect_uri: loopback.redirectUri,
              code_verifier: pkce.verifier,
              ...auth,
            }),
          });
        } catch {
          return {
            ok: false,
            reason: "failed",
            message: `Murmur could not reach ${provider.name}.`,
          };
        }
        if (!response.ok)
          return {
            ok: false,
            reason: "failed",
            message: `${provider.name} did not accept the sign-in code (${response.status}).`,
          };
        const token = await parseToken(response);
        if (!token)
          return {
            ok: false,
            reason: "failed",
            message: `${provider.name} sent an answer Murmur cannot read.`,
          };

        let label: string;
        try {
          label = (await provider.accountLabel({ token, http })).trim().toLowerCase();
        } catch {
          return {
            ok: false,
            reason: "failed",
            message: `Murmur could not find out which ${provider.name} account signed in.`,
          };
        }
        if (label === "")
          return {
            ok: false,
            reason: "failed",
            message: `${provider.name} did not say which account signed in.`,
          };

        const blob = toBlob(token, null);
        // An empty grant means the provider did not repeat the scopes: they are what was asked.
        if (blob.scopes.length === 0) blob.scopes = scopes;
        try {
          await writeBlob(provider.id, label, blob);
        } catch (error) {
          return { ok: false, reason: "failed", message: (error as Error).message };
        }
        try {
          const account = store.upsertAccount({
            id: deps.newId(),
            connector: provider.id,
            email: label,
            scopes: blob.scopes,
            at: deps.now(),
          });
          logger.info(`connector ${provider.id} connected (${account.id})`);
          changed();
          return { ok: true, account };
        } catch {
          // Do not leave a token behind that no account points to.
          await keychain.delete(connectorKeychainService(provider.id), label).catch(() => false);
          return { ok: false, reason: "failed", message: "Murmur could not save the account." };
        }
      } finally {
        connecting.delete(providerId);
        loopback.close();
      }
    },

    cancelConnect(providerId) {
      connecting.get(providerId)?.close();
    },

    isConnecting: (providerId) => connecting.has(providerId),

    async disconnect(accountId) {
      const account = store.get(accountId);
      if (!account) return { revoked: null };
      const provider = registry.get(account.connector);
      let revoked: boolean | null = null;
      const blob = await readBlob(account).catch(() => null);
      if (blob && provider) revoked = await revokeAtProvider(provider, blob);
      if (revoked === false)
        logger.warn(
          `connector ${account.connector} (${account.id}): the provider did not confirm the revoke`,
        );
      try {
        await keychain.delete(connectorKeychainService(account.connector), account.email);
      } catch {
        throw new ConnectorError(
          "keychain",
          "Murmur could not remove the saved sign-in from the Keychain, so the account was kept. Try again.",
        );
      }
      store.remove(account.id);
      logger.info(`connector ${account.connector} disconnected (${account.id})`);
      changed();
      return { revoked };
    },

    async reset() {
      let disconnected = 0;
      let kept = 0;
      for (const account of store.list()) {
        try {
          await this.disconnect(account.id);
          disconnected++;
        } catch {
          kept++;
        }
      }
      for (const provider of registry.list()) {
        const item = clientSecretItem(provider.id);
        await keychain.delete(item.service, item.account).catch(() => false);
      }
      return { disconnected, kept };
    },

    setEnabled(accountId, enabled) {
      const account = store.get(accountId);
      if (!account) return;
      if (!enabled) store.setStatus(accountId, "disabled", null);
      else if (account.status === "disabled") store.setStatus(accountId, "connected", null);
      changed();
    },

    accessToken,

    async authorizedFetch(accountId, url, init) {
      let token = await accessToken(accountId);
      let response = await http(url, withAuth(init, token));
      if (response.status !== 401) return response;
      await response.body?.cancel().catch(() => undefined);
      token = await accessToken(accountId, { rejected: token });
      response = await http(url, withAuth(init, token));
      if (response.status === 401) {
        const account = store.get(accountId);
        if (account) {
          throw needsAttention(
            account,
            "The provider no longer accepts this sign-in. Connect again.",
          );
        }
      }
      return response;
    },
  };
}
