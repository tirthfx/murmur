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

/**
 * Where the owner's own OAuth apps are named (CN-01). The client ids are in a small JSON file in
 * the data folder, `{ "<connector id>": { "clientId": "..." } }`; a client id is not secret. A
 * client secret is never in the file: it is a Keychain item. The file is read each time, so an
 * edit counts at once; a missing or broken file means nothing is set up.
 */
export function createConnectorConfig(deps: {
  readFile(): string | null;
  keychain: Keychain;
}): ConnectorConfig {
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
  return {
    clientId: (providerId) => read()[providerId]?.clientId ?? null,
    async clientSecret(providerId) {
      const item = clientSecretItem(providerId);
      try {
        return await deps.keychain.get(item.service, item.account);
      } catch {
        return null;
      }
    },
  };
}
