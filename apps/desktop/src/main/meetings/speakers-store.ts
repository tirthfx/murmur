import type { DatabaseSync } from "node:sqlite";
import {
  MEETING_CHANNELS,
  SPEAKER_DEFAULT_NAMES,
  SPEAKER_NAME_MAX,
  type MeetingChannel,
  type MeetingSpeaker,
  type SpeakerRenameResult,
} from "@murmur/shared";

/** The speaker a segment belongs to when nothing says otherwise: its channel's own. */
export const channelSpeakerId = (meetingId: string, channel: MeetingChannel) =>
  `${meetingId}:${channel}`;

/** A line of a speaker to play, and where it is. */
export interface SpeakerSample {
  segmentId: string;
  channel: MeetingChannel;
  startMs: number;
  endMs: number;
}

/**
 * The people in a meeting's transcript (NT-07, NT-08). At level 1 there are two: the
 * microphone ("You") and the Mac's sound ("Remote"). Naming one names every line of theirs,
 * including lines transcribed after the rename, because a line belongs to its channel's speaker
 * unless it says otherwise.
 */
export interface SpeakersStore {
  /** The meeting's speakers: its channels, with how many lines and how much talk each has. */
  list(meetingId: string): MeetingSpeaker[];
  /** One name for the whole meeting. Empty gives the speaker its first name back. */
  rename(meetingId: string, speakerId: string, name: string): SpeakerRenameResult;
  /** The line to play for a speaker: its longest one (at least one second when there is such a line). */
  sample(meetingId: string, speakerId: string): SpeakerSample | null;
}

const clean = (name: string) => name.replace(/\s+/g, " ").trim();

export function createSpeakersStore(db: DatabaseSync, deps: { now(): number }): SpeakersStore {
  const channelsOf = (meetingId: string): MeetingChannel[] | null => {
    const row = db.prepare("SELECT channels FROM meetings WHERE id = ?").get(meetingId) as
      { channels: string } | undefined;
    if (!row) return null;
    const recorded = JSON.parse(row.channels) as MeetingChannel[];
    // A channel with lines is a speaker even if the meeting row does not list it.
    const spoken = (
      db
        .prepare(
          "SELECT DISTINCT channel FROM meeting_segments WHERE meeting_id = ? AND is_dictated = 0",
        )
        .all(meetingId) as { channel: MeetingChannel }[]
    ).map((r) => r.channel);
    return MEETING_CHANNELS.filter((c) => recorded.includes(c) || spoken.includes(c));
  };

  const list = (meetingId: string): MeetingSpeaker[] => {
    const channels = channelsOf(meetingId);
    if (!channels) return [];
    const named = new Map(
      (
        db.prepare("SELECT id, name FROM meeting_speakers WHERE meeting_id = ?").all(meetingId) as {
          id: string;
          name: string;
        }[]
      ).map((r) => [r.id, r.name]),
    );
    const totals = new Map(
      (
        db
          .prepare(
            `SELECT channel, COUNT(*) AS n, COALESCE(SUM(end_ms - start_ms), 0) AS talk
             FROM meeting_segments
             WHERE meeting_id = ? AND is_dictated = 0
               AND (speaker_id IS NULL OR speaker_id = meeting_id || ':' || channel)
             GROUP BY channel`,
          )
          .all(meetingId) as { channel: MeetingChannel; n: number; talk: number }[]
      ).map((r) => [r.channel, r]),
    );
    return channels.map((channel) => {
      const id = channelSpeakerId(meetingId, channel);
      return {
        id,
        channel,
        name: named.get(id) ?? SPEAKER_DEFAULT_NAMES[channel],
        defaultName: SPEAKER_DEFAULT_NAMES[channel],
        segments: totals.get(channel)?.n ?? 0,
        talkMs: totals.get(channel)?.talk ?? 0,
      };
    });
  };

  return {
    list,

    rename(meetingId, speakerId, name) {
      const speakers = list(meetingId);
      const speaker = speakers.find((candidate) => candidate.id === speakerId);
      if (!speaker) return { ok: false, message: "That speaker is not in this meeting." };
      const next = clean(name) === "" ? speaker.defaultName : clean(name);
      if (next.length > SPEAKER_NAME_MAX)
        return { ok: false, message: `A name can be up to ${SPEAKER_NAME_MAX} characters.` };
      const taken = speakers.find(
        (other) => other.id !== speaker.id && other.name.toLowerCase() === next.toLowerCase(),
      );
      if (taken)
        return { ok: false, message: `${taken.name} is already a speaker in this meeting.` };
      const at = deps.now();
      // One row: every line of the speaker follows it.
      db.prepare(
        `INSERT INTO meeting_speakers (id, meeting_id, channel, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
      ).run(speaker.id, meetingId, speaker.channel, next, at, at);
      return { ok: true, speakers: list(meetingId) };
    },

    sample(meetingId, speakerId) {
      const speaker = list(meetingId).find((candidate) => candidate.id === speakerId);
      if (!speaker) return null;
      const rows = db
        .prepare(
          `SELECT id, channel, start_ms, end_ms FROM meeting_segments
           WHERE meeting_id = ? AND channel = ? AND is_dictated = 0
             AND (speaker_id IS NULL OR speaker_id = meeting_id || ':' || channel)
           ORDER BY (end_ms - start_ms) DESC, start_ms LIMIT 1`,
        )
        .get(meetingId, speaker.channel) as
        { id: string; channel: MeetingChannel; start_ms: number; end_ms: number } | undefined;
      return rows
        ? { segmentId: rows.id, channel: rows.channel, startMs: rows.start_ms, endMs: rows.end_ms }
        : null;
    },
  };
}
