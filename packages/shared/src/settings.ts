import { z } from "zod";
import { audioDeviceSchema } from "./audio";
import { hotkeyTriggerSchema } from "./hotkeys";

/**
 * User settings (DC-06, DC-09, DC-17, DC-28). Stored one key per row in the `settings`
 * table; the keys follow the data model's dotted names.
 */

export const SETTINGS_CLEANUP_LEVELS = ["off", "light", "standard", "full"] as const;

/** Languages offered for fixed-language mode. "auto" detects the language. */
export const SPEECH_LANGUAGES = [
  { code: "auto", label: "Detect automatically" },
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "mr", label: "Marathi" },
  { code: "gu", label: "Gujarati" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "bn", label: "Bengali" },
  { code: "ur", label: "Urdu" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "ru", label: "Russian" },
  { code: "ar", label: "Arabic" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
] as const;
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number]["code"];
const languageCodes = SPEECH_LANGUAGES.map((language) => language.code) as [
  SpeechLanguage,
  ...SpeechLanguage[],
];

export const settingsSchema = z.strictObject({
  /** Hold to dictate. */
  holdShortcut: hotkeyTriggerSchema,
  /** Toggles hands-free. Null means a double tap of the hold key. */
  handsFreeShortcut: hotkeyTriggerSchema.nullable(),
  /** "auto" or a device id from the device list. */
  inputDevice: z.string().min(1).max(512),
  language: z.enum(languageCodes),
  cleanupLevel: z.enum(SETTINGS_CLEANUP_LEVELS),
  /** Which feedback sounds play (DC-40). */
  sounds: z.strictObject({
    start: z.boolean(),
    lock: z.boolean(),
    success: z.boolean(),
    error: z.boolean(),
    cancel: z.boolean(),
  }),
  /** Mute the system output while recording (DC-41). */
  muteWhileDictating: z.boolean(),
  /** Saying "press enter" at the end of a dictation presses Return (DC-36). */
  pressEnterCommand: z.boolean(),
  /** True once first-run setup was finished (DC-44). */
  setupComplete: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Settings the Hub may change directly. Shortcuts go through the recorder and its checks. */
export const settingsPatchSchema = settingsSchema
  .pick({
    inputDevice: true,
    language: true,
    cleanupLevel: true,
    sounds: true,
    muteWhileDictating: true,
    setupComplete: true,
    pressEnterCommand: true,
  })
  .partial()
  .strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Storage key for each setting. */
export const SETTING_KEYS: Record<keyof Settings, string> = {
  holdShortcut: "hotkey.dictate_hold",
  handsFreeShortcut: "hotkey.hands_free",
  inputDevice: "audio.input_device",
  language: "speech.language",
  cleanupLevel: "cleanup.level",
  sounds: "sounds.events",
  muteWhileDictating: "media.mute_while_dictating",
  setupComplete: "onboarding.complete",
  pressEnterCommand: "press_enter.enabled",
};

export const SOUND_NAMES = ["start", "lock", "success", "error", "cancel"] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

/** DC-40 defaults: every sound on except cancel. */
export const DEFAULT_SOUNDS: Settings["sounds"] = {
  start: true,
  lock: true,
  success: true,
  error: true,
  cancel: false,
};

export const SHORTCUT_SLOTS = ["hold", "handsFree"] as const;
export type ShortcutSlot = (typeof SHORTCUT_SLOTS)[number];

/** A key the Hub captured: the browser's key code and the modifiers held. */
export const capturedKeySchema = z.strictObject({
  code: z.string().min(1).max(32),
  modifiers: z.array(z.enum(["command", "option", "control", "shift"])).max(4),
});
export type CapturedKey = z.infer<typeof capturedKeySchema>;

/** What the Settings page shows. */
export const settingsViewSchema = z.strictObject({
  settings: settingsSchema,
  /** Readable names: "Right Option", "Control+Option+Space". */
  shortcutLabels: z.strictObject({ hold: z.string(), handsFree: z.string() }),
  /** Null when the helper could not list devices. */
  devices: z.array(audioDeviceSchema).nullable(),
});
export type SettingsView = z.infer<typeof settingsViewSchema>;

export const shortcutResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), view: settingsViewSchema }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type ShortcutResult = z.infer<typeof shortcutResultSchema>;
