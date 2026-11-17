import { z } from "zod";

/**
 * Focus Mode (RW-18, RW-19, RW-21): blocks chosen apps for a while. The helper reports the
 * app in front only while main has asked it to; main compares it with the blocked list and
 * shows the overlay. Apps are never quit.
 */

// ------------------------------------------------------------------ helper messages

export const focusWatchPayloadSchema = z.object({ enabled: z.boolean() });
export const focusWatchResultSchema = z.object({ watching: z.boolean() });

/** The app in front, sent when it changes (and once when watching starts). */
export const frontAppPayloadSchema = z.object({
  bundleId: z.string().max(255).nullable(),
  name: z.string().max(200).nullable(),
  pid: z.number().int().nullable(),
});
export type FrontApp = z.infer<typeof frontAppPayloadSchema>;

export const installedAppSchema = z.object({
  bundleId: z.string().min(1).max(255),
  name: z.string().min(1).max(200),
});
export type InstalledApp = z.infer<typeof installedAppSchema>;
export const appsListResultSchema = z.object({ apps: z.array(installedAppSchema).max(5000) });

// ------------------------------------------------------------------ settings and state

/** Minutes, or until turned off. */
export const FOCUS_DURATIONS = [25, 50, 90, "untilOff"] as const;
export const focusDurationSchema = z.union([
  z.literal(25),
  z.literal(50),
  z.literal(90),
  z.literal("untilOff"),
]);
export type FocusDuration = z.infer<typeof focusDurationSchema>;

export const FOCUS_DURATION_LABELS: Record<string, string> = {
  "25": "25 minutes",
  "50": "50 minutes",
  "90": "90 minutes",
  untilOff: "Until turned off",
};

export function focusDurationLabel(duration: FocusDuration): string {
  return FOCUS_DURATION_LABELS[String(duration)] ?? String(duration);
}

export const FOCUS_LIMITS = {
  /** RW-19. */
  apps: 100,
  /** RW-21: Pause Focus for 10 minutes. */
  pauseMs: 10 * 60_000,
} as const;

export const FOCUS_END_REASONS = ["timer", "user", "quit", "paused"] as const;
export type FocusEndReason = (typeof FOCUS_END_REASONS)[number];

export const focusStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("off") }),
  z.strictObject({
    status: z.literal("on"),
    /** Epoch ms when it ends; null until turned off. */
    endsAt: z.number().nullable(),
  }),
  z.strictObject({
    status: z.literal("paused"),
    resumeAt: z.number(),
    /** Time left when paused; null for until turned off. */
    remainingMs: z.number().nullable(),
  }),
]);
export type FocusState = z.infer<typeof focusStateSchema>;

export const focusRuleSchema = z.strictObject({
  id: z.string(),
  kind: z.literal("app"),
  /** The app's bundle id. */
  value: z.string(),
  label: z.string(),
  createdAt: z.number(),
});
export type FocusRule = z.infer<typeof focusRuleSchema>;

export const focusAppInputSchema = z.strictObject({
  bundleId: z
    .string()
    .trim()
    .min(3)
    .max(255)
    .regex(/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, "Use an app's bundle id, like com.example.App"),
  label: z.string().trim().min(1).max(200),
});
export type FocusAppInput = z.infer<typeof focusAppInputSchema>;

export const focusAddResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), rule: focusRuleSchema }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type FocusAddResult = z.infer<typeof focusAddResultSchema>;

export const FOCUS_MESSAGES = {
  ended: "Focus ended",
  paused: "Focus paused for 10 minutes",
  resumed: "Focus is back on",
  limit: `At most ${FOCUS_LIMITS.apps} blocked apps.`,
  duplicate: "That app is already blocked.",
  self: "Murmur cannot block itself.",
  off: "Turn on Focus Mode in Experimental first.",
} as const;

/** "Focus is on. Safari is blocked." */
export function focusBlockedText(name: string): string {
  return `Focus is on. ${name} is blocked.`;
}

/** m:ss or h:mm:ss left. */
export function focusTimeLeft(endsAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

// ------------------------------------------------------------------ the overlay page

export const FOCUS_OVERLAY_CHANNELS = {
  ready: "focus-overlay:ready",
  goBack: "focus-overlay:go-back",
  pause: "focus-overlay:pause",
  turnOff: "focus-overlay:turn-off",
} as const;

export const FOCUS_OVERLAY_PUSH = { state: "focus-overlay:state" } as const;

export const FOCUS_OVERLAY_ARGS = {
  [FOCUS_OVERLAY_CHANNELS.ready]: z.tuple([]),
  [FOCUS_OVERLAY_CHANNELS.goBack]: z.tuple([]),
  [FOCUS_OVERLAY_CHANNELS.pause]: z.tuple([]),
  [FOCUS_OVERLAY_CHANNELS.turnOff]: z.tuple([]),
} as const;

/** What the overlay shows: hidden, or the blocked item's name. */
export type FocusOverlayState = { stage: "hidden" } | { stage: "blocked"; name: string };

/** What the overlay preload exposes as `window.murmurFocus`. */
export interface MurmurFocusApi {
  ready(): Promise<FocusOverlayState>;
  onState(handler: (state: FocusOverlayState) => void): () => void;
  goBack(): Promise<void>;
  pause(): Promise<void>;
  turnOff(): Promise<void>;
}
