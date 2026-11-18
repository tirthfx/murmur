import { z } from "zod";

/**
 * Data and Privacy (HB-21, HB-48 to HB-50, HB-52). The presets are not stored: the page
 * works out which one the switches match, and shows Custom otherwise.
 */

export const AUDIO_KEEP = ["24h", "never", "keep"] as const;
export type AudioKeep = (typeof AUDIO_KEEP)[number];

/** Days dictation text is kept; null keeps it. */
export const HISTORY_DAYS = [null, 365, 30, 7] as const;

export const privacySettingsSchema = z.strictObject({
  /** Write dictations to History at all (counts for Insights are kept either way). */
  storeHistory: z.boolean(),
  /** Successful dictations' recordings: a day, not at all, or until deleted. */
  audio: z.enum(AUDIO_KEEP),
  /** Dictation text older than this many days is deleted; null keeps it. */
  historyDays: z.union([z.null(), z.literal(365), z.literal(30), z.literal(7)]),
  /** HB-52: no network at all, recordings gone at once, no learning. */
  strictLocal: z.boolean(),
});
export type PrivacySettings = z.infer<typeof privacySettingsSchema>;

export const DEFAULT_PRIVACY: PrivacySettings = {
  storeHistory: true,
  audio: "24h",
  historyDays: null,
  strictLocal: false,
};

export const PRIVACY_PRESETS = ["balanced", "minimal", "full"] as const;
export type PrivacyPreset = (typeof PRIVACY_PRESETS)[number];

/** The switches a preset sets. */
export interface PrivacySwitches {
  privacy: Omit<PrivacySettings, "strictLocal">;
  contextAwareness: boolean;
  learnCorrections: boolean;
  voiceProfile: boolean;
}

export const PRESET_SWITCHES: Record<PrivacyPreset, PrivacySwitches> = {
  balanced: {
    privacy: { storeHistory: true, audio: "24h", historyDays: null },
    contextAwareness: true,
    learnCorrections: true,
    voiceProfile: true,
  },
  minimal: {
    privacy: { storeHistory: true, audio: "never", historyDays: 7 },
    contextAwareness: true,
    learnCorrections: false,
    voiceProfile: false,
  },
  full: {
    privacy: { storeHistory: true, audio: "keep", historyDays: null },
    contextAwareness: true,
    learnCorrections: true,
    voiceProfile: true,
  },
};

export const PRESET_LABELS: Record<PrivacyPreset | "custom", string> = {
  balanced: "Balanced",
  minimal: "Minimal",
  full: "Full",
  custom: "Custom",
};

/** Which preset the switches match, or "custom". */
export function presetOf(current: PrivacySwitches): PrivacyPreset | "custom" {
  for (const preset of PRIVACY_PRESETS) {
    const want = PRESET_SWITCHES[preset];
    if (
      want.privacy.storeHistory === current.privacy.storeHistory &&
      want.privacy.audio === current.privacy.audio &&
      want.privacy.historyDays === current.privacy.historyDays &&
      want.contextAwareness === current.contextAwareness &&
      want.learnCorrections === current.learnCorrections &&
      want.voiceProfile === current.voiceProfile
    ) {
      return preset;
    }
  }
  return "custom";
}

/** HB-21: what leaves this Mac, worked out from the settings. */
export function privacyStatement(strictLocal: boolean): { headline: string; details: string[] } {
  return strictLocal
    ? {
        headline: "Nothing leaves this Mac.",
        details: [
          "Strict local mode is on: Murmur makes no network connection at all, not even to download a model.",
        ],
      }
    : {
        headline: "Nothing leaves this Mac.",
        details: [
          "The one exception is a model download that you start, during setup or from Settings. It only fetches the model file.",
          "Dictation, cleanup, Rewrites, notes and everything you save stay on this Mac.",
        ],
      };
}

export const storageViewSchema = z.strictObject({
  folder: z.string(),
  parts: z.array(z.strictObject({ name: z.string(), bytes: z.number() })),
});
export type StorageView = z.infer<typeof storageViewSchema>;

export const retentionViewSchema = z.strictObject({
  lastRunAt: z.number().nullable(),
  nextRunAt: z.number().nullable(),
  /** What the last run removed, by kind. */
  removed: z.record(z.string(), z.number()),
});
export type RetentionView = z.infer<typeof retentionViewSchema>;

/** Thrown when strict local mode refuses a network use (HB-52). */
export const STRICT_LOCAL_MESSAGE =
  "Strict local mode is on, so Murmur makes no network connection. Turn it off in Data and Privacy to download.";
