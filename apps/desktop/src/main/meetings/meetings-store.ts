import type { DatabaseSync } from "node:sqlite";
import {
  MEETING_CHANNELS,
  type AudioChunkRow,
  type Meeting,
  type MeetingAttendee,
  type MeetingChannel,
  type MeetingSource,
  type MeetingStatus,
  type MeetingWarning,
} from "@murmur/shared";

/** Meetings and their audio chunk rows (NT-04). */
export interface MeetingsStore {
  create(input: {
    id: string;
    title: string;
    startedAt: number;
    source: MeetingSource;
    folder: string;
    /** NT-20: null detects the language. */
    language?: string | null;
    translate?: boolean;
    /** NT-17: null puts it in the Inbox. */
    folderId?: string | null;
    /** NT-02: the calendar event it is started from, and who was invited. */
    calendarEventId?: string | null;
    attendees?: readonly MeetingAttendee[];
  }): Meeting;
  get(id: string): Meeting | null;
  /** Newest first. */
  list(limit?: number): Meeting[];
  /** Ids of meetings with this status, oldest first. */
  withStatus(status: MeetingStatus): string[];
  folderOf(id: string): string | null;
  setChannels(id: string, channels: MeetingChannel[]): void;
  /** Adds a warning once. */
  addWarning(id: string, warning: MeetingWarning): void;
  addChunk(chunk: AudioChunkRow): void;
  /** In timeline order, per channel. */
  chunks(id: string): AudioChunkRow[];
  /** Ends a recording: when it ended, how long it ran, and its new status. */
  finish(id: string, endedAt: number, durationMs: number, status: MeetingStatus): void;
  setStatus(id: string, status: MeetingStatus): void;
  /** A rename by the owner; marks the title as edited. */
  rename(id: string, title: string): void;
  /**
   * A title made from the summary (NT-03). It never replaces a title the owner chose:
   * returns false when it did not change the title.
   */
  setGeneratedTitle(id: string, title: string): boolean;
  /** NT-20: how the meeting is transcribed from now on. */
  setLanguage(id: string, language: string | null, translate: boolean): void;
  /** NT-23: true once, after a rerun, when its transcription has finished: a new summary is due. */
  consumeRerun(id: string): boolean;
  /** NT-25: the owner accepted the recording notice for this meeting. */
  acknowledgeConsent(id: string, at: number): void;
  consentAcknowledgedAt(id: string): number | null;
  remove(id: string): void;
}

interface MeetingRow {
  id: string;
  title: string;
  started_at: number;
  ended_at: number | null;
  source: MeetingSource;
  status: MeetingStatus;
  channels: string;
  warnings: string;
  duration_ms: number;
  audio_deleted_at: number | null;
  language: string | null;
  translate: number;
  transcript_version: number;
  folder_id: string | null;
  transcript_deleted_at: number | null;
  calendar_event_id: string | null;
  attendees_json: string;
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

const COLUMNS =
  "id, title, started_at, ended_at, source, status, channels, warnings, duration_ms, audio_deleted_at, language, translate, transcript_version, folder_id, transcript_deleted_at, calendar_event_id, attendees_json";

function parseList<T>(text: string): T[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function toMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    title: row.title,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    source: row.source,
    status: row.status,
    channels: parseList<MeetingChannel>(row.channels),
    warnings: parseList<MeetingWarning>(row.warnings),
    durationMs: row.duration_ms,
    audioDeletedAt: row.audio_deleted_at,
    language: row.language,
    translate: row.translate === 1,
    transcriptVersion: row.transcript_version,
    folderId: row.folder_id,
    transcriptDeletedAt: row.transcript_deleted_at,
    calendarEventId: row.calendar_event_id,
    attendees: parseList<MeetingAttendee>(row.attendees_json),
  };
}

/** Longest title kept. */
export const MEETING_TITLE_MAX = 200;

