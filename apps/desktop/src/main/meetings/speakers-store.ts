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
 * unless it says otherwise. A line can be given to another speaker, also a new one (a guest in
 * the room): that is a correction (NT-24).
 */
export interface SpeakersStore {
  /** The meeting's speakers: its channels, then the ones added, with the lines and talk each has. */
  list(meetingId: string): MeetingSpeaker[];
  /** One name for the whole meeting. For a channel's speaker, empty gives its first name back. */
  rename(meetingId: string, speakerId: string, name: string): SpeakerRenameResult;
  /** Adds a speaker (a person in the room, say) that lines can be given to. */
  add(
    meetingId: string,
    channel: MeetingChannel,
    name: string,
  ): { ok: true; id: string } | { ok: false; message: string };
  /** The line to play for a speaker: its longest one. */
  sample(meetingId: string, speakerId: string): SpeakerSample | null;
}

const clean = (name: string) => name.replace(/\s+/g, " ").trim();

/** The speaker a line belongs to, as SQL. */
const EFFECTIVE = "COALESCE(speaker_id, meeting_id || ':' || channel)";

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
    const rows = db
      .prepare(
        "SELECT id, channel, name FROM meeting_speakers WHERE meeting_id = ? ORDER BY created_at, id",
      )
      .all(meetingId) as { id: string; channel: MeetingChannel; name: string }[];
    const named = new Map(rows.map((r) => [r.id, r.name]));
    const totals = new Map(
      (
        db
          .prepare(
            `SELECT ${EFFECTIVE} AS sid, COUNT(*) AS n, COALESCE(SUM(end_ms - start_ms), 0) AS talk
             FROM meeting_segments WHERE meeting_id = ? AND is_dictated = 0 GROUP BY sid`,
          )
          .all(meetingId) as { sid: string; n: number; talk: number }[]
      ).map((r) => [r.sid, r]),
    );
    const own = new Set(MEETING_CHANNELS.map((c) => channelSpeakerId(meetingId, c)));
    const speakers: MeetingSpeaker[] = channels.map((channel) => {
      const id = channelSpeakerId(meetingId, channel);
      return {
        id,
        channel,
        name: named.get(id) ?? SPEAKER_DEFAULT_NAMES[channel],
        defaultName: SPEAKER_DEFAULT_NAMES[channel],
        segments: totals.get(id)?.n ?? 0,
        talkMs: totals.get(id)?.talk ?? 0,
      };
    });
    // Speakers that were added, once they have lines. One whose lines were not found again by a
    // rerun (NT-23) stays listed with none, so the name is not lost without a word.
    const heardBefore = db.prepare(
      "SELECT 1 FROM transcript_versions WHERE meeting_id = ? AND INSTR(segments_json, ?) > 0",
    );
    for (const row of rows) {
      if (own.has(row.id)) continue;
      if (!totals.has(row.id) && !heardBefore.get(meetingId, JSON.stringify(row.id))) continue;
      speakers.push({
        id: row.id,
        channel: row.channel,
        name: row.name,
        defaultName: row.name,
        segments: totals.get(row.id)?.n ?? 0,
        talkMs: totals.get(row.id)?.talk ?? 0,
      });
    }
    return speakers;
  };

  /** Checks a name; returns the cleaned name or why not. */
  const check = (
    speakers: MeetingSpeaker[],
    selfId: string | null,
    name: string,
  ): { ok: true; name: string } | { ok: false; message: string } => {
    if (name.length > SPEAKER_NAME_MAX)
      return { ok: false, message: `A name can be up to ${SPEAKER_NAME_MAX} characters.` };
    const taken = speakers.find(
      (other) => other.id !== selfId && other.name.toLowerCase() === name.toLowerCase(),
    );
    return taken
      ? { ok: false, message: `${taken.name} is already a speaker in this meeting.` }
      : { ok: true, name };
  };

  const write = (id: string, meetingId: string, channel: MeetingChannel, name: string) => {
    const at = deps.now();
    db.prepare(
      `INSERT INTO meeting_speakers (id, meeting_id, channel, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
    ).run(id, meetingId, channel, name, at, at);
  };

  return {
    list,

    rename(meetingId, speakerId, name) {
      const speakers = list(meetingId);
      const speaker = speakers.find((candidate) => candidate.id === speakerId);
      if (!speaker) return { ok: false, message: "That speaker is not in this meeting." };
      const own = speaker.id === channelSpeakerId(meetingId, speaker.channel);
      const wanted = clean(name);
      if (wanted === "" && !own) return { ok: false, message: "Write a name." };
      const checked = check(speakers, speaker.id, wanted === "" ? speaker.defaultName : wanted);
      if (!checked.ok) return checked;
      // One row: every line of the speaker follows it.
      write(speaker.id, meetingId, speaker.channel, checked.name);
      return { ok: true, speakers: list(meetingId) };
    },

    add(meetingId, channel, name) {
      const speakers = list(meetingId);
      if (channelsOf(meetingId) === null) return { ok: false, message: "That meeting is gone." };
      const wanted = clean(name);
      if (wanted === "") return { ok: false, message: "Write a name." };
      const checked = check(speakers, null, wanted);
      if (!checked.ok) return checked;
      const used = (
        db
          .prepare("SELECT id FROM meeting_speakers WHERE meeting_id = ? AND id LIKE ?")
          .all(meetingId, `${meetingId}:p%`) as { id: string }[]
      ).map((row) => Number(row.id.slice(`${meetingId}:p`.length)) || 0);
      const id = `${meetingId}:p${Math.max(0, ...used) + 1}`;
      write(id, meetingId, channel, checked.name);
      return { ok: true, id };
    },

    sample(meetingId, speakerId) {
      const speaker = list(meetingId).find((candidate) => candidate.id === speakerId);
      if (!speaker) return null;
      const row = db
        .prepare(
          `SELECT id, channel, start_ms, end_ms FROM meeting_segments
           WHERE meeting_id = ? AND is_dictated = 0 AND ${EFFECTIVE} = ?
           ORDER BY (end_ms - start_ms) DESC, start_ms LIMIT 1`,
        )
        .get(meetingId, speaker.id) as
        { id: string; channel: MeetingChannel; start_ms: number; end_ms: number } | undefined;
      return row
        ? { segmentId: row.id, channel: row.channel, startMs: row.start_ms, endMs: row.end_ms }
        : null;
    },
  };
}
