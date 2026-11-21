import { z } from "zod";
import type { Keychain } from "@murmur/shared";
import type { ConnectorConfig } from "./connector-service";

const fileSchema = z.record(
  z.string(),
  z.object({ clientId: z.string().trim().min(1).max(300) }).passthrough(),
);

/** The Keychain item that holds a provider's client secret, for providers that need one. */
export const clientSecretItem = (providerId: string) => ({
  service: `com.murmur.connector.${providerId}.app`,
  account: "client-secret",
});

/** The owner's own OAuth apps: what can be read, and what the Connectors page can change. */
export interface ConnectorConfigStore extends ConnectorConfig {
  /** Saves the client id of a provider, or removes it with null. It is not secret. */
  setClientId(providerId: string, clientId: string | null): void;
  clientSecretSaved(providerId: string): Promise<boolean>;
  /** Saves the client secret in the Keychain, or removes it with null. */
  setClientSecret(providerId: string, secret: string | null): Promise<void>;
}

/**
 * Where the owner's own OAuth apps are named (CN-01). The client ids are in a small JSON file in
 * the data folder, `{ "<connector id>": { "clientId": "..." } }`; a client id is not secret. A
 * client secret is never in the file: it is a Keychain item. The file is read each time, so an
 * edit counts at once; a missing or broken file means nothing is set up.
 */
export function createConnectorConfig(deps: {
  readFile(): string | null;
  writeFile(text: string): void;
  keychain: Keychain;
}): ConnectorConfigStore {
  const read = (): z.infer<typeof fileSchema> => {
    try {
      const text = deps.readFile();
      if (text === null) return {};
      const parsed = fileSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  };
  const secret = async (providerId: string) => {
    const item = clientSecretItem(providerId);
    try {
      return await deps.keychain.get(item.service, item.account);
    } catch {
      return null;
    }
  };
  return {
    clientId: (providerId) => read()[providerId]?.clientId ?? null,
    clientSecret: secret,
    setClientId(providerId, clientId) {
      const file = read();
      if (clientId === null) delete file[providerId];
      else file[providerId] = { ...file[providerId], clientId: clientId.trim() };
      deps.writeFile(`${JSON.stringify(file, null, 2)}\n`);
    },
    async clientSecretSaved(providerId) {
      return (await secret(providerId)) !== null;
    },
    async setClientSecret(providerId, value) {
      const item = clientSecretItem(providerId);
      if (value === null) await deps.keychain.delete(item.service, item.account);
      else await deps.keychain.set(item.service, item.account, value);
    },
  };
}
