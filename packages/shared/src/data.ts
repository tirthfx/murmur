import { z } from "zod";

/** Export (HB-46) and delete by category (HB-47). */

export const EXPORT_CATEGORIES = [
  "dictations",
  "dictionary",
  "snippets",
  "stylesRewrites",
  "memory",
  "notes",
  "instruct",
  "insights",
  "meetings",
  "audio",
] as const;
export type ExportCategory = (typeof EXPORT_CATEGORIES)[number];

export const EXPORT_LABELS: Record<ExportCategory, string> = {
  dictations: "Dictations (final and raw text)",
  dictionary: "Dictionary (CSV)",
  snippets: "Snippets (Markdown)",
  stylesRewrites: "Styles and custom Rewrites (JSON)",
  memory: "Memory (JSON)",
  notes: "Scratchpad notes (Markdown, with images)",
  instruct: "Instruct threads (Markdown)",
  insights: "Insights (CSV)",
  meetings: "Meetings, tasks and contacts (JSON; no meeting audio)",
  audio: "Kept recordings (audio files)",
};

/** Ticked when the export opens: every text category, no audio. */
export const DEFAULT_EXPORT: ExportCategory[] = EXPORT_CATEGORIES.filter((c) => c !== "audio");

/** The format version of each category's files, written in the index so an import can read them. */
export const EXPORT_FORMAT_VERSION = 1;

export const exportRequestSchema = z.strictObject({
  categories: z.array(z.enum(EXPORT_CATEGORIES)).min(1).max(EXPORT_CATEGORIES.length),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;

/** Whether an export started; its progress and outcome are read with the status. */
export const exportResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), message: z.string(), canceled: z.boolean() }),
]);
export type ExportResult = z.infer<typeof exportResultSchema>;

/** The export that is running, or how the last one of this run ended (HB-46). */
export const exportStatusSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("idle") }),
  z.strictObject({
    state: z.literal("running"),
    /** Categories finished, of `total`. */
    done: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    /** The category being written. */
    category: z.enum(EXPORT_CATEGORIES),
  }),
  z.strictObject({
    state: z.literal("done"),
    folder: z.string(),
    counts: z.record(z.string(), z.number()),
  }),
  z.strictObject({ state: z.literal("failed"), message: z.string() }),
]);
export type ExportStatus = z.infer<typeof exportStatusSchema>;

export const DELETE_CATEGORIES = [
  "dictations",
  "audio",
  "dictionary",
  "snippets",
  "styles",
  "memory",
  "voiceProfile",
  "notes",
  "instruct",
  "insights",
  "learnedCandidates",
  "meetings",
] as const;
export type DeleteCategory = (typeof DELETE_CATEGORIES)[number];

export const DELETE_LABELS: Record<DeleteCategory, string> = {
  dictations: "Dictations, with Rewrite and command runs",
  audio: "Recordings",
  dictionary: "Dictionary",
  snippets: "Snippets",
  styles: "Styles, app overrides and writing samples",
  memory: "Memory",
  voiceProfile: "Voice Profile",
  notes: "Scratchpad notes and images",
  instruct: "Instruct threads",
  insights: "Insights and milestones",
  learnedCandidates: "Learned word suggestions",
  meetings: "Meetings and their recordings",
};

export const dataCountsSchema = z.strictObject({
  categories: z.array(
    z.strictObject({
      category: z.enum(DELETE_CATEGORIES),
      count: z.number(),
      bytes: z.number(),
    }),
  ),
  /** Files a delete could not remove, waiting for a retry. */
  failedFiles: z.number(),
});
export type DataCounts = z.infer<typeof dataCountsSchema>;

export const deleteResultSchema = z.strictObject({
  rows: z.number(),
  files: z.number(),
  failedFiles: z.number(),
});
export type DeleteResult = z.infer<typeof deleteResultSchema>;

export const resetRequestSchema = z.strictObject({ includeModels: z.boolean() });
export type ResetRequest = z.infer<typeof resetRequestSchema>;

/** A CSV cell: quoted when it holds a comma, quote or line break. */
export function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
