import { z } from "zod";

/**
 * Connectors (CN-01). A connector is a provider the owner signed in to (a calendar, a mail
 * service, a chat service). Murmur keeps one account row per sign-in; the tokens are never in the
 * database, in logs or in anything the window can read: they live in the Mac's Keychain, which is
 * reached only through the helper.
 */

/** A Keychain item: a generic password named by a service and an account. */
export const KEYCHAIN_LIMITS = { name: 200, value: 16_384 } as const;

const keychainName = z.string().min(1).max(KEYCHAIN_LIMITS.name);

export const keychainGetPayloadSchema = z.object({
  service: keychainName,
  account: keychainName,
});
export type KeychainGetInput = z.infer<typeof keychainGetPayloadSchema>;

export const keychainGetResultSchema = z.object({
  found: z.boolean(),
  /** Empty when nothing was found. */
  value: z.string().max(KEYCHAIN_LIMITS.value),
});
export type KeychainGetResult = z.infer<typeof keychainGetResultSchema>;

export const keychainSetPayloadSchema = z.object({
  service: keychainName,
  account: keychainName,
  value: z.string().min(1).max(KEYCHAIN_LIMITS.value),
});
export type KeychainSetInput = z.infer<typeof keychainSetPayloadSchema>;

export const keychainSetResultSchema = z.object({ ok: z.literal(true) });

export const keychainDeletePayloadSchema = z.object({
  service: keychainName,
  account: keychainName,
});
export type KeychainDeleteInput = z.infer<typeof keychainDeletePayloadSchema>;

export const keychainDeleteResultSchema = z.object({
  /** False when there was no such item; deleting twice is not an error. */
  deleted: z.boolean(),
});

/** The Keychain as the rest of main sees it. Tests use a fake. */
export interface Keychain {
  get(service: string, account: string): Promise<string | null>;
  set(service: string, account: string, value: string): Promise<void>;
  delete(service: string, account: string): Promise<boolean>;
}

/** The Keychain service name of a connector's tokens (`com.murmur.connector.<id>`). */
export const connectorKeychainService = (connector: string) => `com.murmur.connector.${connector}`;

/**
 * - `connected`: the account works.
 * - `needs_attention`: the token cannot be refreshed or was revoked; the owner reconnects.
 * - `disabled`: the owner turned the account off; nothing is fetched.
 */
export const CONNECTOR_STATUSES = ["connected", "needs_attention", "disabled"] as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];

export const CONNECTOR_STATUS_TEXT: Record<ConnectorStatus, string> = {
  connected: "Connected",
  needs_attention: "Needs attention",
  disabled: "Disabled",
};

/** An account as the window sees it: never a token. */
export interface ConnectorAccount {
  id: string;
  /** The provider id, for example `googleCalendar`. */
  connector: string;
  email: string;
  scopes: string[];
  status: ConnectorStatus;
  /** Why it needs attention, in plain words; null otherwise. */
  statusReason: string | null;
  lastSyncAt: number | null;
  createdAt: number;
}
