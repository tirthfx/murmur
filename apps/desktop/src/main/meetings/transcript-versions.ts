import type { DatabaseSync } from "node:sqlite";
import type { RerunResult, TranscriptVersionInfo } from "@murmur/shared";

/**
 * The transcripts a rerun replaced (NT-23). Before a meeting is transcribed again, the lines
 * and the corrections it has are saved as one version and kept for a number of days. Putting
 * one back saves the transcript being replaced the same way, so nothing is lost either way.
 */
export interface TranscriptVersions {
  /** The versions that can still be put back, newest first. Expired ones are deleted first. */
  list(meetingId: string, now: number): TranscriptVersionInfo[];
  /**
   * Saves the transcript, empties it, marks every audio chunk as not yet transcribed and sets
   * the meeting up to be transcribed again, in one transaction. A new summary is due after.
   */
  startRerun(
    meetingId: string,
    input: { language: string | null; translate: boolean },
    keepDays: number,
    now: number,
  ): void;
  /** Puts a saved transcript back (and saves the one it replaces). */
  restore(meetingId: string, versionId: number, keepDays: number, now: number): RerunResult;
  /** Deletes the versions that have expired, for every meeting. Returns how many. */
  purge(now: number): number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface SegmentRow {
  id: string;
}

export function createTranscriptVersions(db: DatabaseSync): TranscriptVersions {
  /** Saves what a meeting has now as a version, unless it has nothing. */
  function save(meetingId: string, keepDays: number, now: number): void {
    const meeting = db
      .prepare(
        "SELECT language, translate, transcript_version AS version FROM meetings WHERE id = ?",
      )
      .get(meetingId) as { language: string | null; translate: number; version: number };
    const segments = db
      .prepare(
        "SELECT * FROM meeting_segments WHERE meeting_id = ? AND is_dictated = 0 ORDER BY start_ms, id",
      )
      .all(meetingId);
    const corrections = db
      .prepare(
        "SELECT kind, before_json, after_ids_json, created_at FROM transcript_corrections WHERE meeting_id = ? ORDER BY id",
      )
      .all(meetingId);
    if (segments.length === 0 && corrections.length === 0) return;
    db.prepare(
      `INSERT OR REPLACE INTO transcript_versions
         (meeting_id, version, language, translate, segments_json, corrections_json, line_count, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      meetingId,
      meeting.version,
      meeting.language,
      meeting.translate,
      JSON.stringify(segments),
      JSON.stringify(corrections),
      segments.length,
      now,
      now + keepDays * DAY_MS,
    );
  }

  const clear = (meetingId: string) => {
    db.prepare("DELETE FROM meeting_segments WHERE meeting_id = ? AND is_dictated = 0").run(
      meetingId,
    );
    db.prepare("DELETE FROM transcript_corrections WHERE meeting_id = ?").run(meetingId);
  };

  const atomic = <T>(work: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  return {
    list(meetingId, now) {
      db.prepare("DELETE FROM transcript_versions WHERE meeting_id = ? AND expires_at <= ?").run(
        meetingId,
        now,
      );
      return (
        db
          .prepare(
            `SELECT id, version, language, translate, line_count, created_at, expires_at
             FROM transcript_versions WHERE meeting_id = ? ORDER BY created_at DESC, id DESC`,
          )
          .all(meetingId) as {
          id: number;
          version: number;
          language: string | null;
          translate: number;
          line_count: number;
          created_at: number;
          expires_at: number;
        }[]
      ).map((row) => ({
        id: row.id,
        version: row.version,
        language: row.language,
        translate: row.translate === 1,
        lines: row.line_count,
        replacedAt: row.created_at,
        expiresAt: row.expires_at,
      }));
    },

    startRerun(meetingId, input, keepDays, now) {
      atomic(() => {
        save(meetingId, keepDays, now);
        clear(meetingId);
        db.prepare(
          "UPDATE meeting_audio_chunks SET transcribed_at = NULL WHERE meeting_id = ?",
        ).run(meetingId);
        db.prepare(
          `UPDATE meetings SET language = ?, translate = ?, transcript_version = transcript_version + 1,
             rerun_pending = 1, status = 'queued' WHERE id = ?`,
        ).run(input.language, input.translate ? 1 : 0, meetingId);
      });
    },

    restore(meetingId, versionId, keepDays, now) {
      const found = db
        .prepare(
          `SELECT id, version, language, translate, segments_json, corrections_json
           FROM transcript_versions WHERE meeting_id = ? AND id = ? AND expires_at > ?`,
        )
        .get(meetingId, versionId, now) as
        | {
            id: number;
            version: number;
            language: string | null;
            translate: number;
            segments_json: string;
            corrections_json: string;
          }
        | undefined;
      if (!found)
        return { ok: false, message: "That version is gone: it was kept for a limited time." };
      const segments = JSON.parse(found.segments_json) as (SegmentRow & Record<string, unknown>)[];
      const corrections = JSON.parse(found.corrections_json) as {
        kind: string;
        before_json: string;
        after_ids_json: string;
        created_at: number;
      }[];
      atomic(() => {
        // The transcript being replaced is saved first, as its own version.
        save(meetingId, keepDays, now);
        db.prepare("DELETE FROM transcript_versions WHERE id = ?").run(found.id);
        clear(meetingId);
        const insert = db.prepare(
          `INSERT INTO meeting_segments
             (id, meeting_id, channel, start_ms, end_ms, text, language, speaker_id, is_dictated, is_final, created_at, edited)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const s of segments) {
          insert.run(
            s.id,
            s.meeting_id as string,
            s.channel as string,
            s.start_ms as number,
            s.end_ms as number,
            s.text as string,
            (s.language as string | null) ?? null,
            (s.speaker_id as string | null) ?? null,
            s.is_dictated as number,
            s.is_final as number,
            s.created_at as number,
            (s.edited as number) ?? 0,
          );
        }
        const put = db.prepare(
          `INSERT INTO transcript_corrections (meeting_id, kind, before_json, after_ids_json, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        );
        for (const c of corrections)
          put.run(meetingId, c.kind, c.before_json, c.after_ids_json, c.created_at);
        // Its lines carry its version, and the audio has been transcribed.
        db.prepare(
          "UPDATE meetings SET language = ?, translate = ?, transcript_version = ?, rerun_pending = 0 WHERE id = ?",
        ).run(found.language, found.translate, found.version, meetingId);
        db.prepare(
          "UPDATE meeting_audio_chunks SET transcribed_at = COALESCE(transcribed_at, ?) WHERE meeting_id = ?",
        ).run(now, meetingId);
      });
      return { ok: true };
    },

    purge(now) {
      return Number(
        db.prepare("DELETE FROM transcript_versions WHERE expires_at <= ?").run(now).changes,
      );
    },
  };
}
