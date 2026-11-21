import type { DatabaseSync } from "node:sqlite";
import type { MeetingRecap } from "@murmur/shared";

/** The "What did I miss" recaps of a meeting (NT-13). */
export interface RecapsStore {
  add(input: {
    id: string;
    meetingId: string;
    windowStartMs: number;
    windowEndMs: number;
    markdown: string;
    modelId: string;
    at: number;
  }): MeetingRecap;
  /** Newest first. */
  list(meetingId: string): MeetingRecap[];
}

export function createRecapsStore(db: DatabaseSync): RecapsStore {
  const toRecap = (row: {
    id: string;
    meeting_id: string;
    window_start_ms: number;
    window_end_ms: number;
    markdown: string;
    created_at: number;
  }): MeetingRecap => ({
    id: row.id,
    meetingId: row.meeting_id,
    windowStartMs: row.window_start_ms,
    windowEndMs: row.window_end_ms,
    markdown: row.markdown,
    createdAt: row.created_at,
  });
  return {
    add(input) {
      db.prepare(
        `INSERT INTO recaps (id, meeting_id, window_start_ms, window_end_ms, markdown, model_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.id,
        input.meetingId,
        input.windowStartMs,
        input.windowEndMs,
        input.markdown,
        input.modelId,
        input.at,
      );
      return toRecap({
        id: input.id,
        meeting_id: input.meetingId,
        window_start_ms: input.windowStartMs,
        window_end_ms: input.windowEndMs,
        markdown: input.markdown,
        created_at: input.at,
      });
    },
    list(meetingId) {
      return (
        db
          .prepare(
            `SELECT id, meeting_id, window_start_ms, window_end_ms, markdown, created_at
             FROM recaps WHERE meeting_id = ? ORDER BY created_at DESC, rowid DESC`,
          )
          .all(meetingId) as Parameters<typeof toRecap>[0][]
      ).map(toRecap);
    },
  };
}
