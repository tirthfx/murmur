import { z } from "zod";

/**
 * Retention of meeting audio and transcripts (NT-22). Audio and transcript have their own
 * periods. When a period ends the item is deleted for good, and the meeting keeps its title,
 * date and folder with a "Deleted by retention" marker.
 */

export const AUDIO_RETENTION = ["forever", "30d", "7d", "processing"] as const;
export type AudioRetention = (typeof AUDIO_RETENTION)[number];
export const AUDIO_RETENTION_TEXT: Record<AudioRetention, string> = {
  forever: "Keep for ever",
  "30d": "30 days",
  "7d": "7 days",
  processing: "Delete after processing",
};

export const TRANSCRIPT_RETENTION = ["forever", "1y", "90d", "30d"] as const;
export type TranscriptRetention = (typeof TRANSCRIPT_RETENTION)[number];
export const TRANSCRIPT_RETENTION_TEXT: Record<TranscriptRetention, string> = {
  forever: "Keep for ever",
  "1y": "1 year",
  "90d": "90 days",
  "30d": "30 days",
};

/** How many days a period is; null for the ones that are not a time. */
export const RETENTION_DAYS: Record<string, number | null> = {
  forever: null,
  processing: null,
  "30d": 30,
  "7d": 7,
  "1y": 365,
  "90d": 90,
};

/** `notetaker.retention` (NT-22). */
export const meetingRetentionSettingsSchema = z.strictObject({
  audio: z.enum(AUDIO_RETENTION),
  transcript: z.enum(TRANSCRIPT_RETENTION),
  /** When a transcript is deleted, delete the summaries of the meeting too. */
  removeSummaryWithTranscript: z.boolean(),
});
export const DEFAULT_MEETING_RETENTION: z.infer<typeof meetingRetentionSettingsSchema> = {
  audio: "30d",
  transcript: "forever",
  removeSummaryWithTranscript: false,
};

/** What the next 24 hours will delete (shown in Settings). */
export interface MeetingRetentionDue {
  audio: number;
  transcripts: number;
}
