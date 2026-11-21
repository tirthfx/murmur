import type { Keychain, PlatformHelper } from "@murmur/shared";

/** The Keychain as connectors use it, answered by the helper (CN-01). */
export function createHelperKeychain(
  helper: Pick<PlatformHelper, "keychainGet" | "keychainSet" | "keychainDelete">,
): Keychain {
  return {
    async get(service, account) {
      const result = await helper.keychainGet(service, account);
      return result.found ? result.value : null;
    },
    async set(service, account, value) {
      await helper.keychainSet(service, account, value);
    },
    async delete(service, account) {
      return (await helper.keychainDelete(service, account)).deleted;
    },
  };
}
