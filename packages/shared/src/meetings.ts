import { z } from "zod";
import { DEFAULT_DETECT, detectSettingsSchema } from "./detect";
import {
  type MeetingSummary,
  DEFAULT_SKILLS_SETTINGS,
  DEFAULT_SUMMARY_SETTINGS,
  skillsSettingsSchema,
  summarySettingsSchema,
} from "./skills";
import { audioSessionIdSchema } from "./audio";
import { DEFAULT_IMPORT_SETTINGS, importSettingsSchema } from "./transcript-import";
import { DEFAULT_MEETING_RETENTION, meetingRetentionSettingsSchema } from "./meeting-retention";
import { meetingLanguageCodes } from "./languages";
import { DEFAULT_ASK_SETTINGS, askSettingsSchema } from "./ask";
import { DEFAULT_FOLDERS_SETTINGS, foldersSettingsSchema, type FolderSuggestion } from "./folders";
import { DEFAULT_TASKS_SETTINGS, tasksSettingsSchema } from "./tasks";
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
  /** NT-20: write the words in English whatever language is spoken. */
  translate: z.boolean().optional(),
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
  /** NT-20: null means the language is detected. */
  language: string | null;
  /** NT-20: the transcript is written in English whatever is spoken. */
  translate: boolean;
  /** NT-23: goes up by one with each rerun; the older transcripts are kept for a while. */
  transcriptVersion: number;
  /** NT-17: the folder it is in; null for the Inbox. */
  folderId: string | null;
  /** NT-22: when retention deleted the transcript, or null. */
  transcriptDeletedAt: number | null;
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
  /** NT-24: the line has been corrected (text, speaker, split or merge). */
  edited: boolean;
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

/** One of the people in a meeting's transcript (NT-07). Level 1: "You" and "Remote". */
export interface MeetingSpeaker {
  /** `<meeting id>:mic` or `<meeting id>:system` until speakers are told apart in a channel. */
  id: string;
  channel: MeetingChannel;
  name: string;
  /** The name Murmur gives it before it is renamed: "You" or "Remote". */
  defaultName: string;
  segments: number;
  /** How long the speaker's lines run, added up. */
  talkMs: number;
}

export const SPEAKER_DEFAULT_NAMES: Record<MeetingChannel, string> = {
  mic: "You",
  system: "Remote",
};

export const SPEAKER_NAME_MAX = 60;

export type SpeakerRenameResult =
  { ok: true; speakers: MeetingSpeaker[] } | { ok: false; message: string };

/** NT-08: a short sample of a speaker, decoded and played in the Hub. */
export type SpeakerClipResult =
  | {
      ok: true;
      /** The m4a file the line is in. */
      bytes: Uint8Array;
      /** Where in that file to start, and how long to play (at most 8 seconds). */
      offsetSec: number;
      playSec: number;
      segmentId: string;
    }
  | { ok: false; reason: "audio-deleted" | "no-audio" | "no-speech" };

export const SPEAKER_CLIP_MAX_SEC = 8;

/** NT-24: a change to a transcript line. */
export const correctionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("text"),
    segmentId: z.string().min(1).max(200),
    text: z.string().max(4_000),
  }),
  z.strictObject({
    kind: z.literal("speaker"),
    segmentId: z.string().min(1).max(200),
    /** An existing speaker, or the name of a new one. */
    speakerId: z.string().min(1).max(200).optional(),
    newName: z.string().max(200).optional(),
  }),
  z.strictObject({
    kind: z.literal("split"),
    segmentId: z.string().min(1).max(200),
    /** Where in the text the line is cut: the characters before it stay in the first line. */
    offset: z.number().int().min(1).max(4_000),
  }),
  z.strictObject({ kind: z.literal("merge"), segmentId: z.string().min(1).max(200) }),
]);
export type Correction = z.infer<typeof correctionSchema>;

export const SEGMENT_TEXT_MAX = 4_000;

/** The result of a correction. `learned` says what was added to the Dictionary for review. */
export type CorrectionResult =
  | {
      ok: true;
      segmentId: string;
      changed: boolean;
      learned: { spoken: string; written: string } | null;
    }
  | { ok: false; message: string };

/** What a line was before one of its corrections. */
export interface SegmentHistoryItem {
  id: number;
  kind: "text" | "speaker" | "split" | "merge";
  createdAt: number;
  /** What the line said or who said it, before. */
  original: string;
  /** Only the newest correction of a line can be taken back first. */
  canRevert: boolean;
}

export type RevertResult = { ok: true } | { ok: false; message: string };

/** NT-20: how a meeting is transcribed. `language` null means detect it. */
export const meetingLanguageSchema = z.strictObject({
  language: z.enum(meetingLanguageCodes).nullable(),
  translate: z.boolean(),
});
export type MeetingLanguageInput = z.infer<typeof meetingLanguageSchema>;

