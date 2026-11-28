import {
  DATA_CONNECTOR_IDS,
  CONNECTOR_CATALOGUE,
  GITHUB_ID,
  LINEAR_ID,
  NOTION_ID,
  SLACK_ID,
  connectorChoice,
  type ConnectorAccount,
  type ConnectorDataStatus,
  type ConnectorItem,
  type ConnectorOptionsResult,
  type ConnectorSettings,
  type DataConnectorId,
} from "@murmur/shared";
import type { Logger } from "../../helper/types";
import { ConnectorError, type ConnectorService } from "../connector-service";
import type { ConnectorStore } from "../connector-store";
import { GITHUB_ORIGIN, readGithub, type EtagMap } from "../github/github";
import { LINEAR_ORIGIN, listTeams, readIssues } from "../linear/linear";
import { NOTION_ORIGIN, readPages } from "../notion/notion";
import { SLACK_ORIGIN, listChannels, readMessages } from "../slack/slack";
import { ReadError, defaultSleep, type Fetch } from "./http";

/**
 * What Slack, Notion, Linear and GitHub have said, kept on this Mac for a while (CN-05 to CN-08).
 * Briefs and Ask read `items()`; nothing else reads a provider. Each read goes only to its own
 * provider's address with that account's token, asks only about what the owner selected, and
 * keeps the result for the longer of the cache lifetime and two sync intervals.
 */
export type RefreshResult = { ok: true; count: number } | { ok: false; message: string };

export interface ConnectorData {
  /** Reads the account now and replaces what was kept. */
  refresh(accountId: string): Promise<RefreshResult>;
  /** What is kept for the connected accounts, newest first, narrowed to what is still selected. */
  items(filter?: { connector?: DataConnectorId }): ConnectorItem[];
  /** How much each account has kept. */
  status(): ConnectorDataStatus[];
  /** The channels or teams an account can offer for selection. */
  options(accountId: string): Promise<ConnectorOptionsResult>;
  /** Reads the connected accounts that are due by their interval. */
  syncDue(): Promise<void>;
  /** Looks every minute for accounts that are due, and once now. */
  start(): void;
  stop(): void;
}

export const DATA_TICK_MS = 60_000;

const ORIGINS: Record<DataConnectorId, string> = {
  [SLACK_ID]: SLACK_ORIGIN,
  [NOTION_ID]: NOTION_ORIGIN,
  [LINEAR_ID]: LINEAR_ORIGIN,
  [GITHUB_ID]: GITHUB_ORIGIN,
};

const NAMES: Record<DataConnectorId, string> = {
  [SLACK_ID]: "Slack",
  [NOTION_ID]: "Notion",
  [LINEAR_ID]: "Linear",
  [GITHUB_ID]: "GitHub",
};

const SLACK_LOOKBACK_MS = 7 * 86_400_000;
const KEPT = "data";
const ETAGS = "etags";

interface Kept {
  readAt: number;
  items: ConnectorItem[];
}

const isDataConnector = (id: string): id is DataConnectorId =>
  (DATA_CONNECTOR_IDS as readonly string[]).includes(id);

