import type { DatabaseSync } from "node:sqlite";
import { SPEAKER_CLIP_MAX_SEC, type SpeakerClipResult } from "@murmur/shared";
import type { SpeakersStore } from "./speakers-store";

/** A chunk file is about 30 seconds of 16 kHz speech; anything this big is not one. */
const MAX_BYTES = 8 * 1024 * 1024;
const MIN_PLAY_SEC = 3;

export interface SpeakerClipDeps {
  speakers: Pick<SpeakersStore, "sample">;
  /** The bytes of a chunk file, or null when it is not there. */
  read(path: string): Uint8Array | null;
}

/**
 * A short sample of a speaker (NT-08): their longest line, taken from the stored chunk it is
 * in. The Hub decodes the chunk and plays from the line's start, for at most 8 seconds and
 * never past the end of the chunk. Once the meeting's audio is deleted there is nothing to play.
 */
export function createSpeakerClip(
  db: DatabaseSync,
  deps: SpeakerClipDeps,
): (meetingId: string, speakerId: string) => SpeakerClipResult {
  return (meetingId, speakerId) => {
    const meeting = db
      .prepare("SELECT audio_deleted_at FROM meetings WHERE id = ?")
      .get(meetingId) as { audio_deleted_at: number | null } | undefined;
    if (!meeting) return { ok: false, reason: "no-audio" };
    if (meeting.audio_deleted_at !== null) return { ok: false, reason: "audio-deleted" };
    const sample = deps.speakers.sample(meetingId, speakerId);
    if (!sample) return { ok: false, reason: "no-speech" };
    const chunk = db
      .prepare(
        `SELECT path, start_ms, duration_ms FROM meeting_audio_chunks
         WHERE meeting_id = ? AND channel = ? AND start_ms <= ?
         ORDER BY start_ms DESC LIMIT 1`,
      )
      .get(meetingId, sample.channel, sample.startMs) as
      { path: string; start_ms: number; duration_ms: number } | undefined;
    if (!chunk) return { ok: false, reason: "no-audio" };
    const left = (chunk.start_ms + chunk.duration_ms - sample.startMs) / 1000;
    if (left < 0.2) return { ok: false, reason: "no-audio" };
    const bytes = deps.read(chunk.path);
    if (!bytes || bytes.length === 0 || bytes.length > MAX_BYTES)
      return { ok: false, reason: "no-audio" };
    const lineSec = (sample.endMs - sample.startMs) / 1000;
    return {
      ok: true,
      bytes,
      offsetSec: (sample.startMs - chunk.start_ms) / 1000,
      playSec: Math.min(SPEAKER_CLIP_MAX_SEC, Math.max(MIN_PLAY_SEC, lineSec), left),
      segmentId: sample.segmentId,
    };
  };
}
