import type { DatabaseSync } from "node:sqlite";
import {
  RETENTION_DAYS,
  type AudioRetention,
  type MeetingRetentionDue,
  type TranscriptRetention,
} from "@murmur/shared";
import type { Logger } from "../helper/types";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Segment rows are deleted this many at a time, each batch in its own transaction. */
export const DELETE_BATCH = 500;

export interface MeetingRetentionDeps {
  settings(): {
    audio: AudioRetention;
    transcript: TranscriptRetention;
    removeSummaryWithTranscript: boolean;
    /** True when a summary is written after each meeting. */
    summaryAuto: boolean;
  };
  /** TM-15: keeps a period inside what the organization allows; the period itself if absent. */
  limitAudio?(period: AudioRetention): AudioRetention;
  limitTranscript?(period: TranscriptRetention): TranscriptRetention;
  /** Removes a file; a file that is already gone is not an error. */
  removeFile(path: string): void;
  logger: Logger;
}

export interface MeetingRetention {
  /** Deletes the audio of meetings past their period. Returns how many meetings. */
  runAudio(now: number): number;
  /** Deletes the transcripts of meetings past their period. Returns how many meetings. */
  runTranscripts(now: number): number;
  /** The summary was just written: a meeting set to "after processing" loses its audio now. */
  afterProcessing(meetingId: string, now: number): boolean;
  /** How many recordings and transcripts a run in the next 24 hours would delete. */
  due(now: number): MeetingRetentionDue;
}

interface Row {
  id: string;
  status: string;
  at: number;
  audio_deleted_at: number | null;
  transcript_deleted_at: number | null;
  chunks: number;
  folder_audio: AudioRetention | null;
  folder_transcript: TranscriptRetention | null;
}

/**
 * Retention of meeting audio and transcripts (NT-22). Audio and transcript have their own
 * periods, which a folder can override. Deleting is permanent: a meeting keeps its row, title,
 * date and folder, with the time retention deleted its audio or transcript. A meeting that is
 * recording, or whose transcript is not made yet, is never touched, so nothing is deleted
 * before it has been used.
 */
export function createMeetingRetention(
  db: DatabaseSync,
  deps: MeetingRetentionDeps,
): MeetingRetention {
  /** Meetings that are finished; `at` is when the meeting ended. */
  const rows = (): Row[] =>
    db
      .prepare(
        `SELECT m.id, m.status, COALESCE(m.ended_at, m.started_at) AS at, m.audio_deleted_at,
                m.transcript_deleted_at,
                (SELECT COUNT(*) FROM meeting_audio_chunks c WHERE c.meeting_id = m.id) AS chunks,
                f.retention_audio AS folder_audio,
                f.retention_transcript AS folder_transcript
         FROM meetings m LEFT JOIN folders f ON f.id = m.folder_id
         WHERE m.status IN ('ready', 'failed')`,
      )
      .all() as unknown as Row[];

  const audioPeriod = (row: Row): AudioRetention => {
    const own = row.folder_audio ?? deps.settings().audio;
    return deps.limitAudio ? deps.limitAudio(own) : own;
  };
  const transcriptPeriod = (row: Row): TranscriptRetention => {
    const own = row.folder_transcript ?? deps.settings().transcript;
    return deps.limitTranscript ? deps.limitTranscript(own) : own;
  };

  /** The summary is written, or no summary is going to be. */
  function processed(id: string): boolean {
    const summary = db
      .prepare("SELECT 1 FROM meeting_summaries WHERE meeting_id = ? AND quick = 0 LIMIT 1")
      .get(id);
    if (summary) return true;
    if (deps.settings().summaryAuto) return false;
    const job = db
      .prepare("SELECT status FROM meeting_jobs WHERE meeting_id = ? AND kind = 'summarise'")
      .get(id) as { status: string } | undefined;
    return !job || job.status === "done" || job.status === "failed";
  }

  const audioDue = (row: Row, now: number): boolean => {
    // An imported meeting has no audio: there is nothing to delete, and nothing to mark.
    if (row.audio_deleted_at !== null || row.chunks === 0) return false;
    const period = audioPeriod(row);
    if (period === "forever") return false;
    if (period === "processing") return processed(row.id);
    return now - row.at >= RETENTION_DAYS[period]! * DAY_MS;
  };

  const transcriptDue = (row: Row, now: number): boolean => {
    if (row.transcript_deleted_at !== null) return false;
    const days = RETENTION_DAYS[transcriptPeriod(row)];
    return days != null && now - row.at >= days * DAY_MS;
  };

  /** Removes the audio files, then marks the meeting. Documents attached to it stay. */
  function deleteAudio(id: string, now: number): void {
    const chunks = db
      .prepare("SELECT path FROM meeting_audio_chunks WHERE meeting_id = ?")
      .all(id) as { path: string }[];
    for (const chunk of chunks) {
      try {
        deps.removeFile(chunk.path);
      } catch (error) {
        deps.logger.warn(
          `could not remove ${chunk.path}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    db.prepare(
      "UPDATE meetings SET audio_deleted_at = ? WHERE id = ? AND audio_deleted_at IS NULL",
    ).run(now, id);
  }

  /** Removes the lines in batches of 500, then what hangs on them, then marks the meeting. */
  function deleteTranscript(id: string, now: number): void {
    for (;;) {
      db.exec("BEGIN IMMEDIATE");
      let removed: number;
      try {
        removed = Number(
          db
            .prepare(
              `DELETE FROM meeting_segments WHERE rowid IN
                 (SELECT rowid FROM meeting_segments WHERE meeting_id = ? LIMIT ${DELETE_BATCH})`,
            )
            .run(id).changes,
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      if (removed < DELETE_BATCH) break;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM transcript_corrections WHERE meeting_id = ?").run(id);
      db.prepare("DELETE FROM transcript_versions WHERE meeting_id = ?").run(id);
      if (deps.settings().removeSummaryWithTranscript)
        db.prepare("DELETE FROM meeting_summaries WHERE meeting_id = ?").run(id);
      db.prepare("UPDATE meetings SET transcript_deleted_at = ? WHERE id = ?").run(now, id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    runAudio(now) {
      let count = 0;
      for (const row of rows())
        if (audioDue(row, now)) {
          deleteAudio(row.id, now);
          count++;
        }
      return count;
    },

    runTranscripts(now) {
      let count = 0;
      for (const row of rows())
        if (transcriptDue(row, now)) {
          deleteTranscript(row.id, now);
          count++;
        }
      return count;
    },

    afterProcessing(meetingId, now) {
      const row = rows().find((candidate) => candidate.id === meetingId);
      if (!row || audioPeriod(row) !== "processing" || !audioDue(row, now)) return false;
      deleteAudio(meetingId, now);
      return true;
    },

    due(now) {
      const later = now + DAY_MS;
      const all = rows();
      return {
        audio: all.filter((row) => audioDue(row, later)).length,
        transcripts: all.filter((row) => transcriptDue(row, later)).length,
      };
    },
  };
}
