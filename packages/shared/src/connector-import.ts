import { z } from "zod";

/**
 * Importing meetings from Zoom and Fireflies (CN-09, CN-10) through the transcript importer
 * (NT-21): the same preview, the same duplicate checks, the same writer. Nothing is imported
 * until the owner picks a meeting and confirms the preview.
 */

export const ZOOM_ID = "zoom";
export const FIREFLIES_ID = "fireflies";
export const IMPORT_CONNECTOR_IDS = [ZOOM_ID, FIREFLIES_ID] as const;

/** Zoom: the permission to read cloud recordings, set in the owner's Zoom app. */
export const ZOOM_SCOPES = ["recording:read"] as const;

export const IMPORT_RANGE_DAYS = [7, 30, 90] as const;

/** `connectors.zoom`: how far back to list recordings. Nothing is downloaded until a meeting is picked. */
export const zoomSettingsSchema = z.strictObject({
  rangeDays: z.number().int().min(1).max(90),
  /** CN-09: bring new recordings in without being asked. */
  autoImport: z.boolean().default(false),
});
export type ZoomSettings = z.infer<typeof zoomSettingsSchema>;
export const DEFAULT_ZOOM_SETTINGS: ZoomSettings = { rangeDays: 30, autoImport: false };

/** `connectors.fireflies`: how far back to list transcripts, and whether its summary comes with the meeting. */
export const firefliesSettingsSchema = z.strictObject({
  rangeDays: z.number().int().min(1).max(365),
  /** Keep Fireflies' own summary as a summary labelled as imported. */
  importProviderSummary: z.boolean(),
  /** CN-10: bring new transcripts in without being asked. */
  autoImport: z.boolean().default(false),
});
export type FirefliesSettings = z.infer<typeof firefliesSettingsSchema>;
export const DEFAULT_FIREFLIES_SETTINGS: FirefliesSettings = {
  rangeDays: 30,
  importProviderSummary: true,
  autoImport: false,
};

/** One meeting in the list the owner picks from. */
export interface ImportableRecording {
  /** The service's own id (Zoom's meeting UUID, Fireflies' transcript id). */
  remoteId: string;
  title: string;
  startedAt: number;
  /** Milliseconds; null when the service does not say. */
  durationMs: number | null;
  /** Zoom lists recordings that may have no transcript file. */
  hasTranscript: boolean;
  /** Already imported: it will be shown as a duplicate. */
  imported: boolean;
}

export type RecordingsResult =
  { ok: true; recordings: ImportableRecording[] } | { ok: false; message: string };

/** The label on a summary that came from Fireflies rather than from Murmur's own model. */
export const PROVIDER_SUMMARY = {
  skillId: "fireflies",
  skillName: "Fireflies summary (imported)",
  modelId: "fireflies",
} as const;
