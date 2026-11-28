import { describe, expect, it } from "vitest";
import {
  CONNECTOR_CATALOGUE,
  CONNECTOR_FEATURES,
  connectorChoice,
  connectorFeatureState,
  connectorFeatureStates,
  connectorSettingsSchema,
  DEFAULT_CONNECTOR_SETTINGS,
  isClientCredential,
  type ConnectorAccount,
  type ConnectorReadiness,
  type ConnectorView,
} from "./connectors";

const view = (
  id: string,
  over: { accounts?: Partial<ConnectorAccount>[]; readiness?: ConnectorReadiness } = {},
): ConnectorView => {
  const entry = CONNECTOR_CATALOGUE.find((c) => c.id === id)!;
  return {
    ...entry,
    readiness: over.readiness ?? "ready",
    clientId: null,
    clientSecretSaved: false,
    choice: connectorChoice(DEFAULT_CONNECTOR_SETTINGS, entry),
    connecting: false,
    accounts: (over.accounts ?? []).map((account, index) => ({
      id: `${id}-${index}`,
      connector: id,
      email: `p${index}@example.com`,
      scopes: [],
      status: "connected",
      statusReason: null,
      lastSyncAt: null,
      createdAt: 1,
      ...account,
    })),
  };
};

const all = (over: Record<string, Parameters<typeof view>[1]> = {}) => ({
  connectors: CONNECTOR_CATALOGUE.map((entry) => view(entry.id, over[entry.id])),
});

const feature = (id: string) => CONNECTOR_FEATURES.find((f) => f.id === id)!;

describe("connector catalogue (CN-15)", () => {
  it("has the nine connectors, with unique ids and plain-word scopes", () => {
    expect(CONNECTOR_CATALOGUE.map((c) => c.id)).toEqual([
      "googleCalendar",
      "outlookCalendar",
      "gmail",
      "slack",
      "notion",
      "linear",
      "github",
      "zoom",
      "fireflies",
    ]);
    expect(new Set(CONNECTOR_CATALOGUE.map((c) => c.id)).size).toBe(9);
    for (const entry of CONNECTOR_CATALOGUE) {
      expect(entry.scopes.length).toBeGreaterThan(0);
      expect(entry.reads.endsWith(".")).toBe(true);
      // A read-only switch means something only when there is a write scope.
      expect(entry.supportsWrite).toBe(entry.writes !== null);
    }
  });

  it("only names connectors that exist in the features that use them", () => {
    const ids = new Set(CONNECTOR_CATALOGUE.map((c) => c.id));
    for (const f of CONNECTOR_FEATURES)
      for (const id of f.connectors) expect(ids.has(id)).toBe(true);
  });

  it("every connector is used by some feature", () => {
    for (const entry of CONNECTOR_CATALOGUE)
      expect(CONNECTOR_FEATURES.some((f) => f.connectors.includes(entry.id))).toBe(true);
  });
});

describe("connector settings", () => {
  it("defaults to a 15 minute cache and no choices, and fills in the catalogue's defaults", () => {
    expect(connectorSettingsSchema.parse(DEFAULT_CONNECTOR_SETTINGS)).toEqual({
      cacheTtlMinutes: 15,
      choices: {},
      gmail: { briefContext: false, draftEnabled: false, maxThreadsPerBrief: 5 },
      slack: { channels: [], privateChannels: false },
      notion: { maxCharsPerPage: 10_000 },
      linear: { teams: [], assignedOnly: true },
      github: { repos: [] },
      zoom: { rangeDays: 30, autoImport: false },
      fireflies: { rangeDays: 30, importProviderSummary: true, autoImport: false },
      featuresOff: [],
      calendars: {},
      privateTitlesAsBusy: false,
    });
    const calendar = CONNECTOR_CATALOGUE[0]!;
    const notion = CONNECTOR_CATALOGUE.find((c) => c.id === "notion")!;
    expect(connectorChoice(DEFAULT_CONNECTOR_SETTINGS, calendar)).toEqual({
      syncIntervalMinutes: 15,
      readOnly: true,
    });
    expect(connectorChoice(DEFAULT_CONNECTOR_SETTINGS, notion).syncIntervalMinutes).toBe(30);
  });

  it("rejects an interval under 5 minutes or an unknown field", () => {
    expect(
      connectorSettingsSchema.safeParse({
        cacheTtlMinutes: 15,
        choices: { slack: { syncIntervalMinutes: 1, readOnly: true } },
      }).success,
    ).toBe(false);
    expect(
      connectorSettingsSchema.safeParse({ cacheTtlMinutes: 15, choices: {}, extra: 1 }).success,
    ).toBe(false);
  });

  it("accepts a client credential of one piece, and nothing else", () => {
    expect(isClientCredential("123-abc.apps.googleusercontent.com")).toBe(true);
    expect(isClientCredential("")).toBe(false);
    expect(isClientCredential("has space")).toBe(false);
    expect(isClientCredential("a".repeat(301))).toBe(false);
  });
});

