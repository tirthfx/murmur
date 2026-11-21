import {
  CALENDAR_CONNECTOR_IDS,
  CALENDAR_MAX_EVENTS,
  CALENDAR_WINDOW,
  connectorChoice,
  CONNECTOR_CATALOGUE,
  type ConnectorAccount,
  type ConnectorSettings,
} from "@murmur/shared";
import type { Logger } from "../../helper/types";
import type { ConnectorService } from "../connector-service";
import { ConnectorError } from "../connector-service";
import type { ConnectorStore } from "../connector-store";
import type { CalendarStore } from "./calendar-store";
import {
  CalendarFetchError,
  fetchGoogleEvents,
  GOOGLE_CALENDAR_ID,
  GOOGLE_ORIGIN,
} from "./google-calendar";
import { fetchOutlookEvents, GRAPH_ORIGIN, OUTLOOK_CALENDAR_ID } from "./outlook-calendar";

export type SyncResult = { ok: true; count: number } | { ok: false; message: string };

export interface CalendarSync {
  /** Reads the account's events for the days around now and replaces what is kept. */
  syncAccount(accountId: string): Promise<SyncResult>;
  /** Syncs the connected calendar accounts that are due by their interval. */
  syncDue(): Promise<void>;
  /** Looks every minute for accounts that are due, and once now. */
  start(): void;
  stop(): void;
}

/** The connectors that are calendars. */
export const CALENDAR_CONNECTORS: readonly string[] = CALENDAR_CONNECTOR_IDS;

const ORIGINS: Record<string, string> = {
  [GOOGLE_CALENDAR_ID]: GOOGLE_ORIGIN,
  [OUTLOOK_CALENDAR_ID]: GRAPH_ORIGIN,
};

export const SYNC_TICK_MS = 60_000;

export function createCalendarSync(deps: {
  connectors: Pick<ConnectorService, "list" | "authorizedFetch">;
  connectorStore: Pick<ConnectorStore, "setLastSync" | "get">;
  store: CalendarStore;
  settings(): ConnectorSettings;
  now(): number;
  logger: Logger;
  /** Called after a sync that kept events, so reminders and the menu bar can look again. */
  onChange?(): void;
  /** Tests run the schedule by hand. */
  setTimer?(run: () => void, ms: number): { clear(): void };
}): CalendarSync {
  const running = new Map<string, Promise<SyncResult>>();
  let timer: { clear(): void } | null = null;

  const account = (id: string): ConnectorAccount | null =>
    deps.connectors.list().find((candidate) => candidate.id === id) ?? null;

  async function sync(target: ConnectorAccount): Promise<SyncResult> {
    const origin = ORIGINS[target.connector];
    if (!origin) return { ok: false, message: "That account is not a calendar." };
    const now = deps.now();
    const from = now - CALENDAR_WINDOW.pastMs;
    const to = now + CALENDAR_WINDOW.aheadMs;
    // The token goes only to the provider's own address, whatever a page of the answer says.
    const fetchOne = async (url: string, init?: RequestInit) => {
      if (new URL(url).origin !== origin)
        throw new CalendarFetchError("Refused a request to another address.");
      return deps.connectors.authorizedFetch(target.id, url, init);
    };
    try {
      const options = {
        fetch: fetchOne,
        accountEmail: target.email,
        from,
        to,
        maxEvents: CALENDAR_MAX_EVENTS,
      };
      const events =
        target.connector === GOOGLE_CALENDAR_ID
          ? await fetchGoogleEvents(options)
          : await fetchOutlookEvents(options);
      const count = deps.store.replaceWindow(target.id, { from, to }, events);
      deps.connectorStore.setLastSync(target.id, now);
      deps.onChange?.();
      return { ok: true, count };
    } catch (error) {
      // The events already kept stay: an outage or a revoked sign-in does not empty the calendar.
      if (error instanceof ConnectorError || error instanceof CalendarFetchError) {
        deps.logger.warn(`[calendar] ${target.connector} (${target.id}): ${error.message}`);
        return { ok: false, message: error.message };
      }
      deps.logger.warn(`[calendar] ${target.connector} (${target.id}) failed`);
      return { ok: false, message: "The calendar could not be read." };
    }
  }

  const syncAccount: CalendarSync["syncAccount"] = (accountId) => {
    const target = account(accountId);
    if (!target) return Promise.resolve({ ok: false, message: "That account is gone." });
    if (target.status !== "connected")
      return Promise.resolve({
        ok: false,
        message:
          target.status === "disabled"
            ? "That account is turned off."
            : (target.statusReason ?? "That account needs to be connected again."),
      });
    const running_ = running.get(accountId);
    if (running_) return running_;
    const flight = sync(target).finally(() => running.delete(accountId));
    running.set(accountId, flight);
    return flight;
  };

  const syncDue: CalendarSync["syncDue"] = async () => {
    const now = deps.now();
    for (const target of deps.connectors.list()) {
      if (!CALENDAR_CONNECTORS.includes(target.connector) || target.status !== "connected")
        continue;
      const entry = CONNECTOR_CATALOGUE.find((candidate) => candidate.id === target.connector)!;
      const every = connectorChoice(deps.settings(), entry).syncIntervalMinutes * 60_000;
      if (target.lastSyncAt === null || now - target.lastSyncAt >= every)
        await syncAccount(target.id);
    }
  };

  return {
    syncAccount,
    syncDue,
    start() {
      if (timer) return;
      const set =
        deps.setTimer ??
        ((run, ms) => {
          const handle = setInterval(run, ms);
          handle.unref();
          return { clear: () => clearInterval(handle) };
        });
      timer = set(() => void syncDue(), SYNC_TICK_MS);
      void syncDue();
    },
    stop() {
      timer?.clear();
      timer = null;
    },
  };
}
