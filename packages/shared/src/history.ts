import { z } from "zod";

/**
 * The History page (HB-35): every dictation, with full-text search over the final and raw
 * text, filters, archive, delete and local feedback. Nothing here is ever sent anywhere.
 */

/** What a row's outcome is shown as. */
export const HISTORY_STATUSES = ["done", "failed", "interrupted", "empty", "cancelled"] as const;
export type HistoryStatus = (typeof HISTORY_STATUSES)[number];

export const HISTORY_STATUS_LABELS: Record<HistoryStatus, string> = {
  done: "Done",
  failed: "Failed",
  interrupted: "Interrupted",
  empty: "Nothing heard",
  cancelled: "Cancelled",
};

export const HISTORY_LIMITS = {
  pageSize: 100,
  /** Rows deleted or archived in one go. */
  batch: 500,
  query: 200,
  feedbackNote: 300,
} as const;

export const historyQuerySchema = z.strictObject({
  /** Words to find in the final or raw text; empty lists everything. */
  text: z.string().max(HISTORY_LIMITS.query).default(""),
  /** Epoch ms, inclusive. */
  from: z.number().int().nullable().default(null),
  /** Epoch ms, exclusive. */
  to: z.number().int().nullable().default(null),
  /** An app's bundle id. */
  app: z.string().max(255).nullable().default(null),
  status: z.enum(HISTORY_STATUSES).nullable().default(null),
  language: z.string().max(20).nullable().default(null),
  /** False: hide archived rows (the default view). True: only archived rows. */
  archived: z.boolean().default(false),
  offset: z.number().int().min(0).default(0),
});
export type HistoryQuery = z.input<typeof historyQuerySchema>;

export const historyRowSchema = z.strictObject({
  id: z.string(),
  createdAt: z.number(),
  appName: z.string().nullable(),
  appBundleId: z.string().nullable(),
  status: z.enum(HISTORY_STATUSES),
  language: z.string().nullable(),
  durationMs: z.number(),
  wordCount: z.number(),
  rawText: z.string().nullable(),
  finalText: z.string().nullable(),
  archived: z.boolean(),
  feedback: z.enum(["good", "bad"]).nullable(),
  feedbackNote: z.string().nullable(),
  /** Whether a recording is still kept on disk. */
  hasAudio: z.boolean(),
});
export type HistoryRow = z.infer<typeof historyRowSchema>;

export const historyPageSchema = z.strictObject({
  rows: z.array(historyRowSchema),
  /** Rows matching the query in all. */
  total: z.number(),
  /** Apps and languages that appear in history, for the filters. */
  apps: z.array(z.strictObject({ bundleId: z.string(), name: z.string() })),
  languages: z.array(z.string()),
});
export type HistoryPage = z.infer<typeof historyPageSchema>;

export const historyIdsSchema = z.array(z.string().min(1).max(64)).min(1).max(HISTORY_LIMITS.batch);

export const historyFeedbackSchema = z.strictObject({
  id: z.string().min(1).max(64),
  feedback: z.enum(["good", "bad"]).nullable(),
  note: z.string().trim().max(HISTORY_LIMITS.feedbackNote).nullable(),
});
export type HistoryFeedback = z.infer<typeof historyFeedbackSchema>;

/** Rows and audio files removed by a delete. */
export const historyDeleteResultSchema = z.strictObject({
  rows: z.number(),
  files: z.number(),
});
export type HistoryDeleteResult = z.infer<typeof historyDeleteResultSchema>;

/**
 * An FTS5 query for typed words: each word as a quoted prefix, all required. Quotes are
 * doubled, so nothing typed can change the query's syntax. Null when nothing is left.
 */
export function historyMatchQuery(text: string): string | null {
  const words = text
    .split(/[\s"]+/)
    .map((word) => word.replace(/[^\p{L}\p{M}\p{N}'_-]/gu, ""))
    .filter((word) => word.length > 0)
    .slice(0, 20);
  if (words.length === 0) return null;
  return words.map((word) => `"${word.replace(/"/g, '""')}"*`).join(" ");
}
