import { z } from "zod";
import { audioDeviceSchema } from "./audio";
import { jargonPacksSchema } from "./developer";
import { emailSettingsSchema } from "./email";
import { hotkeyTriggerSchema, mouseButtonSchema } from "./hotkeys";

/**
 * User settings (DC-06, DC-09, DC-17, DC-28). Stored one key per row in the `settings`
 * table; the keys follow the data model's dotted names.
 */

export const SETTINGS_CLEANUP_LEVELS = ["off", "light", "standard", "full"] as const;

/**
 * Languages the user can choose (DC-17, DC-19). No choice means the language is detected.
 * `hi-Latn` is a profile, not a separate model: Hindi or English, written in Latin letters.
 */
export const SPEECH_LANGUAGES = [
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
  { code: "hi-Latn", label: "Mixed: Hindi in Latin script" },
] as const;
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number]["code"];
const languageCodes = SPEECH_LANGUAGES.map((language) => language.code) as [
  SpeechLanguage,
  ...SpeechLanguage[],
];

/** At most this many languages; the first is the primary (DC-19). */
export const MAX_LANGUAGES = 5;

/** Makes `code` the primary language, keeping the others in order and at most five. */
export function makePrimary<T extends string>(list: readonly T[], code: T): T[] {
  return [code, ...list.filter((item) => item !== code)].slice(0, MAX_LANGUAGES);
}

export function languageLabel(code: string): string {
  return SPEECH_LANGUAGES.find((language) => language.code === code)?.label ?? code;
}

export const settingsSchema = z.strictObject({
  /** Hold to dictate. */
  holdShortcut: hotkeyTriggerSchema,
  /** Toggles hands-free. Null means a double tap of the hold key. */
  handsFreeShortcut: hotkeyTriggerSchema.nullable(),
  /** Extra mouse buttons for push to talk and hands-free; null when unbound (DC-04). */
  mouseButtons: z
    .strictObject({ hold: mouseButtonSchema.nullable(), handsFree: mouseButtonSchema.nullable() })
    .refine(
      (buttons) => buttons.hold === null || buttons.hold !== buttons.handsFree,
      "One mouse button cannot do both",
    ),
  /** Suggest dictating after a lot of typing (DC-08). `snoozedUntil` is epoch ms. */
  typingReminder: z.strictObject({
    enabled: z.boolean(),
    snoozedUntil: z.number().int().nonnegative().nullable(),
  }),
  /** "auto" or a device id from the device list. */
  inputDevice: z.string().min(1).max(512),
  /** In order, primary first; empty means detect the language. */
  languages: z
    .array(z.enum(languageCodes))
    .max(MAX_LANGUAGES)
    .refine((list) => new Set(list).size === list.length, "Each language only once"),
  cleanupLevel: z.enum(SETTINGS_CLEANUP_LEVELS),
  /** Which feedback sounds play (DC-40). */
  sounds: z.strictObject({
    start: z.boolean(),
    lock: z.boolean(),
    success: z.boolean(),
    error: z.boolean(),
    cancel: z.boolean(),
  }),
  /** Experimental options, all off by default (HB-18). */
  experimental: z.strictObject({
    /** Split long dictations into messages at pauses (DC-37). */
    splitMessages: z.boolean(),
    /** Pause media while dictating and resume what Murmur paused (DC-42). */
    pauseMedia: z.boolean(),
    /** Switch microphones when a headset is put on or taken off (DC-14). */
    headsetWear: z.boolean(),
    /** A Bluetooth ring microphone (DC-15). */
    ringMicrophone: z.boolean(),
    /** Import dictionary entries and snippets from a file (PZ-07, PZ-10). */
    bulkImport: z.boolean(),
  }),
  /** Whisper mode (DC-12): more gain for very quiet speech. */
  whisperMode: z.boolean(),
  /** Memory (PZ-18, PZ-19): facts for the cleanup model, and "remember that" by voice. */
  memory: z.strictObject({ enabled: z.boolean(), fromDictation: z.boolean() }),
  /** Learn dictionary entries from corrections made after a dictation (PZ-02). */
  learnCorrections: z.boolean(),
  /** Voice Profile (PZ-15, PZ-16): learn, tell the cleanup model, and the weekly prompt. */
  voiceProfile: z.strictObject({
    enabled: z.boolean(),
    useInCleanup: z.boolean(),
    prompts: z.boolean(),
  }),
  /** Email signature and language (PZ-21, PZ-22), for the Email category only. */
  email: emailSettingsSchema,
  /** Developer jargon packs in the speech prompt for code editors and terminals (PZ-27). */
  jargonPacks: jargonPacksSchema,
  /** Mute the system output while recording (DC-41). */
  muteWhileDictating: z.boolean(),
  /** Read the focused field to help spell names and terms (DC-30). */
  contextAwareness: z.boolean(),
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
    languages: true,
    cleanupLevel: true,
    sounds: true,
    muteWhileDictating: true,
    setupComplete: true,
    pressEnterCommand: true,
    contextAwareness: true,
    mouseButtons: true,
    typingReminder: true,
    whisperMode: true,
    memory: true,
    learnCorrections: true,
    voiceProfile: true,
    email: true,
    jargonPacks: true,
    experimental: true,
  })
  .partial()
  .strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Storage key for each setting. */
export const SETTING_KEYS: Record<keyof Settings, string> = {
  holdShortcut: "hotkey.dictate_hold",
  handsFreeShortcut: "hotkey.hands_free",
  inputDevice: "audio.input_device",
  languages: "speech.languages",
  cleanupLevel: "cleanup.level",
  sounds: "sounds.events",
  muteWhileDictating: "media.mute_while_dictating",
  setupComplete: "onboarding.complete",
  pressEnterCommand: "press_enter.enabled",
  contextAwareness: "context.enabled",
  mouseButtons: "hotkey.mouse_buttons",
  typingReminder: "reminder.typing",
  whisperMode: "audio.whisper_mode",
  memory: "memory.flags",
  learnCorrections: "dictionary.learn_corrections",
  voiceProfile: "voice_profile.flags",
  email: "email.settings",
  jargonPacks: "developer.jargon_packs",
  experimental: "experimental.flags",
};

export const DEFAULT_EXPERIMENTAL: Settings["experimental"] = {
  splitMessages: false,
  pauseMedia: false,
  headsetWear: false,
  ringMicrophone: false,
  bulkImport: false,
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
