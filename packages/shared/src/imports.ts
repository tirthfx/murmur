import { z } from "zod";

// Bulk import (PZ-07, PZ-10): dictionary entries and snippets from a file. The Hub reads the
// file and sends its text; main parses, previews and writes everything in one transaction.

export const IMPORT_KINDS = ["dictionary", "snippets"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_LIMITS: Record<ImportKind, { bytes: number; rows: number }> = {
  dictionary: { bytes: 1024 * 1024, rows: 5_000 },
  snippets: { bytes: 2 * 1024 * 1024, rows: 1_000 },
};

export const importRequestSchema = z.strictObject({
  kind: z.enum(IMPORT_KINDS),
  fileName: z.string().max(255),
  text: z.string().max(IMPORT_LIMITS.snippets.bytes),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

const lineNote = z.strictObject({ line: z.number().int().min(1), text: z.string() });

export const importPreviewSchema = z.strictObject({
  kind: z.enum(IMPORT_KINDS),
  /** Rows that would be added. */
  added: z.number().int().min(0),
  /** The first rows to be added, for a look before confirming. */
  sample: z.array(lineNote),
  duplicates: z.array(lineNote),
  invalid: z.array(lineNote),
  /** Why nothing can be imported (file too big, too many rows, store full), or null. */
  blocked: z.string().nullable(),
});
export type ImportPreview = z.infer<typeof importPreviewSchema>;

export const importResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), added: z.number().int().min(0) }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type ImportResult = z.infer<typeof importResultSchema>;
