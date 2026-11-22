import {
  CONNECTOR_CATALOGUE,
  connectorChoice,
  type ConnectorAccount,
  type ConnectorCatalogueEntry,
  type ConnectorSettings,
  type ConnectorsView,
  type ConnectorView,
} from "@murmur/shared";
import type { ConnectorConfigStore } from "./connector-config";

/**
 * What the Connectors page shows (CN-15): every connector in the catalogue with its accounts,
 * whether it can be connected yet, and the owner's choices. It reads only local state, so it needs
 * no network; a client secret is reported as saved or not and its value is never read into the
 * view. Accounts carry no token.
 */
export async function buildConnectorsView(deps: {
  catalogue?: readonly ConnectorCatalogueEntry[];
  /** The providers that are built: the registry's ids. */
  available: ReadonlySet<string>;
  accounts: readonly ConnectorAccount[];
  config: ConnectorConfigStore;
  settings: ConnectorSettings;
  isConnecting(id: string): boolean;
}): Promise<ConnectorsView> {
  const catalogue = deps.catalogue ?? CONNECTOR_CATALOGUE;
  const connectors = await Promise.all(
    catalogue.map(async (entry): Promise<ConnectorView> => {
      const built = deps.available.has(entry.id);
      const clientId = built ? deps.config.clientId(entry.id) : null;
      const secretSaved =
        built && entry.clientSecret ? await deps.config.clientSecretSaved(entry.id) : false;
      // A connector that signs in with a personal key has no app to set up.
      const set =
        entry.auth === "key" || (clientId !== null && (!entry.clientSecret || secretSaved));
      return {
        id: entry.id,
        name: entry.name,
        reads: entry.reads,
        writes: entry.writes,
        scopes: entry.scopes,
        setup: entry.setup,
        clientSecret: entry.clientSecret,
        supportsWrite: entry.supportsWrite,
        ...(entry.auth ? { auth: entry.auth } : {}),
        readiness: !built ? "unavailable" : set ? "ready" : "not-set-up",
        clientId,
        clientSecretSaved: secretSaved,
        choice: connectorChoice(deps.settings, entry),
        accounts: deps.accounts.filter((account) => account.connector === entry.id),
        connecting: deps.isConnecting(entry.id),
      };
    }),
  );
  return { connectors, cacheTtlMinutes: deps.settings.cacheTtlMinutes };
}
