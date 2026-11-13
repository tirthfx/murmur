import { z } from "zod";

/**
 * Selected text and key presses, for Rewrites, Command Mode and Instruct Mode (RW-01, RW-09,
 * RW-13). The helper reads the selection through Accessibility, or copies it with Command+C
 * and puts the clipboard back when the app does not expose it. Nothing is kept.
 */

/** Longest selection read, in UTF-16 units (JavaScript string length). */
export const SELECTION_MAX_CHARS = 8000;

export const selectionReadPayloadSchema = z.object({
  /** Copy the selection when Accessibility gives no answer. Default true. */
  clipboardFallback: z.boolean().optional(),
  /** Bundle ids where the copy is used first, for apps whose Accessibility text is wrong. */
  clipboardFirstInApps: z.array(z.string()).max(200).optional(),
  /** How long to wait for the copy to land. Default 250 ms. */
  copyWaitMs: z.number().int().min(50).max(1000).optional(),
});
export type SelectionReadInput = z.infer<typeof selectionReadPayloadSchema>;

/**
 * - `ok`: `text` holds the selection.
 * - `empty`: nothing is selected (or the app gave nothing to copy).
 * - `too_long`: over the limit; `length` says how long, `text` is empty.
 * - `secure`: a password field; nothing was read.
 * - `unavailable`: no focused element, and copying was off or failed.
 */
export const SELECTION_STATUSES = ["ok", "empty", "too_long", "secure", "unavailable"] as const;
export type SelectionStatus = (typeof SELECTION_STATUSES)[number];

export const selectionRangeSchema = z.object({
  /** UTF-16 offset of the selection in the field. */
  location: z.number().int().min(0),
  length: z.number().int().min(0),
});

export const selectionResultSchema = z.object({
  status: z.enum(SELECTION_STATUSES),
  text: z.string().max(SELECTION_MAX_CHARS),
  /** UTF-16 length of the selection; known for `too_long` even though no text is sent. */
  length: z.number().int().min(0),
  /** Only when Accessibility gave it. Null for a copied selection. */
  range: selectionRangeSchema.nullable(),
  /** SHA-256 of the UTF-8 text, lower-case hex. Empty unless `ok`. */
  hash: z.string().regex(/^([0-9a-f]{64})?$/),
  /** Where the text came from; null when nothing was read. */
  source: z.enum(["ax", "clipboard"]).nullable(),
  appBundleId: z.string().nullable(),
});
export type SelectionResult = z.infer<typeof selectionResultSchema>;

/**
 * Keys Murmur may press in another app. Anything not here is refused by the helper, so a
 * bug in main cannot type arbitrary input.
 */
export const PRESS_KEYS = [
  "b",
  "i",
  "a",
  "z",
  "return",
  "left",
  "right",
  "up",
  "down",
  "left_bracket",
  "delete",
] as const;
export type PressKey = (typeof PRESS_KEYS)[number];

export const PRESS_MODIFIERS = ["command", "shift", "option", "control"] as const;
export type PressModifier = (typeof PRESS_MODIFIERS)[number];

export const keysPressPayloadSchema = z
  .object({
    key: z.enum(PRESS_KEYS),
    modifiers: z.array(z.enum(PRESS_MODIFIERS)).max(4),
    /** Press only if this app is in front; otherwise nothing is sent. */
    onlyInApp: z.string().optional(),
    /** Times to press, for moving the caret. Default 1. */
    repeat: z.number().int().min(1).max(200).optional(),
  })
  .refine((input) => keyComboAllowed(input.key, input.modifiers), {
    message: "This key combination is not allowed",
    path: ["modifiers"],
  });
export type KeysPressInput = z.infer<typeof keysPressPayloadSchema>;

export const keysPressResultSchema = z.object({
  /** False when `onlyInApp` was not in front, so nothing was sent. */
  pressed: z.boolean(),
  appBundleId: z.string().nullable(),
});
export type KeysPressResult = z.infer<typeof keysPressResultSchema>;

/** The combinations the helper accepts, as `modifiers+key` with modifiers in list order. */
export function keyComboAllowed(key: PressKey, modifiers: readonly PressModifier[]): boolean {
  const set = new Set(modifiers);
  if (set.size !== modifiers.length) return false;
  const has = (m: PressModifier) => set.has(m);
  switch (key) {
    case "b":
    case "i":
    case "a":
    case "left_bracket":
      return set.size === 1 && has("command");
    case "z":
      return has("command") && !has("option") && !has("control");
    case "return":
      return set.size === 0 || (set.size === 1 && has("shift"));
    case "delete":
      return set.size === 0;
    default:
      // Arrows move the caret or extend the selection.
      return !has("control");
  }
}
