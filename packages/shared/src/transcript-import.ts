import { z } from "zod";

/** Importing a transcript file as a meeting (NT-21). */

export const TRANSCRIPT_IMPORT_FORMATS = ["vtt", "srt", "text", "json"] as const;
export type TranscriptImportFormat = (typeof TRANSCRIPT_IMPORT_FORMATS)[number];

export interface TranscriptImportPreview {
  /** Names the file for the confirm step. */
  token: string;
  fileName: string;
  format: TranscriptImportFormat;
  formatName: string;
  title: string;
  startedAt: number;
  durationMs: number;
  lines: number;
  /** The speakers named in the file. */
  speakers: string[];
  /** The file has no times, so they were estimated from the length of each line. */
  timesEstimated: boolean;
  /** The file, or a meeting with the same title at the same time, is already imported. */
  duplicate: {
    meetingId: string;
    title: string;
    reason: "same-file" | "same-title" | "same-recording";
  } | null;
}

export type TranscriptImportPreviewResult =
  | { ok: true; preview: TranscriptImportPreview }
  | { ok: false; message: string }
  | { ok: false; cancelled: true };

export const transcriptImportConfirmSchema = z.strictObject({
  token: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  startedAt: z.number().int().nonnegative(),
});
export type TranscriptImportConfirmInput = z.infer<typeof transcriptImportConfirmSchema>;

export type TranscriptImportConfirmResult =
  { ok: true; meetingId: string } | { ok: false; message: string };

/** `notetaker.import` (NT-21). */
export const importSettingsSchema = z.strictObject({
  /** Write a summary for an imported meeting. */
  regenerateSummary: z.boolean(),
  /** Where an imported meeting goes: "inbox" or the id of a folder. */
  defaultFolder: z.string().min(1).max(64),
});
export const DEFAULT_IMPORT_SETTINGS: z.infer<typeof importSettingsSchema> = {
  regenerateSummary: true,
  defaultFolder: "inbox",
};
