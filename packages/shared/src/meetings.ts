import { z } from "zod";
import { DEFAULT_DETECT, detectSettingsSchema } from "./detect";
import { audioSessionIdSchema } from "./audio";
import { transcriptSchema } from "./speech";

/**
 * Notetaker (M5). Meetings are recorded by the helper as two channels of chunk files; main
 * keeps the meeting rows and the chunk list. Audio never crosses the protocol.
 */

export const MEETING_CHANNELS = ["mic", "system"] as const;
export type MeetingChannel = (typeof MEETING_CHANNELS)[number];
export const meetingChannelSchema = z.enum(MEETING_CHANNELS);

/** Problems a channel can report while recording; the recording goes on (NT-04). */
export const CAPTURE_ISSUES = ["device_lost", "sck_stream_stopped", "write_failed"] as const;
export type CaptureIssue = (typeof CAPTURE_ISSUES)[number];

/** Why a channel did not start: no Screen Recording permission, or the stream failed. */
export const CAPTURE_WARNINGS = ["system_permission", "system_unavailable"] as const;
export type CaptureWarning = (typeof CAPTURE_WARNINGS)[number];

// ------------------------------------------------------------------- protocol

export const captureStartPayloadSchema = z.object({
  meetingId: audioSessionIdSchema,
  /** Absolute folder the chunk files go in. */
  folder: z.string().min(2).max(1024).startsWith("/"),
  channels: z.array(meetingChannelSchema).min(1).max(2).optional(),
  chunkSeconds: z.number().int().min(1).max(300).optional(),
  /** A device id from `audio.devices`, or null for the system default. */
  micDeviceId: z.string().min(1).max(512).nullable().optional(),
});
export type CaptureStartInput = z.infer<typeof captureStartPayloadSchema>;

export const captureStartResultSchema = z.object({
  startedAt: z.number().int().nonnegative(),
  /** The channels that started, with their device names. */
  channels: z.object({ mic: z.string().optional(), system: z.string().optional() }),
  sampleRate: z.literal(16000),
  warnings: z.array(z.enum(CAPTURE_WARNINGS)),
});
export type CaptureStartResult = z.infer<typeof captureStartResultSchema>;

export const captureStopPayloadSchema = z.object({ meetingId: audioSessionIdSchema });