describe("a feature that needs a connector (CN-15)", () => {
  it("works when any one of its connectors has a connected account", () => {
    const state = connectorFeatureState(
      feature("reminders"),
      all({ outlookCalendar: { accounts: [{}] } }),
    );
    expect(state).toMatchObject({ enabled: true, reason: null, reconnect: null });
  });

  it("is off with a reason that names what to connect", () => {
    const state = connectorFeatureState(feature("reminders"), all());
    expect(state).toMatchObject({
      enabled: false,
      reason: "Connect Google Calendar or Outlook calendar to use this.",
    });
    expect(connectorFeatureState(feature("email-drafts"), all()).reason).toBe(
      "Connect Gmail to use this.",
    );
    expect(connectorFeatureState(feature("calendar-events"), all()).reason).toBe(
      "Connect Google Calendar or Outlook calendar to use this.",
    );
  });

  it("says a feature that is not built yet is not on, even with its connectors connected", () => {
    const connected = all({
      slack: { accounts: [{ id: "s", status: "connected" } as never] },
      gmail: { accounts: [{ id: "g", status: "connected" } as never] },
    });
    const unbuilt = { ...feature("email-drafts"), built: false };
    expect(connectorFeatureState(unbuilt, connected)).toMatchObject({
      enabled: false,
      reason: "Not built yet. Connecting an account does not turn it on.",
    });
  });

  it("says when the connectors it needs are not built yet", () => {
    const unbuilt = {
      connectors: CONNECTOR_CATALOGUE.map((entry) => view(entry.id, { readiness: "unavailable" })),
    };
    expect(connectorFeatureState(feature("email-drafts"), unbuilt).reason).toBe(
      "Needs Gmail, which is not built yet.",
    );
    // One built connector is enough to ask for a connection instead.
    const some = all({
      googleCalendar: { readiness: "unavailable" },
      outlookCalendar: { readiness: "ready" },
    });
    expect(connectorFeatureState(feature("reminders"), some).reason).toContain("Connect");
  });

  it("asks to reconnect an account that needs attention, naming it", () => {
    const state = connectorFeatureState(
      feature("reminders"),
      all({
        googleCalendar: {
          accounts: [{ id: "g1", email: "me@example.com", status: "needs_attention" }],
        },
      }),
    );
    expect(state).toEqual({
      feature: feature("reminders"),
      enabled: false,
      reason: "Reconnect Google Calendar (me@example.com) to use this.",
      reconnect: { connectorId: "googleCalendar", accountId: "g1", email: "me@example.com" },
    });
  });

  it("prefers a working account over one that needs attention", () => {
    const state = connectorFeatureState(
      feature("reminders"),
      all({
        googleCalendar: { accounts: [{ status: "needs_attention" }] },
        outlookCalendar: { accounts: [{}] },
      }),
    );
    expect(state.enabled).toBe(true);
  });

  it("says a turned-off account is why", () => {
    const state = connectorFeatureState(
      feature("email-drafts"),
      all({ gmail: { accounts: [{ status: "disabled" }] } }),
    );
    expect(state).toMatchObject({
      enabled: false,
      reason: "The account is turned off on the Connectors page.",
    });
  });

  it("gives a state for every feature", () => {
    const states = connectorFeatureStates(all());
    expect(states.map((s) => s.feature.id)).toEqual(CONNECTOR_FEATURES.map((f) => f.id));
    expect(states.every((s) => !s.enabled && s.reason)).toBe(true);
  });
});
