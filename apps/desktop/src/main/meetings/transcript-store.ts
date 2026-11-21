import type { DatabaseSync } from "node:sqlite";
import type {
  AudioChunkRow,
  MeetingChannel,
  MeetingSegment,
  TranscriptionProgress,
} from "@murmur/shared";

/** A segment as the recognizer gave it, with times on the meeting's timeline. */
export interface NewSegment {
  channel: MeetingChannel;
  startMs: number;
  endMs: number;
  text: string;
  language: string | null;
}

/** A meeting's transcript segments, and which audio chunks they came from (NT-05, NT-06). */
export interface TranscriptStore {
  /** Chunks not transcribed yet, in timeline order across both channels. */
  pendingChunks(meetingId: string): AudioChunkRow[];
  progress(meetingId: string): TranscriptionProgress;
  /**
   * Writes one chunk's segments and marks the chunk done, in one transaction. Segment ids
   * come from the chunk, so writing a chunk twice (after a crash) adds nothing.
   */
  addChunkSegments(chunk: AudioChunkRow, segments: NewSegment[], at: number): number;
  /** In time order; ties keep the microphone first. */
  segments(meetingId: string): MeetingSegment[];
}

interface ChunkRow {
  meeting_id: string;
  channel: MeetingChannel;
  seq: number;
  path: string;
  sha256: string;
  bytes: number;
  start_ms: number;
  duration_ms: number;
}

interface SegmentRow {
  id: string;
  meeting_id: string;
  channel: MeetingChannel;
  start_ms: number;
  end_ms: number;
  text: string;
  language: string | null;
  speaker_id: string | null;
  is_dictated: number;
  is_final: number;
}

/** Text the model writes for sounds rather than words, such as "[Music]" or "(applause)". */
const NOT_SPEECH = /^[[(][^\])]*[\])]$/;

export function createTranscriptStore(db: DatabaseSync): TranscriptStore {
  return {
    pendingChunks(meetingId) {
      return (
        db
          .prepare(
            `SELECT meeting_id, channel, seq, path, sha256, bytes, start_ms, duration_ms
             FROM meeting_audio_chunks WHERE meeting_id = ? AND transcribed_at IS NULL
             ORDER BY start_ms, channel`,
          )
          .all(meetingId) as unknown as ChunkRow[]
      ).map((row) => ({
        meetingId: row.meeting_id,
        channel: row.channel,
        seq: row.seq,
        path: row.path,
        sha256: row.sha256,
        bytes: row.bytes,
        startMs: row.start_ms,
        durationMs: row.duration_ms,
      }));
    },
    progress(meetingId) {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS chunks, COUNT(transcribed_at) AS done
           FROM meeting_audio_chunks WHERE meeting_id = ?`,
        )
        .get(meetingId) as { chunks: number; done: number };
      return { chunks: row.chunks, done: row.done };
    },
    addChunkSegments(chunk, segments, at) {
      const insert = db.prepare(
        `INSERT OR IGNORE INTO meeting_segments
           (id, meeting_id, channel, start_ms, end_ms, text, language, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      let added = 0;
      db.exec("BEGIN IMMEDIATE");
      try {
        segments.forEach((segment, index) => {
          const text = segment.text.trim();
          if (!text || NOT_SPEECH.test(text)) return;
          added += Number(
            insert.run(
              `${chunk.meetingId}:${chunk.channel}:${chunk.seq}:${index}`,
              chunk.meetingId,
              segment.channel,
              Math.max(0, Math.round(segment.startMs)),
              Math.max(0, Math.round(segment.endMs)),
              text,
              segment.language,
              at,
            ).changes,
          );
        });
        db.prepare(
          `UPDATE meeting_audio_chunks SET transcribed_at = ?
           WHERE meeting_id = ? AND channel = ? AND seq = ?`,
        ).run(at, chunk.meetingId, chunk.channel, chunk.seq);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return added;
    },
    segments(meetingId) {
      return (
        db
          .prepare(
            `SELECT id, meeting_id, channel, start_ms, end_ms, text, language, speaker_id,
                    is_dictated, is_final
             FROM meeting_segments WHERE meeting_id = ?
             ORDER BY start_ms, CASE channel WHEN 'mic' THEN 0 ELSE 1 END, id`,
          )
          .all(meetingId) as unknown as SegmentRow[]
      ).map((row) => ({
        id: row.id,
        meetingId: row.meeting_id,
        channel: row.channel,
        startMs: row.start_ms,
        endMs: row.end_ms,
        text: row.text,
        language: row.language,
        speakerId: row.speaker_id,
        isDictated: row.is_dictated === 1,
        isFinal: row.is_final === 1,
      }));
    },
  };
}
