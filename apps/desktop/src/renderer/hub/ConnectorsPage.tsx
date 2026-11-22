import { useCallback, useEffect, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  CALENDAR_CONNECTOR_IDS,
  CALENDAR_WRITE_SCOPES,
  DATA_CONNECTOR_IDS,
  IMPORT_CONNECTOR_IDS,
  CONNECTOR_FEATURES,
  CONNECTOR_STATUS_TEXT,
  GMAIL_SCOPE_COMPOSE,
  SLACK_SCOPE_WRITE,
  GMAIL_SCOPE_READ,
  SYNC_INTERVALS,
  gmailMissingScopes,
  hasScope,
  connectorFeatureStates,
  type ConnectorAccount,
  type ConnectorActionResult,
  type ConnectorChoice,
  type ConnectorDataStatus,
  type ConnectorSettings,
  type GmailSettings,
  type MeetingFolder,
  type Settings,
  type ConnectorsView,
  type ConnectorView,
} from "@murmur/shared";
import { ConnectorImport, KeyForm } from "./ConnectorImport";
import { ConnectorSelection } from "./ConnectorSelection";
import { McpSection } from "./McpSection";

type BadgeVariant = "neutral" | "info" | "success" | "warning" | "error";

const intervalText = (minutes: number) =>
  minutes < 60
    ? `${minutes} minutes`
    : minutes === 60
      ? "1 hour"
      : `${Math.round(minutes / 60)} hours`;

/** The one status a connector shows: what the owner has to do next, or how its accounts are. */
export function connectorStatus(connector: ConnectorView): {
  label: string;
  variant: BadgeVariant;
} {
  if (connector.readiness === "unavailable") return { label: "Not built yet", variant: "neutral" };
  if (connector.accounts.some((account) => account.status === "needs_attention"))
    return { label: CONNECTOR_STATUS_TEXT.needs_attention, variant: "warning" };
  if (connector.accounts.some((account) => account.status === "connected"))
    return { label: CONNECTOR_STATUS_TEXT.connected, variant: "success" };
  if (connector.accounts.length > 0)
    return { label: CONNECTOR_STATUS_TEXT.disabled, variant: "neutral" };
  if (connector.readiness === "not-set-up") return { label: "Needs setup", variant: "info" };
  return { label: "Not connected", variant: "neutral" };
}

const accountVariant = (account: ConnectorAccount): BadgeVariant =>
  account.status === "connected"
    ? "success"
    : account.status === "needs_attention"
      ? "warning"
      : "neutral";

/** Client id and secret of the owner's own OAuth app (CN-01). The secret is never shown again. */
function AppDetails({
  connector,
  onResult,
}: {
  connector: ConnectorView;
  onResult: (result: ConnectorActionResult, done?: string) => void;
}) {
  const [clientId, setClientId] = useState(connector.clientId ?? "");
  const [secret, setSecret] = useState("");
  const changed = clientId.trim() !== (connector.clientId ?? "") || secret.trim() !== "";

  async function save() {
    if (clientId.trim() !== (connector.clientId ?? "")) {
      const result = await window.murmur.connectorSetClientId(
        connector.id,
        clientId.trim() === "" ? null : clientId.trim(),
      );
      if (!result.ok) return onResult(result);
    }
    if (secret.trim() !== "") {
      const result = await window.murmur.connectorSetClientSecret(connector.id, secret.trim());
      if (!result.ok) return onResult(result);
      setSecret("");
    }
    onResult({ ok: true }, `Saved the ${connector.name} app details.`);
  }

  async function remove() {
    await window.murmur.connectorSetClientId(connector.id, null);
    if (connector.clientSecret) await window.murmur.connectorSetClientSecret(connector.id, null);
    setClientId("");
    setSecret("");
    onResult({ ok: true }, `Removed the ${connector.name} app details.`);
  }

  return (
    <VStack gap={2}>
      <TextInput
        label={`${connector.name} OAuth client id`}
        description="From the app you registered. It is not secret."
        value={clientId}
        onChange={setClientId}
      />
      {connector.clientSecret ? (
        <TextInput
          label={`${connector.name} client secret`}
          type="password"
          isOptional={connector.clientSecretSaved}
          description={
            connector.clientSecretSaved
              ? "A secret is saved in the Keychain. Type a new one to replace it."
              : "Kept in the Keychain. Murmur does not show it again."
          }
          value={secret}
          onChange={setSecret}
        />
      ) : null}
      <HStack gap={2} wrap="wrap">
        <Button
          variant="primary"
          size="sm"
          label={`Save the ${connector.name} app details`}
          isDisabled={!changed}
          onClick={() => void save()}
        >
          Save
        </Button>
        {connector.clientId !== null ? (
          <Button
            variant="ghost"
            size="sm"
            label={`Remove the ${connector.name} app details`}
            onClick={() => void remove()}
          >
            Remove
          </Button>
        ) : null}
      </HStack>
    </VStack>
  );
}

