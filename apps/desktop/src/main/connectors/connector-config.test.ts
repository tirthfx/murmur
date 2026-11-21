import { describe, expect, it, vi } from "vitest";
import { createConnectorConfig, clientSecretItem } from "./connector-config";
import { createHelperKeychain } from "./helper-keychain";

const keychain = (value: string | null = null) => ({
  get: vi.fn(async () => value),
  set: vi.fn(),
  delete: vi.fn(),
});

describe("connector config (CN-01)", () => {
  it("reads the client id of a connector from the file", () => {
    const config = createConnectorConfig({
      readFile: () =>
        JSON.stringify({ google: { clientId: " abc.apps " }, slack: { clientId: "s1" } }),
      keychain: keychain(),
    });
    expect(config.clientId("google")).toBe("abc.apps");
    expect(config.clientId("slack")).toBe("s1");
    expect(config.clientId("notion")).toBeNull();
  });

  it("treats a missing, broken or wrongly shaped file as nothing set up", () => {
    for (const text of [
      null,
      "",
      "{nope",
      "[]",
      '{"google":{"clientId":""}}',
      '{"google":"abc"}',
    ]) {
      const config = createConnectorConfig({ readFile: () => text, keychain: keychain() });
      expect(config.clientId("google")).toBeNull();
    }
    expect(
      createConnectorConfig({
        readFile: () => {
          throw new Error("EACCES");
        },
        keychain: keychain(),
      }).clientId("google"),
    ).toBeNull();
  });

  it("keeps the client secret in the Keychain, never in the file", async () => {
    const kc = keychain("shh");
    const config = createConnectorConfig({ readFile: () => null, keychain: kc });
    expect(await config.clientSecret("google")).toBe("shh");
    expect(kc.get).toHaveBeenCalledWith("com.murmur.connector.google.app", "client-secret");
    expect(clientSecretItem("google")).toEqual({
      service: "com.murmur.connector.google.app",
      account: "client-secret",
    });
    const failing = createConnectorConfig({
      readFile: () => null,
      keychain: { ...kc, get: async () => Promise.reject(new Error("locked")) },
    });
    expect(await failing.clientSecret("google")).toBeNull();
  });
});

describe("helper keychain (CN-01)", () => {
  it("turns the helper's answers into the Keychain interface", async () => {
    const helper = {
      keychainGet: vi.fn(async (_s: string, account: string) =>
        account === "a" ? { found: true, value: "v" } : { found: false, value: "" },
      ),
      keychainSet: vi.fn(async () => ({ ok: true as const })),
      keychainDelete: vi.fn(async () => ({ deleted: true })),
    };
    const store = createHelperKeychain(helper);
    expect(await store.get("s", "a")).toBe("v");
    expect(await store.get("s", "b")).toBeNull();
    await store.set("s", "a", "x");
    expect(helper.keychainSet).toHaveBeenCalledWith("s", "a", "x");
    expect(await store.delete("s", "a")).toBe(true);
  });
});
