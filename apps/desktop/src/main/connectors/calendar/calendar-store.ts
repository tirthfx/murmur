import type { DatabaseSync } from "node:sqlite";
import type { CalendarAttendee, CalendarEvent, CalendarResponse } from "@murmur/shared";

/**
 * The events of the days around now, for each connected account (CN-02, CN-03). Reminders and the
 * menu bar read these without the network. Each sync replaces what it covers, so an event that
 * was moved, cancelled or deleted at the provider is moved or gone here after the next sync.
 */
export interface CalendarStore {
  /**
   * Makes the events of an account in `[from, to)` exactly these: new ones are added, changed ones
   * replaced, and the ones that are no longer there removed. Returns how many are kept.
   */
  replaceWindow(
    accountId: string,
    window: { from: number; to: number },
    events: readonly Omit<CalendarEvent, "accountId" | "connector">[],
  ): number;
  /** Events that overlap `[from, to)`, by start; of connected accounts only. Declined events are left out unless asked for. */
  list(range: { from: number; to: number; includeDeclined?: boolean }): CalendarEvent[];
  /** How many events an account has. */
  count(accountId: string): number;
}

interface Row {
  account_id: string;
  connector: string;
  event_id: string;
  title: string;
  start_ms: number;
  end_ms: number;
  all_day: number;
  location: string | null;
  attendees_json: string;
  join_url: string | null;
  response: CalendarResponse;
  is_private: number;
}

const toEvent = (row: Row): CalendarEvent => ({
  id: row.event_id,
  accountId: row.account_id,
  connector: row.connector,
  title: row.title,
  startMs: row.start_ms,
  endMs: row.end_ms,
  allDay: row.all_day === 1,
  location: row.location,
  attendees: JSON.parse(row.attendees_json) as CalendarAttendee[],
  joinUrl: row.join_url,
  response: row.response,
  isPrivate: row.is_private === 1,
});

export function createCalendarStore(db: DatabaseSync): CalendarStore {
  return {
    replaceWindow(accountId, window, events) {
      db.exec("BEGIN IMMEDIATE");
      try {
        // An event that starts in the window and is not in the answer is gone.
        db.prepare(
          "DELETE FROM calendar_events WHERE account_id = ? AND end_ms > ? AND start_ms < ?",
        ).run(accountId, window.from, window.to);
        const insert = db.prepare(
          `INSERT OR REPLACE INTO calendar_events
             (account_id, event_id, title, start_ms, end_ms, all_day, location, attendees_json,
              join_url, response, is_private)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const event of events)
          insert.run(
            accountId,
            event.id,
            event.title,
            event.startMs,
            event.endMs,
            event.allDay ? 1 : 0,
            event.location,
            JSON.stringify(event.attendees),
            event.joinUrl,
            event.response,
            event.isPrivate ? 1 : 0,
          );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return this.count(accountId);
    },

    list(range) {
      return (
        db
          .prepare(
            `SELECT e.*, a.connector AS connector FROM calendar_events e
             JOIN connector_accounts a ON a.id = e.account_id
             WHERE a.status = 'connected' AND e.end_ms > ? AND e.start_ms < ?
               AND (? = 1 OR e.response != 'declined')
             ORDER BY e.start_ms, e.end_ms, e.title`,
          )
          .all(range.from, range.to, range.includeDeclined ? 1 : 0) as unknown as Row[]
      ).map(toEvent);
    },

    count(accountId) {
      return (
        db
          .prepare("SELECT COUNT(*) AS n FROM calendar_events WHERE account_id = ?")
          .get(accountId) as {
          n: number;
        }
      ).n;
    },
  };
}