/** The Connectors page (CN-15): what Murmur can sign in to, and what needs attention. */
export function ConnectorsPage() {
  const [view, setView] = useState<ConnectorsView | null>(null);
  const [settings, setSettings] = useState<ConnectorSettings | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<ConnectorDataStatus[]>([]);
  const [notetaker, setNotetaker] = useState<Settings["notetaker"] | null>(null);
  const [folders, setFolders] = useState<MeetingFolder[]>([]);

  const reload = useCallback(async () => {
    try {
      setView(await window.murmur.connectorsView());
      setDataStatus(await window.murmur.connectorDataStatus());
    } catch {
      setMessage({ text: "The connectors could not be read.", ok: false });
    }
  }, []);

  useEffect(() => {
    void reload();
    window.murmur.getSettings().then(
      (current) => {
        setSettings(current.settings.connectors);
        setNotetaker(current.settings.notetaker);
      },
      () => setSettings(null),
    );
    window.murmur.foldersList().then(setFolders, () => setFolders([]));
    // A sign-in finishes in the browser and a token can stop working while the page is open.
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  const report = (result: ConnectorActionResult, done?: string) => {
    setMessage({
      text: result.ok ? (done ?? result.message ?? "Done.") : result.message,
      ok: result.ok,
    });
    void reload();
  };

  async function connect(connector: ConnectorView, loginHint?: string) {
    setWaiting(connector.id);
    setMessage(null);
    try {
      report(await window.murmur.connectorConnect(connector.id, loginHint));
    } finally {
      setWaiting(null);
    }
  }

  async function disconnect(account: ConnectorAccount) {
    setConfirm(null);
    report(await window.murmur.connectorDisconnect(account.id));
  }

  /** The folder a meeting started from this calendar goes in; null is the usual one. */
  async function chooseFolder(account: ConnectorAccount, folderId: string | null) {
    if (!notetaker) return;
    const defaults = { ...notetaker.calendar.defaultFolders };
    if (folderId === null) delete defaults[account.id];
    else defaults[account.id] = folderId;
    const updated = await window.murmur.updateSettings({
      notetaker: { ...notetaker, calendar: { ...notetaker.calendar, defaultFolders: defaults } },
    });
    setNotetaker(updated.settings.notetaker);
  }

  /** Saves what a read connector may read, then reads the account again with the new choice. */
  async function saveData(patch: Partial<ConnectorSettings>, accountIds: readonly string[]) {
    if (!settings) return;
    const updated = await window.murmur.updateSettings({ connectors: { ...settings, ...patch } });
    setSettings(updated.settings.connectors);
    for (const id of accountIds) await window.murmur.connectorSync(id);
    await reload();
  }

  async function syncNow(account: ConnectorAccount) {
    setSyncing(account.id);
    try {
      report(await window.murmur.connectorSync(account.id));
    } finally {
      setSyncing(null);
    }
  }

  /** What Murmur may do with Gmail (CN-04). A permission is asked for only when its feature is on. */
  async function setGmail(patch: Partial<GmailSettings>) {
    if (!settings) return;
    const updated = await window.murmur.updateSettings({
      connectors: { ...settings, gmail: { ...settings.gmail, ...patch } },
    });
    setSettings(updated.settings.connectors);
  }

  async function choose(connector: ConnectorView, patch: Partial<ConnectorChoice>) {
    if (!settings) return;
    const next: ConnectorSettings = {
      ...settings,
      choices: { ...settings.choices, [connector.id]: { ...connector.choice, ...patch } },
    };
    const updated = await window.murmur.updateSettings({ connectors: next });
    setSettings(updated.settings.connectors);
    void reload();
  }

  if (!view) {
    return message ? <Banner status="error" title={message.text} /> : <Text>Loading…</Text>;
  }

  const attention = view.connectors.flatMap((connector) =>
    connector.accounts
      .filter((account) => account.status === "needs_attention")
      .map((account) => ({ connector, account })),
  );
  const features = connectorFeatureStates(view);

  return (
    <VStack gap={4}>
      <Text color="secondary">
        Connect a calendar or another service so Murmur can use it for meetings. You sign in in your
        own browser, with an app you registered yourself. Murmur reads only what the features you
        turn on need, keeps the sign-in in the Mac&apos;s Keychain, and keeps what it fetches on
        this Mac for {view.cacheTtlMinutes} minutes.
      </Text>

      {attention.map(({ connector, account }) => (
        <Banner
          key={account.id}
          status="warning"
          title={`${connector.name} (${account.email}) needs to be connected again`}
          description={account.statusReason ?? "The sign-in no longer works."}
          endContent={
            <Button
              variant="secondary"
              label={`Reconnect ${connector.name} ${account.email}`}
              isDisabled={waiting !== null}
              onClick={() => void connect(connector, account.email)}
            >
              Reconnect
            </Button>
          }
        />
      ))}

      {message ? (
        <Banner status={message.ok ? "success" : "error"} title={message.text} role="status" />
      ) : null}

      <section aria-labelledby="connector-features">
        <VStack gap={2}>
          <Text weight="semibold" id="connector-features">
            What needs a connector
          </Text>
          <ul className="hub-connectors" aria-label="Features that use connectors">
            {features.map((state) => (
              <li key={state.feature.id} className="hub-connector">
                <HStack gap={2} align="center" wrap="wrap">
                  <Text weight="semibold">{state.feature.name}</Text>
                  <Badge
                    variant={state.enabled ? "success" : "neutral"}
                    label={state.enabled ? "On" : "Off"}
                  />
                </HStack>
                <Text size="sm" color="secondary">
                  {state.feature.detail}
                </Text>
                {state.reason ? <Text size="sm">{state.reason}</Text> : null}
              </li>
            ))}
          </ul>
        </VStack>
      </section>

      <section aria-labelledby="connector-list">
        <VStack gap={2}>
          <Text weight="semibold" id="connector-list">
            Connectors
          </Text>
          <ul className="hub-connectors" aria-label="Connectors">
            {view.connectors.map((connector) => {
              const status = connectorStatus(connector);
              const users = CONNECTOR_FEATURES.filter((feature) =>
                feature.connectors.includes(connector.id),
              );
              return (
                <li key={connector.id} className="hub-connector" aria-label={connector.name}>
                  <VStack gap={2}>
                    <HStack gap={2} align="center" wrap="wrap">
                      <Text weight="semibold">{connector.name}</Text>
                      <Badge variant={status.variant} label={status.label} />
                    </HStack>
                    <Text size="sm">{connector.reads}</Text>
                    {connector.writes ? (
                      <Text size="sm" color="secondary">
                        It can also do this, only when you allow it: {connector.writes}
                      </Text>
                    ) : null}
                    <div>
                      <Text size="sm" weight="semibold">
                        What you agree to
                      </Text>
                      <ul className="hub-connector-list">
                        {connector.scopes.map((scope) => (
                          <li key={scope.text}>
                            <Text size="sm">
                              {scope.text}
                              {scope.optional ? " (only when a feature needs it)" : ""}
                            </Text>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <Text size="sm" color="secondary">
                      Used by: {users.map((feature) => feature.name).join(", ")}.
                    </Text>

                    {connector.readiness === "unavailable" ? (
                      <Text size="sm" color="secondary">
                        This connector is not built yet. It will need: {connector.setup}
                      </Text>
                    ) : (
                      <>
                        {connector.readiness === "not-set-up" ? (
                          <Text size="sm">Before you can connect, set up: {connector.setup}</Text>
                        ) : null}
                        {connector.auth === "key" ? null : (
                          <details open={connector.readiness === "not-set-up"}>
                            <summary>
                              <Text size="sm" as="span">
                                Your {connector.name} app
                              </Text>
                            </summary>
                            <AppDetails
                              key={`${connector.id}:${connector.clientId ?? ""}`}
                              connector={connector}
                              onResult={report}
                            />
                          </details>
                        )}

                        {connector.accounts.length > 0 ? (
                          <ul
                            className="hub-connector-list"
                            aria-label={`${connector.name} accounts`}
                          >
                            {connector.accounts.map((account) => (
                              <li key={account.id}>
                                <HStack gap={2} align="center" wrap="wrap">
                                  <Text weight="semibold">{account.email}</Text>
                                  <Badge
                                    variant={accountVariant(account)}
                                    label={CONNECTOR_STATUS_TEXT[account.status]}
                                  />
                                  <Text size="sm" color="secondary">
                                    {account.lastSyncAt
                                      ? `Last synced ${new Date(account.lastSyncAt).toLocaleString()}`
                                      : "Not synced yet"}
                                  </Text>
                                  {account.status === "needs_attention" ? (
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      label={`Reconnect ${account.email}`}
                                      isDisabled={waiting !== null}
                                      onClick={() => void connect(connector, account.email)}
                                    >
                                      Reconnect
                                    </Button>
                                  ) : (
                                    <Switch
                                      label={`Use ${account.email}`}
                                      value={account.status === "connected"}
                                      onChange={(on) =>
                                        void window.murmur
                                          .connectorSetEnabled(account.id, on)
                                          .then(reload)
                                      }
                                    />
                                  )}
                                  {account.status === "connected" &&
                                  ((CALENDAR_CONNECTOR_IDS as readonly string[]).includes(
                                    connector.id,
                                  ) ||
                                    (DATA_CONNECTOR_IDS as readonly string[]).includes(
                                      connector.id,
                                    )) ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      label={`Read ${account.email} now`}
                                      isDisabled={syncing === account.id}
                                      onClick={() => void syncNow(account)}
                                    >
                                      Read now
                                    </Button>
                                  ) : null}
                                  {account.status === "connected" &&
                                  (CALENDAR_CONNECTOR_IDS as readonly string[]).includes(
                                    connector.id,
                                  ) &&
                                  notetaker ? (
                                    <Selector
                                      label={`Meetings from ${account.email} go to`}
                                      value={
                                        notetaker.calendar.defaultFolders[account.id] ?? "usual"
                                      }
                                      options={[
                                        { value: "usual", label: "The usual folder" },
                                        ...folders.map((folder) => ({
                                          value: folder.id,
                                          label: folder.name,
                                        })),
                                      ]}
                                      onChange={(value) =>
                                        void chooseFolder(account, value === "usual" ? null : value)
                                      }
                                    />
                                  ) : null}
                                  {confirm === account.id ? (
                                    <HStack gap={1}>
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        label={`Disconnect ${account.email} and delete what Murmur saved for it`}
                                        onClick={() => void disconnect(account)}
                                      >
                                        Disconnect and delete its data
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        label="Keep it connected"
                                        onClick={() => setConfirm(null)}
                                      >
                                        Cancel
                                      </Button>
                                    </HStack>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      label={`Disconnect ${account.email}`}
                                      onClick={() => setConfirm(account.id)}
                                    >
                                      Disconnect…
                                    </Button>
                                  )}
                                </HStack>
                              </li>
                            ))}
                          </ul>
                        ) : null}

                        {connector.auth === "key" && connector.readiness === "ready" ? (
                          <KeyForm
                            connector={connector}
                            onResult={(result) =>
                              report(
                                result.ok
                                  ? {
                                      ok: true,
                                      ...(result.message ? { message: result.message } : {}),
                                    }
                                  : {
                                      ok: false,
                                      message: result.message ?? "The key was not accepted.",
                                    },
                              )
                            }
                          />
                        ) : connector.readiness === "ready" ? (
                          waiting === connector.id || connector.connecting ? (
                            <HStack gap={2} align="center">
                              <Text size="sm">Waiting for your browser…</Text>
                              <Button
                                size="sm"
                                variant="secondary"
                                label={`Cancel the ${connector.name} sign-in`}
                                onClick={() => void window.murmur.connectorCancel(connector.id)}
                              >
                                Cancel
                              </Button>
                            </HStack>
                          ) : (
                            <div>
                              <Button
                                variant="primary"
                                size="sm"
                                label={
                                  connector.accounts.length > 0
                                    ? `Connect another ${connector.name} account`
                                    : `Connect ${connector.name}`
                                }
                                isDisabled={waiting !== null}
                                onClick={() => void connect(connector)}
                              >
                                {connector.accounts.length > 0
                                  ? "Connect another account"
                                  : "Connect"}
                              </Button>
                            </div>
                          )
                        ) : null}

                        {(IMPORT_CONNECTOR_IDS as readonly string[]).includes(connector.id) &&
                        settings
                          ? connector.accounts
                              .filter((entry) => entry.status === "connected")
                              .map((entry) => (
                                <ConnectorImport
                                  key={entry.id}
                                  connector={connector}
                                  account={entry}
                                  settings={settings}
                                  save={(patch) => saveData(patch, [])}
                                  onImported={() =>
                                    setMessage({
                                      text: "Imported the meeting. It is in the Notetaker page.",
                                      ok: true,
                                    })
                                  }
                                />
                              ))
                          : null}

                        {(DATA_CONNECTOR_IDS as readonly string[]).includes(connector.id) &&
                        connector.accounts.length > 0 &&
                        settings ? (
                          <ConnectorSelection
                            connector={connector}
                            settings={settings}
                            status={dataStatus}
                            save={(patch) =>
                              saveData(
                                patch,
                                connector.accounts
                                  .filter((entry) => entry.status === "connected")
                                  .map((entry) => entry.id),
                              )
                            }
                          />
                        ) : null}

                        {connector.id === "gmail" && connector.accounts.length > 0 && settings ? (
                          <VStack gap={2}>
                            <Switch
                              label="Read recent mail with the people in a meeting"
                              description="For meeting briefs. Murmur asks Google for permission to read your mail only when this is on. Attachments are never fetched."
                              value={settings.gmail.briefContext}
                              onChange={(briefContext) => void setGmail({ briefContext })}
                            />
                            <Switch
                              label="Let me create drafts from tasks and summaries"
                              description="Murmur makes a draft in Gmail after you have read it. It never sends mail. It asks Google for permission to create drafts only when this is on."
                              value={settings.gmail.draftEnabled}
                              onChange={(draftEnabled) => void setGmail({ draftEnabled })}
                            />
                            {connector.accounts
                              .filter((entry) => entry.status === "connected")
                              .map((entry) => {
                                const missing = gmailMissingScopes(settings.gmail, entry.scopes);
                                if (missing.length === 0) return null;
                                const words = [
                                  missing.includes(GMAIL_SCOPE_READ) ? "read your mail" : null,
                                  missing.includes(GMAIL_SCOPE_COMPOSE) ? "create drafts" : null,
                                ]
                                  .filter((word): word is string => word !== null)
                                  .join(" and ");
                                return (
                                  <Banner
                                    key={entry.id}
                                    status="info"
                                    title={`${entry.email}: Google has not yet allowed Murmur to ${words}`}
                                    endContent={
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        label={`Give permission for ${entry.email}`}
                                        isDisabled={waiting !== null}
                                        onClick={() => void connect(connector, entry.email)}
                                      >
                                        Give permission
                                      </Button>
                                    }
                                  />
                                );
                              })}
                            <Text size="sm" color="secondary">
                              Turning a feature off stops Murmur using it. To take a permission back
                              from Google, disconnect the account and connect it again.
                            </Text>
                          </VStack>
                        ) : null}

                        {connector.accounts.length > 0 && settings ? (
                          <HStack gap={3} align="end" wrap="wrap">
                            <Selector
                              label={`Check ${connector.name} for changes every`}
                              value={String(connector.choice.syncIntervalMinutes)}
                              options={[
                                ...new Set([
                                  ...SYNC_INTERVALS,
                                  connector.choice.syncIntervalMinutes,
                                ]),
                              ]
                                .sort((a, b) => a - b)
                                .map((minutes) => ({
                                  value: String(minutes),
                                  label: intervalText(minutes),
                                }))}
                              onChange={(value) =>
                                void choose(connector, { syncIntervalMinutes: Number(value) })
                              }
                            />
                            {connector.supportsWrite ? (
                              <Switch
                                label={`${connector.name} is read only`}
                                description="On: Murmur only reads. Turn it off to let features that write ask you first. Murmur asks the provider for permission to write only when this is off."
                                value={connector.choice.readOnly}
                                onChange={(readOnly) => void choose(connector, { readOnly })}
                              />
                            ) : null}
                          </HStack>
                        ) : null}

                        {((CALENDAR_CONNECTOR_IDS as readonly string[]).includes(connector.id) ||
                          connector.id === "slack") &&
                        !connector.choice.readOnly
                          ? connector.accounts
                              .filter((entry) => entry.status === "connected")
                              .map((entry) => {
                                const write =
                                  connector.id === "slack"
                                    ? SLACK_SCOPE_WRITE
                                    : CALENDAR_WRITE_SCOPES[connector.id];
                                if (!write || hasScope(entry.scopes, write)) return null;
                                return (
                                  <Banner
                                    key={entry.id}
                                    status="info"
                                    title={`${entry.email}: ${connector.name} has not yet allowed Murmur to ${connector.id === "slack" ? "post messages" : "create events"}`}
                                    endContent={
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        label={`Give permission for ${entry.email}`}
                                        isDisabled={waiting !== null}
                                        onClick={() => void connect(connector, entry.email)}
                                      >
                                        Give permission
                                      </Button>
                                    }
                                  />
                                );
                              })
                          : null}
                      </>
                    )}
                  </VStack>
                </li>
              );
            })}
          </ul>
        </VStack>
      </section>
      <McpSection />
    </VStack>
  );
}
