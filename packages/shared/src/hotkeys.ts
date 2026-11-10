import { z } from "zod";

/**
 * Hotkey bindings and events, shared by main and the platform helper. A trigger carries
 * the platform's own key code; which code means which key is the platform's business,
 * so default bindings live with each platform, not here.
 *
 * These schemas check shape only. Rules that depend on the platform (a plain key needs a
 * modifier, two bindings may not share a trigger) are applied by the helper, which
 * rejects each bad binding on its own.
 */

export const HOTKEY_MODES = ["hold", "toggle", "press"] as const;
export type HotkeyMode = (typeof HOTKEY_MODES)[number];

export const HOTKEY_MODIFIERS = ["command", "option", "control", "shift", "fn"] as const;
export type HotkeyModifier = (typeof HOTKEY_MODIFIERS)[number];

/** Actions a binding may name. Main gives them meaning; the helper only passes them on. */
export const HOTKEY_ACTIONS = [
  "dictate.hold",
  "dictate.toggle",
  "dictate.cancel",
  "paste.last",
  "copy.last",
  "scratchpad.open",
  "notetaker.start",
  "command.mode",
  "instruct.mode",
  "rewrite",
  "press.enter",
] as const;
export type HotkeyAction = (typeof HOTKEY_ACTIONS)[number];

export const MAX_HOTKEY_BINDINGS = 64;

export const hotkeyTriggerSchema = z.object({
  type: z.literal("key"),
  /** Platform key code. A modifier key on its own has no modifiers. */
  keyCode: z.number().int().min(0).max(127),
  modifiers: z
    .array(z.enum(HOTKEY_MODIFIERS))
    .max(HOTKEY_MODIFIERS.length)
    .refine((list) => new Set(list).size === list.length, "modifiers must be distinct"),
});
export type HotkeyTrigger = z.infer<typeof hotkeyTriggerSchema>;

export const hotkeyBindingSchema = z.object({
  id: z.string().min(1).max(64),
  action: z.enum(HOTKEY_ACTIONS),
  trigger: hotkeyTriggerSchema,
  mode: z.enum(HOTKEY_MODES),
  /** Required by the helper when the action is `rewrite`. */
  rewriteId: z.string().min(1).optional(),
});
export type HotkeyBinding = z.infer<typeof hotkeyBindingSchema>;

/** `hotkey.configure` replaces every binding. An empty list stops the key listener. */
export const hotkeyConfigurePayloadSchema = z.object({
  bindings: z.array(hotkeyBindingSchema).max(MAX_HOTKEY_BINDINGS),
});

export const hotkeyRejectionSchema = z.object({
  id: z.string(),
  code: z.string().min(1),
  message: z.string(),
});
export type HotkeyRejection = z.infer<typeof hotkeyRejectionSchema>;

export const hotkeyConfigureResultSchema = z.object({
  registered: z.array(z.string()),
  rejected: z.array(hotkeyRejectionSchema),
});
export type HotkeyConfigureResult = z.infer<typeof hotkeyConfigureResultSchema>;

/** `down` and `up` for hold bindings, `press` for the others. */
export const HOTKEY_EVENT_STATES = ["down", "up", "press"] as const;

export const hotkeyEventPayloadSchema = z.object({
  bindingId: z.string().min(1),
  action: z.enum(HOTKEY_ACTIONS),
  state: z.enum(HOTKEY_EVENT_STATES),
  /** When the key changed, in epoch milliseconds. */
  at: z.number().int().nonnegative(),
  rewriteId: z.string().min(1).optional(),
});
export type HotkeyEvent = z.infer<typeof hotkeyEventPayloadSchema>;

/**
 * `disabled_by_system`: the OS turned the key listener off (for example after a slow
 * callback); held keys were released. `reenabled`: the helper turned it back on.
 */
export const HOTKEY_TAP_STATES = ["active", "disabled_by_system", "reenabled"] as const;

export const hotkeyTapStatusPayloadSchema = z.object({
  state: z.enum(HOTKEY_TAP_STATES),
});
export type HotkeyTapStatus = z.infer<typeof hotkeyTapStatusPayloadSchema>;