export function createMeetingsStore(db: DatabaseSync): MeetingsStore {
  const get = (id: string): Meeting | null => {
    const row = db.prepare(`SELECT ${COLUMNS} FROM meetings WHERE id = ?`).get(id) as
      MeetingRow | undefined;
    return row ? toMeeting(row) : null;
  };

  return {
    create(input) {
      db.prepare(
        `INSERT INTO meetings (id, title, started_at, source, status, folder, language, translate, folder_id,
           calendar_event_id, attendees_json)
         VALUES (?, ?, ?, ?, 'recording', ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.id,
        input.title.slice(0, MEETING_TITLE_MAX),
        input.startedAt,
        input.source,
        input.folder,
        input.language ?? null,
        input.translate ? 1 : 0,
        input.folderId ?? null,
        input.calendarEventId ?? null,
        JSON.stringify(input.attendees ?? []),
      );
      return get(input.id)!;
    },
    get,
    list(limit = 500) {
      return (
        db
          .prepare(`SELECT ${COLUMNS} FROM meetings ORDER BY started_at DESC LIMIT ?`)
          .all(limit) as unknown as MeetingRow[]
      ).map(toMeeting);
    },
    withStatus(status) {
      return (
        db.prepare("SELECT id FROM meetings WHERE status = ? ORDER BY started_at").all(status) as {
          id: string;
        }[]
      ).map((row) => row.id);
    },
    folderOf(id) {
      const row = db.prepare("SELECT folder FROM meetings WHERE id = ?").get(id) as
        { folder: string } | undefined;
      return row?.folder ?? null;
    },
    setLanguage(id, language, translate) {
      db.prepare("UPDATE meetings SET language = ?, translate = ? WHERE id = ?").run(
        language,
        translate ? 1 : 0,
        id,
      );
    },
    consumeRerun(id) {
      return (
        db
          .prepare("UPDATE meetings SET rerun_pending = 0 WHERE id = ? AND rerun_pending = 1")
          .run(id).changes > 0
      );
    },
    setChannels(id, channels) {
      const ordered = MEETING_CHANNELS.filter((channel) => channels.includes(channel));
      db.prepare("UPDATE meetings SET channels = ? WHERE id = ?").run(JSON.stringify(ordered), id);
    },
    addWarning(id, warning) {
      const meeting = get(id);
      if (!meeting || meeting.warnings.includes(warning)) return;
      db.prepare("UPDATE meetings SET warnings = ? WHERE id = ?").run(
        JSON.stringify([...meeting.warnings, warning]),
        id,
      );
    },
    addChunk(chunk) {
      db.prepare(
        `INSERT OR REPLACE INTO meeting_audio_chunks
           (meeting_id, channel, seq, path, sha256, bytes, start_ms, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        chunk.meetingId,
        chunk.channel,
        chunk.seq,
        chunk.path,
        chunk.sha256,
        chunk.bytes,
        chunk.startMs,
        chunk.durationMs,
      );
    },
    chunks(id) {
      return (
        db
          .prepare(
            `SELECT meeting_id, channel, seq, path, sha256, bytes, start_ms, duration_ms
             FROM meeting_audio_chunks WHERE meeting_id = ? ORDER BY channel, seq`,
          )
          .all(id) as unknown as ChunkRow[]
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
    finish(id, endedAt, durationMs, status) {
      db.prepare("UPDATE meetings SET ended_at = ?, duration_ms = ?, status = ? WHERE id = ?").run(
        endedAt,
        Math.max(0, Math.round(durationMs)),
        status,
        id,
      );
    },
    setStatus(id, status) {
      db.prepare("UPDATE meetings SET status = ? WHERE id = ?").run(status, id);
    },
    rename(id, title) {
      const clean = title.trim().slice(0, MEETING_TITLE_MAX);
      if (!clean) return;
      db.prepare("UPDATE meetings SET title = ?, title_edited = 1 WHERE id = ?").run(clean, id);
    },
    setGeneratedTitle(id, title) {
      const clean = title.trim().slice(0, MEETING_TITLE_MAX);
      if (!clean) return false;
      return (
        Number(
          db
            .prepare("UPDATE meetings SET title = ? WHERE id = ? AND title_edited = 0")
            .run(clean, id).changes,
        ) > 0
      );
    },
    acknowledgeConsent(id, at) {
      db.prepare("UPDATE meetings SET consent_ack_at = ? WHERE id = ?").run(at, id);
    },
    consentAcknowledgedAt(id) {
      const row = db.prepare("SELECT consent_ack_at FROM meetings WHERE id = ?").get(id) as
        { consent_ack_at: number | null } | undefined;
      return row?.consent_ack_at ?? null;
    },
    remove(id) {
      db.prepare("DELETE FROM meetings WHERE id = ?").run(id);
    },
  };
}
