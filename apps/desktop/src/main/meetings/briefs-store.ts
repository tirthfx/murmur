import type { DatabaseSync } from "node:sqlite";
import type { BriefItem, BriefSourceReport, MeetingBrief } from "@murmur/shared";

/** The latest brief of each calendar event (NT-11). */
export interface BriefsStore {
  /** Keeps this brief, replacing the one the event had. */
  put(brief: MeetingBrief): void;
  get(eventKey: string): MeetingBrief | null;
  /** The brief of a calendar event by the event's own id, whichever account it is in. */
  getForEvent(eventId: string): MeetingBrief | null;
  /** The brief of a calendar event by the event's own id, whichever account it is in. */
  getForEvent(eventId: string): MeetingBrief | null;
  /** When each of these events' briefs was built, by key; an event with none is not in it. */
  builtAt(eventKeys: readonly string[]): Map<string, number>;
  /** Deletes briefs of meetings that began before `before`. Returns how many went. */
  prune(before: number): number;
}

interface Row {
  event_key: string;
  title: string;
  start_ms: number;
  built_at: number;
  markdown: string;
  sources_json: string;
  items_json: string;
  model_wrote: number;
}

const toBrief = (row: Row): MeetingBrief => ({
  eventKey: row.event_key,
  title: row.title,
  startMs: row.start_ms,
  builtAt: row.built_at,
  markdown: row.markdown,
  sources: JSON.parse(row.sources_json) as BriefSourceReport[],
  items: JSON.parse(row.items_json) as BriefItem[],
  modelWrote: row.model_wrote === 1,
});

export function createBriefsStore(db: DatabaseSync): BriefsStore {
  return {
    put(brief) {
      db.prepare(
        `INSERT INTO meeting_briefs
           (event_key, title, start_ms, built_at, markdown, sources_json, items_json, model_wrote)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(event_key) DO UPDATE SET
           title = excluded.title, start_ms = excluded.start_ms, built_at = excluded.built_at,
           markdown = excluded.markdown, sources_json = excluded.sources_json,
           items_json = excluded.items_json, model_wrote = excluded.model_wrote`,
      ).run(
        brief.eventKey,
        brief.title,
        brief.startMs,
        brief.builtAt,
        brief.markdown,
        JSON.stringify(brief.sources),
        JSON.stringify(brief.items),
        brief.modelWrote ? 1 : 0,
      );
    },
    get(eventKey) {
      const row = db
        .prepare("SELECT * FROM meeting_briefs WHERE event_key = ?")
        .get(eventKey) as unknown as Row | undefined;
      return row ? toBrief(row) : null;
    },
    getForEvent(eventId) {
      // The key is `<account id>:<event id>` and an account id has no colon.
      const row = db
        .prepare(
          `SELECT * FROM meeting_briefs
           WHERE SUBSTR(event_key, INSTR(event_key, ':') + 1) = ?
           ORDER BY built_at DESC LIMIT 1`,
        )
        .get(eventId) as unknown as Row | undefined;
      return row ? toBrief(row) : null;
    },
    builtAt(eventKeys) {
      const found = new Map<string, number>();
      for (const key of eventKeys) {
        const row = db
          .prepare("SELECT built_at FROM meeting_briefs WHERE event_key = ?")
          .get(key) as { built_at: number } | undefined;
        if (row) found.set(key, row.built_at);
      }
      return found;
    },
    prune(before) {
      return Number(
        db.prepare("DELETE FROM meeting_briefs WHERE start_ms < ?").run(before).changes,
      );
    },
  };
}