/** A transcript a rerun replaced, kept for a while so it can be put back (NT-23). */
export interface TranscriptVersionInfo {
  id: number;
  version: number;
  language: string | null;
  translate: boolean;
  lines: number;
  /** When it was replaced. */
  replacedAt: number;
  /** After this day it is deleted. */
  expiresAt: number;
}

export type RerunResult = { ok: true } | { ok: false; message: string };

/** Everything the meeting view shows. */
export interface MeetingDetail {
  meeting: Meeting;
  progress: TranscriptionProgress;
  segments: MeetingSegment[];
  live: LivePartial[];
  notes: string;
  notesUpdatedAt: number | null;
  docs: MeetingDoc[];
  /** NT-09: every version, oldest first. */
  summaries: MeetingSummary[];
  summaryStatus: SummaryStatus;
  /** NT-26: whether tasks are being found for this meeting. */
  taskStatus: TaskRunStatus;
  /** NT-07: who spoke, with their counts and talk time. */
  speakers: MeetingSpeaker[];
  /** NT-23: the transcripts a rerun replaced and that can still be put back. */
  transcriptVersions: TranscriptVersionInfo[];
  /** NT-20: the language most lines were heard in, when the language is detected. */
  detectedLanguage: string | null;
  /** NT-23: why the transcript cannot be rerun now (deleted audio, still working), or null. */
  rerunBlocked: string | null;
  /** NT-17: a folder this meeting looks like it belongs in, for the Inbox only. */
  folderSuggestion: FolderSuggestion | null;
}

/** What the Tasks tab shows besides the tasks (NT-26). */
export type TaskRunStatus =
  | { state: "idle" }
  /** Queued behind the summary or the language model. */
  | { state: "waiting" }
  | { state: "running" }
  | { state: "failed"; message: string };

export type MeetingFindTasksResult = { ok: true } | { ok: false; message: string };

/** What the Summary tab shows besides the summaries (NT-09). */
export type SummaryStatus =
  | { state: "idle" }
  /** Queued behind the transcript or the language model. */
  | { state: "waiting" }
  | { state: "running"; done: number; total: number }
  | { state: "failed"; message: string };

export type MeetingSummarizeResult = { ok: true } | { ok: false; message: string };

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
  /** NT-09: summaries. */
  summary: summarySettingsSchema.default(DEFAULT_SUMMARY_SETTINGS),
  /** NT-15: which Skill writes the summary. */
  skills: skillsSettingsSchema.default(DEFAULT_SKILLS_SETTINGS),
  /** NT-26: tasks suggested from meetings. */
  tasks: tasksSettingsSchema.default(DEFAULT_TASKS_SETTINGS),
  /** NT-14: asking across meetings. */
  ask: askSettingsSchema.default(DEFAULT_ASK_SETTINGS),
  /** NT-20: the language a new meeting starts with: "auto" or a code. */
  language: z
    .strictObject({ default: z.enum(["auto", ...meetingLanguageCodes]) })
    .default({ default: "auto" }),
  /** NT-20: write the transcript of a new meeting in English whatever is spoken. */
  translate: z.strictObject({ transcriptToEnglish: z.boolean() }).default({
    transcriptToEnglish: false,
  }),
  /** NT-23: how many days a transcript a rerun replaced can be put back. */
  rerun: z
    .strictObject({ keepPreviousVersionDays: z.number().int().min(1).max(365) })
    .default({ keepPreviousVersionDays: 30 }),
  /** NT-21: importing transcript files. */
  import: importSettingsSchema.default(DEFAULT_IMPORT_SETTINGS),
  /** NT-22: how long audio and transcripts are kept. */
  retention: meetingRetentionSettingsSchema.default(DEFAULT_MEETING_RETENTION),
  /** NT-17: folders. */
  folders: foldersSettingsSchema.default(DEFAULT_FOLDERS_SETTINGS),
  /** NT-24: corrections to a transcript. */
  corrections: z
    .strictObject({
      /** Offer words the owner changes again and again to the Dictionary, for review. */
      suggestDictionary: z.boolean(),
    })
    .default({ suggestDictionary: true }),
});
export type NotetakerSettings = z.infer<typeof notetakerSettingsSchema>;

export const DEFAULT_NOTETAKER: NotetakerSettings = {
  captureSystem: true,
  chunkSeconds: 30,
  live: true,
  consent: { notice: "first", seen: false },
  detect: DEFAULT_DETECT,
  summary: DEFAULT_SUMMARY_SETTINGS,
  skills: DEFAULT_SKILLS_SETTINGS,
  tasks: DEFAULT_TASKS_SETTINGS,
  ask: DEFAULT_ASK_SETTINGS,
  corrections: { suggestDictionary: true },
  language: { default: "auto" },
  translate: { transcriptToEnglish: false },
  rerun: { keepPreviousVersionDays: 30 },
  folders: DEFAULT_FOLDERS_SETTINGS,
  retention: DEFAULT_MEETING_RETENTION,
  import: DEFAULT_IMPORT_SETTINGS,
};