export function createConnectorData(deps: {
  connectors: Pick<ConnectorService, "list" | "authorizedFetch">;
  connectorStore: Pick<ConnectorStore, "get" | "setLastSync" | "cachePut" | "cacheGet">;
  settings(): ConnectorSettings;
  now(): number;
  logger: Logger;
  /** Called after a read that kept items. */
  onChange?(): void;
  sleep?(ms: number): Promise<void>;
  /** Tests run the schedule by hand. */
  setTimer?(run: () => void, ms: number): { clear(): void };
}): ConnectorData {
  const limits = { sleep: deps.sleep ?? defaultSleep };
  const running = new Map<string, Promise<RefreshResult>>();
  let timer: { clear(): void } | null = null;

  const accounts = (): ConnectorAccount[] =>
    deps.connectors.list().filter((account) => isDataConnector(account.connector));
  const find = (id: string) => accounts().find((account) => account.id === id) ?? null;

  const ttlMs = (account: ConnectorAccount): number => {
    const entry = CONNECTOR_CATALOGUE.find((candidate) => candidate.id === account.connector);
    const interval = entry ? connectorChoice(deps.settings(), entry).syncIntervalMinutes : 30;
    return Math.max(deps.settings().cacheTtlMinutes, interval * 2) * 60_000;
  };

  /** A request with the account's token, only to its own provider's address. */
  const fetchFor =
    (account: ConnectorAccount): Fetch =>
    (url, init) => {
      const origin = ORIGINS[account.connector as DataConnectorId];
      if (new URL(url).origin !== origin)
        throw new ReadError("Refused a request to another address.");
      return deps.connectors.authorizedFetch(account.id, url, init);
    };

  const readKept = (account: ConnectorAccount): Kept | null => {
    const text = deps.connectorStore.cacheGet(account.id, KEPT, "all", deps.now());
    if (text === null) return null;
    try {
      return JSON.parse(text) as Kept;
    } catch {
      return null;
    }
  };

  async function read(
    account: ConnectorAccount,
    settings: ConnectorSettings,
  ): Promise<{ items: ConnectorItem[]; note: string | null }> {
    const fetch = fetchFor(account);
    const now = deps.now();
    switch (account.connector as DataConnectorId) {
      case SLACK_ID: {
        const selected = new Set(settings.slack.channels);
        if (selected.size === 0) return { items: [], note: null };
        const includePrivate = settings.slack.privateChannels;
        const channels = (await listChannels({ fetch, limits, includePrivate })).filter((c) =>
          selected.has(c.id),
        );
        return {
          items: await readMessages({
            fetch,
            limits,
            channels,
            sinceMs: now - SLACK_LOOKBACK_MS,
          }),
          note: null,
        };
      }
      case NOTION_ID:
        return {
          items: await readPages({ fetch, limits, maxChars: settings.notion.maxCharsPerPage }),
          note: null,
        };
      case LINEAR_ID:
        return {
          items: await readIssues({
            fetch,
            limits,
            teams: settings.linear.teams,
            assignedOnly: settings.linear.assignedOnly,
          }),
          note: null,
        };
      case GITHUB_ID: {
        let etags: EtagMap;
        try {
          etags = JSON.parse(
            deps.connectorStore.cacheGet(account.id, ETAGS, "all", now) ?? "{}",
          ) as EtagMap;
        } catch {
          etags = {};
        }
        const result = await readGithub({
          fetch,
          limits,
          repos: settings.github.repos,
          login: account.email,
          now,
          etags,
        });
        deps.connectorStore.cachePut(
          account.id,
          ETAGS,
          "all",
          JSON.stringify(result.etags),
          now,
          7 * 86_400_000,
        );
        return { items: result.items, note: result.problems[0] ?? null };
      }
    }
  }

  async function refresh(account: ConnectorAccount): Promise<RefreshResult> {
    const name = NAMES[account.connector as DataConnectorId];
    try {
      const { items, note } = await read(account, deps.settings());
      const at = deps.now();
      deps.connectorStore.cachePut(
        account.id,
        KEPT,
        "all",
        JSON.stringify({ readAt: at, items } satisfies Kept),
        at,
        ttlMs(account),
      );
      deps.connectorStore.setLastSync(account.id, at);
      if (items.length > 0) deps.onChange?.();
      if (note) deps.logger.warn(`[connectors] ${account.connector} (${account.id}): ${note}`);
      return { ok: true, count: items.length };
    } catch (error) {
      if (error instanceof ReadError || error instanceof ConnectorError) {
        deps.logger.warn(`[connectors] ${account.connector} (${account.id}): ${error.message}`);
        return { ok: false, message: error.message };
      }
      deps.logger.warn(`[connectors] ${account.connector} (${account.id}) failed`);
      return { ok: false, message: `${name} could not be read.` };
    }
  }

  /** Whether an item is still inside what the owner has selected now. */
  const stillSelected = (item: ConnectorItem, settings: ConnectorSettings): boolean => {
    if (item.connector === SLACK_ID)
      return settings.slack.channels.includes(item.id.split(":")[0]!);
    if (item.connector === GITHUB_ID)
      return settings.github.repos.includes(item.id.slice(0, item.id.lastIndexOf("#")));
    return true;
  };

  const data: ConnectorData = {
    refresh(accountId) {
      const account = find(accountId);
      if (!account) return Promise.resolve({ ok: false, message: "That account is not here." });
      if (account.status !== "connected")
        return Promise.resolve({ ok: false, message: "That account is not connected." });
      const existing = running.get(account.id);
      if (existing) return existing;
      const flight = refresh(account).finally(() => running.delete(account.id));
      running.set(account.id, flight);
      return flight;
    },

    items(filter) {
      const settings = deps.settings();
      return accounts()
        .filter((account) => account.status === "connected")
        .filter((account) => !filter?.connector || account.connector === filter.connector)
        .flatMap((account) => readKept(account)?.items ?? [])
        .filter((item) => stillSelected(item, settings))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },

    status() {
      return accounts().map((account) => {
        const kept = readKept(account);
        return {
          accountId: account.id,
          itemCount: kept?.items.length ?? 0,
          readAt: kept?.readAt ?? null,
        };
      });
    },

    async options(accountId) {
      const account = find(accountId);
      if (!account || account.status !== "connected")
        return { ok: false, message: "That account is not connected." };
      const fetch = fetchFor(account);
      try {
        if (account.connector === SLACK_ID) {
          const includePrivate = deps.settings().slack.privateChannels;
          return { ok: true, options: await listChannels({ fetch, limits, includePrivate }) };
        }
        if (account.connector === LINEAR_ID)
          return { ok: true, options: await listTeams({ fetch, limits }) };
        return { ok: false, message: "There is nothing to choose for this connector." };
      } catch (error) {
        if (error instanceof ReadError || error instanceof ConnectorError)
          return { ok: false, message: error.message };
        return { ok: false, message: "The list could not be read." };
      }
    },

    async syncDue() {
      const settings = deps.settings();
      const now = deps.now();
      for (const account of accounts()) {
        if (account.status !== "connected") continue;
        const entry = CONNECTOR_CATALOGUE.find((candidate) => candidate.id === account.connector);
        if (!entry) continue;
        const interval = connectorChoice(settings, entry).syncIntervalMinutes * 60_000;
        const last = deps.connectorStore.get(account.id)?.lastSyncAt ?? null;
        if (last === null || now - last >= interval) await data.refresh(account.id);
      }
    },

    start() {
      if (timer) return;
      const schedule =
        deps.setTimer ??
        ((run, ms) => {
          const handle = setInterval(run, ms);
          return { clear: () => clearInterval(handle) };
        });
      timer = schedule(() => void data.syncDue(), DATA_TICK_MS);
      void data.syncDue();
    },

    stop() {
      timer?.clear();
      timer = null;
    },
  };
  return data;
}
