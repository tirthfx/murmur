import { z } from "zod";
import { richDocSchema } from "./snippets";

/**
 * Scratchpad (HB-26, HB-31, HB-34): notes for free writing, kept only on this Mac. The body
 * uses the snippet editor's document model; the plain text is kept beside it for search.
 */

export const NOTE_LIMITS = {
  /** HB-26: of plain text. */
  bodyBytes: 500 * 1024,
  title: 200,
  tabs: 8,
  autosaveMs: 2000,
  searchDelayMs: 150,
  results: 200,
  /** HB-28. */
  versions: 50,
  versionEveryMs: 5 * 60_000,
  versionLabel: 60,
  /** HB-29. */
  pins: 20,
} as const;

export const noteSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  body: richDocSchema,
  plain: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  pinned: z.boolean(),
});
export type Note = z.infer<typeof noteSchema>;

/** A piece of a preview; `hit` marks a word that matched the search. */
export const previewPartSchema = z.strictObject({ text: z.string(), hit: z.boolean() });

export const noteSummarySchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  /** The first line, or the matching words when searching. */
  preview: z.array(previewPartSchema),
  updatedAt: z.number(),
  pinned: z.boolean(),
});
export type NoteSummary = z.infer<typeof noteSummarySchema>;

export const noteSaveSchema = z.strictObject({
  id: z.string().min(1).max(64),
  title: z.string().max(NOTE_LIMITS.title),
  body: richDocSchema,
});
export type NoteSave = z.infer<typeof noteSaveSchema>;

export const noteSaveResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), updatedAt: z.number() }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type NoteSaveResult = z.infer<typeof noteSaveResultSchema>;

export const noteCreateSchema = z.strictObject({
  /** Start the note with the last dictation's text (HB-26). */
  fromLastDictation: z.boolean(),
});
export type NoteCreate = z.infer<typeof noteCreateSchema>;

export const noteVersionSchema = z.strictObject({
  id: z.string(),
  noteId: z.string(),
  label: z.string().nullable(),
  words: z.number(),
  createdAt: z.number(),
});
export type NoteVersion = z.infer<typeof noteVersionSchema>;

/** A version's text, for Compare. */
export const noteVersionTextSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  plain: z.string(),
  createdAt: z.number(),
});
export type NoteVersionText = z.infer<typeof noteVersionTextSchema>;

export const noteVersionSaveSchema = z.strictObject({
  noteId: z.string().min(1).max(64),
  label: z.string().trim().max(NOTE_LIMITS.versionLabel).nullable(),
  /** Why it is saved: by the user, when the note is closed, or on the 5-minute rule. */
  reason: z.enum(["manual", "close", "auto"]),
});
export type NoteVersionSave = z.infer<typeof noteVersionSaveSchema>;

export const notePinResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type NotePinResult = z.infer<typeof notePinResultSchema>;

/** Words in plain text. */
export function wordCount(plain: string): number {
  return plain.split(/\s+/).filter(Boolean).length;
}

export const NOTE_MESSAGES = {
  tooBig: "This note is too long to save. Notes hold up to 500 KB of text.",
  noDictation: "There is no dictation to start a note from yet.",
  missing: "This note is no longer there.",
  pins: `At most ${NOTE_LIMITS.pins} notes can be pinned. Unpin one first.`,
} as const;

/** The title shown for a note: its own, or its first line, or "Untitled". */
export function noteTitle(title: string, plain: string): string {
  const own = title.trim();
  if (own) return own.slice(0, NOTE_LIMITS.title);
  const first =
    plain
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? "";
  return first ? first.slice(0, 80) : "Untitled";
}

/** Bytes of UTF-8 text. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Splits FTS5 snippet text marked with \u0001 (start) and \u0002 (end) into parts. The marks
 * are control characters that typed text cannot contain once it is stored.
 */
export function markedParts(text: string): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  for (const piece of text.split("\u0001")) {
    const end = piece.indexOf("\u0002");
    if (end === -1) {
      if (piece) parts.push({ text: piece, hit: false });
      continue;
    }
    if (end > 0) parts.push({ text: piece.slice(0, end), hit: true });
    const rest = piece.slice(end + 1);
    if (rest) parts.push({ text: rest, hit: false });
  }
  return parts;
}
