// Undo of Murmur's own edits (RW-10, RW-13), without relying on the app's Command+Z: the text
// is put back only where the field still holds exactly what Murmur put there.

export const UNDO_LIMITS = {
  /** Command Mode: last 10 edits, each for 5 minutes. */
  command: { entries: 10, windowMs: 5 * 60_000 },
  /** Instruct Mode: last 20 inserts this run. */
  instruct: { entries: 20, windowMs: null },
} as const;

export type UndoKind = keyof typeof UNDO_LIMITS;

export const UNDO_MESSAGES = {
  undone: "Undone",
  changed: "Text changed since insert. Undo is not safe.",
  copied: "Undo is not possible in this field. The previous text was copied.",
  nothing: "Nothing to undo",
} as const;

export type UndoResult = keyof typeof UNDO_MESSAGES;