const channelSummarySchema = z.object({
  chunks: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export const captureStopResultSchema = z.object({
  durationMs: z.number().int().nonnegative(),
  channels: z.object({
    mic: channelSummarySchema.optional(),
    system: channelSummarySchema.optional(),
  }),
});
export type CaptureStopResult = z.infer<typeof captureStopResultSchema>;

export const captureChunkPayloadSchema = z.object({
  meetingId: audioSessionIdSchema,
  channel: meetingChannelSchema,
  seq: z.number().int().positive(),
  path: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
  /** Where the chunk starts on the meeting's timeline. */
  startMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});
export type CaptureChunk = z.infer<typeof captureChunkPayloadSchema>;

export const captureLevelPayloadSchema = z.object({
  meetingId: audioSessionIdSchema,
  channel: meetingChannelSchema,
  rmsDb: z.number(),
});
export type CaptureLevel = z.infer<typeof captureLevelPayloadSchema>;

export const captureErrorPayloadSchema = z.object({
  meetingId: audioSessionIdSchema,
  channel: meetingChannelSchema,
  code: z.enum(CAPTURE_ISSUES),
});
export type CaptureError = z.infer<typeof captureErrorPayloadSchema>;

/** NT-06: decode the chunk still being written on a channel, for live text. */
export const transcribeLivePayloadSchema = z.object({
  meetingId: audioSessionIdSchema,
  channel: meetingChannelSchema,
  languages: z.array(z.string().min(1)).max(20).optional(),
});
export type TranscribeLiveInput = z.infer<typeof transcribeLivePayloadSchema>;

/** Segment times are from the chunk's start; `startMs` places the chunk on the timeline. */
export const transcribeLiveResultSchema = transcriptSchema.extend({
  channel: meetingChannelSchema,
  seq: z.number().int().positive(),
  startMs: z.number().int().nonnegative(),
});
export type LiveTranscript = z.infer<typeof transcribeLiveResultSchema>;

// ------------------------------------------------------------------- meetings

export const MEETING_STATUSES = ["recording", "queued", "processing", "ready", "failed"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const MEETING_SOURCES = ["recorded", "imported", "ad_hoc", "calendar"] as const;
export type MeetingSource = (typeof MEETING_SOURCES)[number];

export interface Meeting {
  id: string;
  title: string;
  startedAt: number;
  endedAt: number | null;
  source: MeetingSource;
  status: MeetingStatus;
  /** Channels recorded, in order. */
  channels: MeetingChannel[];
  /** Warnings shown on the meeting: missing system sound, a lost device. */
  warnings: MeetingWarning[];
  durationMs: number;
  audioDeletedAt: number | null;
}

export interface AudioChunkRow {
  meetingId: string;
  channel: MeetingChannel;
  seq: number;
  path: string;
  sha256: string;
  bytes: number;
  startMs: number;
  durationMs: number;
}

/** One line of a meeting's transcript (NT-06). Final segments are never changed by Murmur. */
export interface MeetingSegment {
  id: string;
  meetingId: string;
  channel: MeetingChannel;
  startMs: number;
  endMs: number;
  text: string;
  language: string | null;
  speakerId: string | null;
  isDictated: boolean;
  isFinal: boolean;
}

export const MEETING_JOB_KINDS = [
  "transcribe",
  "summarise",
  "extract_tasks",
  "build_index",
] as const;
export type MeetingJobKind = (typeof MEETING_JOB_KINDS)[number];

/** How far the transcription of a meeting has got, for the meeting list. */
export interface TranscriptionProgress {
  chunks: number;
  done: number;
}

/**
 * Text heard in the chunk still being recorded on a channel (NT-06). Grey, and replaced when
 * that chunk's final segments are written. Times are on the meeting's timeline.
 */
export interface LivePartial {
  meetingId: string;
  channel: MeetingChannel;
  seq: number;
  segments: { startMs: number; endMs: number; text: string }[];
}

/** A link or a copied file attached to a meeting (NT-10, Docs tab). */
export interface MeetingDoc {
  id: string;
  meetingId: string;
  kind: "link" | "file";
  title: string;
  /** The address of a link; null for a file. */
  url: string | null;
  bytes: number | null;
  addedAt: number;
}

export interface MeetingListItem extends Meeting {
  progress: TranscriptionProgress;
}

/** Everything the meeting view shows. */
export interface MeetingDetail {
  meeting: Meeting;
  progress: TranscriptionProgress;
  segments: MeetingSegment[];
  live: LivePartial[];
  notes: string;
  notesUpdatedAt: number | null;
  docs: MeetingDoc[];
}

export const MEETING_TABS = ["notes", "summary", "transcript", "tasks", "brief", "docs"] as const;
export type MeetingTab = (typeof MEETING_TABS)[number];

/** Limits for the meeting view. */
export const MEETING_LIMITS = {
  notesBytes: 200_000,
  titleChars: 200,
  docFileBytes: 50 * 1024 * 1024,
  docsPerMeeting: 50,
} as const;

/** What a meeting can be marked with: a channel problem, or a recording cut short. */
export type MeetingWarning = CaptureWarning | CaptureIssue | "interrupted" | "sleep";

/** What the Notetaker shows about the recording now. */
export type RecordingState =
  | { status: "idle" }
  | { status: "starting" }
  | {
      status: "recording";
      meetingId: string;
      title: string;
      startedAt: number;
      channels: MeetingChannel[];
      warnings: MeetingWarning[];
    }
  | { status: "stopping"; meetingId: string };

export const MEETING_WARNING_TEXT: Record<MeetingWarning, string> = {
  system_permission:
    "Only your microphone was recorded. Allow Screen Recording for Murmur to record the other people too.",
  system_unavailable: "Only your microphone was recorded: the Mac's sound could not be captured.",
  device_lost: "The microphone changed during the meeting; recording went on with the default one.",
  sck_stream_stopped: "Recording the Mac's sound stopped part way; your microphone kept recording.",
  write_failed: "Part of the recording could not be saved.",
  interrupted: "The recording stopped unexpectedly. What was saved before then is kept.",
  sleep: "The recording stopped when the Mac went to sleep. Start a new one to carry on.",
};

/** "Meeting, 21 Nov 2026 14:05" in the local time zone (NT-03). */
export function defaultMeetingTitle(at: number, locale?: string): string {
  const date = new Date(at);
  const day = date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `Meeting, ${day} ${time}`;
}

/** 0:07, 12:30, 1:02:03. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

// ------------------------------------------------------------------- settings

export const CONSENT_NOTICES = ["first", "always", "off"] as const;
export type ConsentNotice = (typeof CONSENT_NOTICES)[number];

/**
 * Notetaker settings (`notetaker.settings`). Fields added after the first release carry a
 * default, so a value stored by an older build still reads.
 */
export const notetakerSettingsSchema = z.strictObject({
  /** NT-04: record the Mac's sound as well as the microphone. */
  captureSystem: z.boolean(),
  /** NT-04: length of each audio chunk file. */
  chunkSeconds: z.number().int().min(5).max(120),
  /** NT-06: show text while the meeting records. */
  live: z.boolean().default(true),
  /**
   * NT-25: the recording-consent notice. `first` shows it for the first recording on this
   * install (`seen` records that), `always` before every recording, `off` never.
   */
  consent: z
    .strictObject({
      notice: z.enum(CONSENT_NOTICES),
      seen: z.boolean(),
    })
    .default({ notice: "first", seen: false }),
  /** NT-01: detect calls in Zoom, Meet and Teams. */
  detect: detectSettingsSchema.default(DEFAULT_DETECT),
});
export type NotetakerSettings = z.infer<typeof notetakerSettingsSchema>;

export const DEFAULT_NOTETAKER: NotetakerSettings = {
  captureSystem: true,
  chunkSeconds: 30,
  live: true,
  consent: { notice: "first", seen: false },
  detect: DEFAULT_DETECT,
};
