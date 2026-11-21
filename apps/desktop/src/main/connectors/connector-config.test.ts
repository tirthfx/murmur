import { describe, expect, it, vi } from "vitest";
import { clientSecretItem, createConnectorConfig } from "./connector-config";
import { createHelperKeychain } from "./helper-keychain";

const keychain = (value: string | null = null) => ({
  get: vi.fn(async () => value),
  set: vi.fn(async () => undefined),
  delete: vi.fn(async () => true),
});

const configOf = (text: string | null, kc = keychain()) => {
  const writes: string[] = [];
  const config = createConnectorConfig({
    readFile: () => text,
    writeFile: (written) => void writes.push(written),
    keychain: kc,
  });
  return { config, writes, kc };
};

describe("connector config (CN-01)", () => {
  it("reads the client id of a connector from the file", () => {
    const { config } = configOf(
      JSON.stringify({ google: { clientId: " abc.apps " }, slack: { clientId: "s1" } }),
    );
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
      expect(configOf(text).config.clientId("google")).toBeNull();
    }
    expect(
      createConnectorConfig({
        readFile: () => {
          throw new Error("EACCES");
        },
        writeFile: vi.fn(),
        keychain: keychain(),
      }).clientId("google"),
    ).toBeNull();
  });

  it("keeps the client secret in the Keychain, never in the file", async () => {
    const { config, kc } = configOf(null, keychain("shh"));
    expect(await config.clientSecret("google")).toBe("shh");
    expect(await config.clientSecretSaved("google")).toBe(true);
    expect(kc.get).toHaveBeenCalledWith("com.murmur.connector.google.app", "client-secret");
    expect(clientSecretItem("google")).toEqual({
      service: "com.murmur.connector.google.app",
      account: "client-secret",
    });
    const failing = createConnectorConfig({
      readFile: () => null,
      writeFile: vi.fn(),
      keychain: { ...kc, get: async () => Promise.reject(new Error("locked")) },
    });
    expect(await failing.clientSecret("google")).toBeNull();
    expect(await failing.clientSecretSaved("google")).toBe(false);
  });

  it("writes a client id, keeps the others and any other field, and removes one with null", () => {
    const { config, writes } = configOf(
      JSON.stringify({ google: { clientId: "old", note: "mine" }, slack: { clientId: "s1" } }),
    );
    config.setClientId("google", "  new-id  ");
    expect(JSON.parse(writes[0]!)).toEqual({
      google: { clientId: "new-id", note: "mine" },
      slack: { clientId: "s1" },
    });
    config.setClientId("slack", null);
    expect(JSON.parse(writes[1]!)).toEqual({ google: { clientId: "old", note: "mine" } });
    expect(writes[0]!.endsWith("\n")).toBe(true);
  });

  it("starts a new file when there is none or it is broken", () => {
    const { config, writes } = configOf("{nope");
    config.setClientId("notion", "n1");
    expect(JSON.parse(writes[0]!)).toEqual({ notion: { clientId: "n1" } });
  });

  it("saves and removes a client secret in the Keychain", async () => {
    const { config, kc } = configOf(null);
    await config.setClientSecret("slack", "s3cret");
    expect(kc.set).toHaveBeenCalledWith(
      "com.murmur.connector.slack.app",
      "client-secret",
      "s3cret",
    );
    await config.setClientSecret("slack", null);
    expect(kc.delete).toHaveBeenCalledWith("com.murmur.connector.slack.app", "client-secret");
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
