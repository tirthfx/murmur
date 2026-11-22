import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { VStack } from "@astryxdesign/core/VStack";
import {
  CONNECTOR_DATA_LIMITS,
  GITHUB_ID,
  LINEAR_ID,
  NOTION_ID,
  REPO_PATTERN,
  SLACK_ID,
  type ConnectorAccount,
  type ConnectorDataStatus,
  type ConnectorOption,
  type ConnectorSettings,
  type ConnectorView,
} from "@murmur/shared";

const NOTION_LENGTHS = [2000, 5000, 10_000, 20_000];

/** A list of channels or teams to pick from, loaded from the provider when asked. */
function OptionPicker({
  account,
  title,
  noun,
  selected,
  max,
  onChange,
}: {
  account: ConnectorAccount;
  title: string;
  noun: string;
  selected: readonly string[];
  max: number;
  onChange: (ids: string[]) => void;
}) {
  const [options, setOptions] = useState<ConnectorOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const result = await window.murmur.connectorOptions(account.id);
      if (result.ok) setOptions(result.options);
      else setMessage(result.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <VStack gap={1}>
      <HStack gap={2} align="center" wrap="wrap">
        <Text size="sm" weight="semibold">
          {title}
        </Text>
        <Text size="sm" color="secondary">
          {selected.length === 0
            ? `No ${noun} selected, so none is read.`
            : `${selected.length} selected. Only these are read.`}
        </Text>
        <Button
          size="sm"
          variant="secondary"
          label={`Choose ${noun} for ${account.email}`}
          isDisabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Loading…" : options ? "Reload the list" : `Choose ${noun}`}
        </Button>
      </HStack>
      {message ? <Banner status="warning" title={message} /> : null}
      {options ? (
        options.length === 0 ? (
          <Text size="sm" color="secondary">
            Nothing to choose from.
          </Text>
        ) : (
          <ul className="hub-connector-list" aria-label={title}>
            {options.map((option) => {
              const on = selected.includes(option.id);
              return (
                <li key={option.id}>
                  <Switch
                    label={option.label}
                    value={on}
                    isDisabled={!on && selected.length >= max}
                    onChange={(next) =>
                      onChange(
                        next ? [...selected, option.id] : selected.filter((id) => id !== option.id),
                      )
                    }
                  />
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </VStack>
  );
}

/** What can be set for a Slack, Notion, Linear or GitHub account, and what it has kept (CN-05 to CN-08). */
export function ConnectorSelection({
  connector,
  settings,
  status,
  save,
}: {
  connector: ConnectorView;
  settings: ConnectorSettings;
  status: readonly ConnectorDataStatus[];
  /** Saves part of the connector settings, then reads the account again. */
  save: (patch: Partial<ConnectorSettings>) => Promise<void>;
}) {
  const [repoText, setRepoText] = useState(settings.github.repos.join("\n"));
  const [repoMessage, setRepoMessage] = useState<string | null>(null);

  const account = connector.accounts.find((entry) => entry.status === "connected");
  if (!account) return null;
  const mine = status.filter((entry) =>
    connector.accounts.some((candidate) => candidate.id === entry.accountId),
  );
  const kept = mine.reduce((sum, entry) => sum + entry.itemCount, 0);
  const lastRead = mine.reduce<number | null>(
    (latest, entry) =>
      entry.readAt !== null && (latest === null || entry.readAt > latest) ? entry.readAt : latest,
    null,
  );

  function saveRepos() {
    const repos = [
      ...new Set(
        repoText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      ),
    ];
    const bad = repos.find((repo) => !REPO_PATTERN.test(repo));
    if (bad) return setRepoMessage(`“${bad}” is not written owner/name.`);
    if (repos.length > CONNECTOR_DATA_LIMITS.repos)
      return setRepoMessage(`Up to ${CONNECTOR_DATA_LIMITS.repos} repositories.`);
    setRepoMessage(null);
    void save({ github: { repos } });
  }

  return (
    <VStack gap={2}>
      <Text size="sm" color="secondary">
        {kept === 0
          ? "Nothing kept on this Mac yet."
          : `${kept} ${kept === 1 ? "item" : "items"} kept on this Mac${
              lastRead ? `, read ${new Date(lastRead).toLocaleString()}` : ""
            }. They expire after the cache time above.`}
      </Text>

      {connector.id === SLACK_ID ? (
        <OptionPicker
          account={account}
          title="Slack channels to read"
          noun="channels"
          selected={settings.slack.channels}
          max={CONNECTOR_DATA_LIMITS.channels}
          onChange={(channels) => void save({ slack: { channels } })}
        />
      ) : null}

      {connector.id === NOTION_ID ? (
        <Selector
          label="Most text kept from a page"
          description="Only pages you share with the integration are read. A longer page is cut here and marked as cut."
          value={String(settings.notion.maxCharsPerPage)}
          options={[...new Set([...NOTION_LENGTHS, settings.notion.maxCharsPerPage])]
            .sort((a, b) => a - b)
            .map((value) => ({
              value: String(value),
              label: `${value.toLocaleString()} characters`,
            }))}
          onChange={(value) => void save({ notion: { maxCharsPerPage: Number(value) } })}
        />
      ) : null}

      {connector.id === LINEAR_ID ? (
        <VStack gap={2}>
          <Switch
            label="Only issues assigned to me"
            description="Off: the issues of the teams you choose are read as well."
            value={settings.linear.assignedOnly}
            onChange={(assignedOnly) => void save({ linear: { ...settings.linear, assignedOnly } })}
          />
          {settings.linear.assignedOnly ? null : (
            <OptionPicker
              account={account}
              title="Linear teams to read"
              noun="teams"
              selected={settings.linear.teams}
              max={CONNECTOR_DATA_LIMITS.teams}
              onChange={(teams) => void save({ linear: { ...settings.linear, teams } })}
            />
          )}
        </VStack>
      ) : null}

      {connector.id === GITHUB_ID ? (
        <VStack gap={1}>
          <TextArea
            label="Repositories to read"
            description="One owner/name on each line. Only these are asked about; with none, nothing is read."
            rows={4}
            value={repoText}
            onChange={setRepoText}
          />
          {repoMessage ? <Banner status="warning" title={repoMessage} /> : null}
          <div>
            <Button size="sm" variant="secondary" label="Save the repositories" onClick={saveRepos}>
              Save repositories
            </Button>
          </div>
        </VStack>
      ) : null}
    </VStack>
  );
}
