import { describe, expect, it, vi } from "vitest";
import {
  CONNECTOR_CATALOGUE,
  DEFAULT_CONNECTOR_SETTINGS,
  type ConnectorAccount,
} from "@murmur/shared";
import { createConnectorConfig } from "./connector-config";
import { buildConnectorsView } from "./connectors-view";

const account = (over: Partial<ConnectorAccount> = {}): ConnectorAccount => ({
  id: "a1",
  connector: "googleCalendar",
  email: "a@example.com",
  scopes: ["read"],
  status: "connected",
  statusReason: null,
  lastSyncAt: null,
  createdAt: 1,
  ...over,
});

function build(
  over: {
    available?: string[];
    accounts?: ConnectorAccount[];
    file?: object;
    secret?: string | null;
    settings?: typeof DEFAULT_CONNECTOR_SETTINGS;
    connecting?: string[];
  } = {},
) {
  const get = vi.fn(async () => over.secret ?? null);
  const config = createConnectorConfig({
    readFile: () => JSON.stringify(over.file ?? {}),
    writeFile: vi.fn(),
    keychain: { get, set: vi.fn(), delete: vi.fn() },
  });
  return {
    get,
    view: buildConnectorsView({
      available: new Set(over.available ?? []),
      accounts: over.accounts ?? [],
      config,
      settings: over.settings ?? DEFAULT_CONNECTOR_SETTINGS,
      isConnecting: (id) => (over.connecting ?? []).includes(id),
    }),
  };
}

describe("Connectors page view (CN-15)", () => {
  it("lists every connector in the catalogue, unavailable ones too, without asking the Keychain", async () => {
    const t = build();
    const view = await t.view;
    expect(view.connectors.map((c) => c.id)).toEqual(CONNECTOR_CATALOGUE.map((c) => c.id));
    expect(view.connectors.every((c) => c.readiness === "unavailable")).toBe(true);
    expect(view.connectors.every((c) => c.accounts.length === 0)).toBe(true);
    expect(view.cacheTtlMinutes).toBe(15);
    expect(t.get).not.toHaveBeenCalled();
  });

  it("says what is missing: the client id, then the client secret, then it is ready", async () => {
    const google = async (over: Parameters<typeof build>[0]) =>
      (await build({ available: ["googleCalendar"], ...over }).view).connectors.find(
        (c) => c.id === "googleCalendar",
      )!;
    expect(await google({})).toMatchObject({ readiness: "not-set-up", clientId: null });
    const idOnly = await google({ file: { googleCalendar: { clientId: "id-1" } } });
    expect(idOnly).toMatchObject({
      readiness: "not-set-up",
      clientId: "id-1",
      clientSecretSaved: false,
    });
    const ready = await google({ file: { googleCalendar: { clientId: "id-1" } }, secret: "s" });
    expect(ready).toMatchObject({ readiness: "ready", clientSecretSaved: true });
    // The value of the secret is never in the view.
    expect(JSON.stringify(ready)).not.toContain('"s"');
  });

  it("needs no secret for a provider that has none", async () => {
    const view = await build({
      available: ["outlookCalendar"],
      file: { outlookCalendar: { clientId: "o1" } },
    }).view;
    expect(view.connectors.find((c) => c.id === "outlookCalendar")).toMatchObject({
      readiness: "ready",
      clientSecret: false,
    });
  });

  it("groups accounts under their connector and marks a sign-in in progress", async () => {
    const view = await build({
      available: ["googleCalendar", "gmail"],
      accounts: [
        account({ id: "a1" }),
        account({
          id: "a2",
          email: "b@example.com",
          status: "needs_attention",
          statusReason: "Gone.",
        }),
        account({ id: "m1", connector: "gmail" }),
        account({ id: "x", connector: "removed" }),
      ],
      connecting: ["gmail"],
    }).view;
    const calendar = view.connectors.find((c) => c.id === "googleCalendar")!;
    expect(calendar.accounts.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(view.connectors.find((c) => c.id === "gmail")).toMatchObject({
      connecting: true,
      accounts: [expect.objectContaining({ id: "m1" })],
    });
    expect(JSON.stringify(view)).not.toContain('"id":"x"');
  });

  it("fills in the sync interval and read-only default, and uses the owner's choice", async () => {
    const view = await build({
      settings: {
        ...DEFAULT_CONNECTOR_SETTINGS,
        cacheTtlMinutes: 30,
        choices: { slack: { syncIntervalMinutes: 60, readOnly: false } },
      },
    }).view;
    expect(view.cacheTtlMinutes).toBe(30);
    expect(view.connectors.find((c) => c.id === "googleCalendar")!.choice).toEqual({
      syncIntervalMinutes: 15,
      readOnly: true,
    });
    expect(view.connectors.find((c) => c.id === "notion")!.choice.syncIntervalMinutes).toBe(30);
    expect(view.connectors.find((c) => c.id === "slack")!.choice).toEqual({
      syncIntervalMinutes: 60,
      readOnly: false,
    });
  });
});
