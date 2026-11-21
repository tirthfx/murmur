import type { DatabaseSync } from "node:sqlite";
import { DICTATION_PAD_MS } from "@murmur/shared";

/** SQL that marks the microphone lines of a meeting that overlap a dictation (NT-19). */
export const MARK_DICTATED_SQL = `
  UPDATE meeting_segments SET is_dictated = 1
  WHERE meeting_id = ? AND channel = 'mic' AND is_dictated = 0 AND EXISTS (
    SELECT 1 FROM meeting_dictations d
    WHERE d.meeting_id = meeting_segments.meeting_id
      AND meeting_segments.start_ms < COALESCE(d.end_ms, 9007199254740991) + ${DICTATION_PAD_MS}
      AND meeting_segments.end_ms > d.start_ms - ${DICTATION_PAD_MS})`;

/** A dictation that was never closed (a crash) is taken to have lasted this long. */
const LOST_DICTATION_MS = 120_000;

/**
 * The times a dictation was recording while a meeting was (NT-19). The dictation's speech is also
 * in the microphone channel, so the microphone lines that overlap one are marked `is_dictated`
 * and kept out of the transcript view, a summary and Ask: the transcript shows what was said to
 * the others, not what was dictated. Lines of the Mac's sound (the other people) are never
 * marked, so remote speech that overlaps a dictation stays. The recording is never paused.
 */
export interface DictationWindows {
  /** A dictation started `atMs` into the meeting. */
  open(meetingId: string, atMs: number): void;
  /** The dictation ended: its window is closed and the lines already written are marked. */
  close(meetingId: string, atMs: number): void;
  /** Dictations a crash left open are closed. */
  closeLost(): number;
  /** Marks the microphone lines of a meeting that overlap a dictation. Returns how many. */
  mark(meetingId: string): number;
}

export function createDictationWindows(db: DatabaseSync): DictationWindows {
  const mark = (meetingId: string) => Number(db.prepare(MARK_DICTATED_SQL).run(meetingId).changes);
  return {
    open(meetingId, atMs) {
      db.prepare("INSERT INTO meeting_dictations (meeting_id, start_ms) VALUES (?, ?)").run(
        meetingId,
        Math.max(0, Math.round(atMs)),
      );
    },
    close(meetingId, atMs) {
      db.prepare(
        `UPDATE meeting_dictations SET end_ms = MAX(start_ms, ?)
         WHERE meeting_id = ? AND end_ms IS NULL`,
      ).run(Math.round(atMs), meetingId);
      mark(meetingId);
    },
    closeLost() {
      return Number(
        db
          .prepare(
            `UPDATE meeting_dictations SET end_ms = start_ms + ${LOST_DICTATION_MS} WHERE end_ms IS NULL`,
          )
          .run().changes,
      );
    },
    mark,
  };
}
