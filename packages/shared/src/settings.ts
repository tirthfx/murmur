import { z } from "zod";
import { APP_LANGUAGES } from "./catalogue";
import { privacySettingsSchema } from "./privacy";
import { developerSettingsSchema } from "./testing";
import { helpSettingsSchema, referralSettingsSchema } from "./help";
import { connectorSettingsSchema } from "./connectors";
import { extensionsSettingsSchema } from "./extensions";
import { mcpSettingsSchema } from "./mcp";
import { notetakerSettingsSchema } from "./meetings";
import { audioDeviceSchema } from "./audio";
import { developerToolsSchema, jargonPacksSchema } from "./developer";
import { emailSettingsSchema } from "./email";
import { focusDurationSchema } from "./focus";
import { hotkeyTriggerSchema, mouseButtonSchema } from "./hotkeys";
import { planStateSchema, planTierSchema } from "./plans";
import { languageCodes, SPEECH_LANGUAGES } from "./languages";

export {
  MEETING_LANGUAGES,
  meetingLanguageCodes,
  SPEECH_LANGUAGES,
  type SpeechLanguage,
} from "./languages";

/**
 * User settings (DC-06, DC-09, DC-17, DC-28). Stored one key per row in the `settings`
 * table; the keys follow the data model's dotted names.
 */

export const SETTINGS_CLEANUP_LEVELS = ["off", "light", "standard", "full"] as const;

/** At most this many languages; the first is the primary (DC-19). */
export const MAX_LANGUAGES = 5;

/** Makes `code` the primary language, keeping the others in order and at most five. */
export function makePrimary<T extends string>(list: readonly T[], code: T): T[] {
  return [code, ...list.filter((item) => item !== code)].slice(0, MAX_LANGUAGES);
}

export function languageLabel(code: string): string {
  return SPEECH_LANGUAGES.find((language) => language.code === code)?.label ?? code;
}

/** A wake phrase is two to forty characters. */
export const COMMAND_WAKE_PHRASE_LIMITS = { min: 2, max: 40 } as const;

export const INSERTION_METHODS = ["auto", "paste", "type"] as const;

export const SOUND_NAMES = ["start", "lock", "success", "error", "cancel", "milestone"] as const;
export type SoundName = (typeof SOUND_NAMES)[number];
/** DC-40: the sound sets. */
export const SOUND_SETS = ["subtle", "soft", "off"] as const;
export type SoundSet = (typeof SOUND_SETS)[number];

/** DC-21: the default length cap on one recording, and its range, in minutes. */
export const SESSION_LIMIT_DEFAULT = 20;
export const SESSION_LIMIT_MIN = 5;
export const SESSION_LIMIT_MAX = 30;

export const settingsSchema = z.strictObject({
  /** Hold to dictate. */
  holdShortcut: hotkeyTriggerSchema,
  /** Toggles hands-free. Null means a double tap of the hold key. */
  handsFreeShortcut: hotkeyTriggerSchema.nullable(),
  /** Opens the Rewrite panel on the selection (RW-01). Null turns it off. */
  rewriteShortcut: hotkeyTriggerSchema.nullable(),
  /**
   * Hold to speak a command (RW-08), while Command Mode is on. It counts only when no other
   * key is pressed during the hold, so Command shortcuts never start it. Null turns it off.
   */
  commandShortcut: hotkeyTriggerSchema.nullable(),
  /** Hold to say what to write in Instruct Mode (RW-11). Null turns it off. */
  instructShortcut: hotkeyTriggerSchema.nullable(),
  /** Turns Focus Mode on or off (RW-18), while Focus Mode is on in Experimental. */
  focusShortcut: hotkeyTriggerSchema.nullable(),
  /** Focus Mode (RW-18): the last duration chosen, used by the shortcut. */
  focus: z.strictObject({ duration: focusDurationSchema }),
  /** Context Instruct Mode may use (RW-11, RW-17). Style and the selection are always offered. */
  instruct: z.strictObject({
    /** Text of the focused field around the caret. */
    fieldContext: z.boolean(),
    memory: z.boolean(),
    samples: z.boolean(),
    /** Keep threads for 30 days on the Instruct page (RW-14). */
    saveThreads: z.boolean(),
    /** The model for new threads (RW-15). Quality is used only once it is downloaded. */
    model: z.enum(["fast", "quality"]),
  }),
  /** Command Mode's wake phrase (RW-08). Command Mode itself is an experimental option. */
  commandMode: z.strictObject({
    wakePhrase: z
      .string()
      .trim()
      .min(COMMAND_WAKE_PHRASE_LIMITS.min)
      .max(COMMAND_WAKE_PHRASE_LIMITS.max)
      .regex(/^[\p{L}\p{N}' ,-]+$/u, "Letters, numbers and spaces only"),
    wakePhraseEnabled: z.boolean(),
  }),
  /** Extra mouse buttons and what each does; null when unbound (DC-04). */
  mouseButtons: z
    .strictObject({
      hold: mouseButtonSchema.nullable(),
      handsFree: mouseButtonSchema.nullable(),
      // Absent in values saved before these existed.
      pressEnter: mouseButtonSchema.nullable().default(null),
      copyLast: mouseButtonSchema.nullable().default(null),
    })
    .refine((buttons) => {
      const used = Object.values(buttons).filter((button) => button !== null);
      return new Set(used).size === used.length;
    }, "One mouse button cannot do two things"),
  /** Suggest dictating after a lot of typing (DC-08). `snoozedUntil` is epoch ms. */
  typingReminder: z.strictObject({
    enabled: z.boolean(),
    snoozedUntil: z.number().int().nonnegative().nullable(),
  }),
  /**
   * DC-17: offer to add a language that is spoken and not chosen. `snoozed` holds, per
   * language, when it may be offered again after "Not now" (epoch ms).
   */
  languagePrompt: z.strictObject({
    enabled: z.boolean(),
    snoozed: z.record(z.string(), z.number().int().nonnegative()),
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
    milestone: z.boolean().default(true),
    /** Which tones play: the usual ones, softer and lower ones, or none at all. */
    set: z.enum(SOUND_SETS).default("subtle"),
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
    /** Learn names of two to four words said often (PZ-05). */
    phraseLearning: z.boolean(),
    /** Set the category from the field's content (PZ-14). */
    styleDetection: z.boolean(),
    /** Record a pronunciation clip for a dictionary entry (PZ-06). */
    pronunciationClips: z.boolean(),
    /** Speak commands that act on the selection or the last dictation (RW-08). */
    commandMode: z.boolean(),
    /** Offer Instruct Mode when a dictation starts like a request to write (RW-16). */
    autoInstruct: z.boolean(),
    /** Block chosen apps for a while (RW-18 to RW-21). */
    focusMode: z.boolean(),
    /** Ask can propose a connector action, shown first and run only on a click (CN-13). */
    askConnectorActions: z.boolean(),
    /** Turn @mentions into Slack tags in a message sent to Slack, listed first (CN-14). */
    slackTagging: z.boolean(),
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
  /** File tags, variable recognition and coding CLI detection (PZ-24, PZ-25, PZ-28). */
  developerTools: developerToolsSchema,
  /** Mute the system output while recording (DC-41). */
  muteWhileDictating: z.boolean(),
  /** Read the focused field to help spell names and terms (DC-30). */
  contextAwareness: z.boolean(),
  /** How long one recording may run before it stops by itself (DC-21). */
  sessionLimitMinutes: z.number().int().min(SESSION_LIMIT_MIN).max(SESSION_LIMIT_MAX),
  /** Numbers, times, money, addresses and links written the usual way (DC-29). */
  smartFormatting: z.boolean(),
  /** The floating Bar (DC-07, HB-17): shown at all, on every space, over full-screen apps. */
  bar: z.strictObject({
    visible: z.boolean(),
    allSpaces: z.boolean(),
    aboveFullScreen: z.boolean(),
  }),
  /** How text goes in (DC-31, DC-32, DC-34). */
  insertion: z.strictObject({
    method: z.enum(INSERTION_METHODS),
    /** Paste into remote desktops, for sessions that share the clipboard. Typed when off. */
    pasteInRemoteDesktops: z.boolean(),
    /** More apps to type into, by their id. */
    typeInApps: z.array(z.string().trim().min(1).max(255)).max(50),
    /** Apps of the built-in remote desktop list to paste into after all (DC-34). */
    pasteInApps: z.array(z.string().trim().min(1).max(255)).max(50).default([]),
  }),
  /** How loud the feedback sounds are, in percent (DC-40). */
  soundVolume: z.number().int().min(0).max(100),
  /** Warn when the microphone stays silent (DC-11). */
  silentWarning: z.boolean(),
  /** Saying "press enter" at the end of a dictation presses Return (DC-36). */
  pressEnterCommand: z.boolean(),
  /** DC-16, HB-16: the microphone list and what happens when the input goes away. */
  microphones: z.strictObject({
    showVirtual: z.boolean(),
    routeFallback: z.boolean(),
  }),
  /** HB-13: writing first. Scratchpad and Rewrites lead the Hub, and the menu drafts notes. */
  creatorMode: z.boolean(),
  /** The local plan tier (RW-22, TM-25): unlocks features for testing; nothing is charged. */
  plan: planTierSchema,
  /** True once first-run setup was finished (DC-44). */
  setupComplete: z.boolean(),
  /** Show the Hub when Murmur starts (HB-17); off starts in the menu bar only. */
  openHubOnLaunch: z.boolean(),
  /** Insights (HB-36): the typing speed that time saved is measured against. */
  insights: z.strictObject({ typingWpm: z.number().int().min(10).max(150) }),
  /** HB-26: opens the Scratchpad window. Null means no shortcut. */
  scratchpadShortcut: hotkeyTriggerSchema.nullable(),
  /** DC-39: copies the last transcript, and pastes it. Null means no shortcut. */
  copyLastShortcut: hotkeyTriggerSchema.nullable(),
  pasteLastShortcut: hotkeyTriggerSchema.nullable(),
  /** DC-06: presses Return in the app in front. Null means no shortcut. */
  pressEnterShortcut: hotkeyTriggerSchema.nullable(),
  /** NT-13: asks "What did I miss?" about the meeting being recorded. Null means none. */
  recapShortcut: hotkeyTriggerSchema.nullable(),
  /** NT-03: starts a meeting recording, and stops it when pressed again. Null means none. */
  meetingShortcut: hotkeyTriggerSchema.nullable(),
  /** HB-26, HB-34: Scratchpad on or off, and whether a note opens in a new tab. */
  scratchpad: z.strictObject({ enabled: z.boolean(), newTab: z.boolean() }),
  /** HB-23: the interface language; English is the only one shipped so far. */
  language: z.enum(APP_LANGUAGES),
  /** HB-24: which macOS notifications Murmur sends. None ever holds dictated text. */
  notifications: z.strictObject({
    dictationFailed: z.boolean(),
    modelDownload: z.boolean(),
    focusEnded: z.boolean(),
    milestone: z.boolean(),
    weeklySummary: z.boolean(),
  }),
  /** HB-08: where each guided tour got to. */
  help: helpSettingsSchema,
  /** HB-43: the local referral code and the hand-kept invite count. */
  referral: referralSettingsSchema,
  /** M5: Notetaker recording, detection and processing. */
  notetaker: notetakerSettingsSchema,
  /** M6: the sync interval and read-only switch of each connector, and the cache lifetime. */
  connectors: connectorSettingsSchema,
  /** M6: the local MCP server (CN-11). */
  mcp: mcpSettingsSchema,
  /** CN-12: the actions connected apps can do for other features. */
  extensions: extensionsSettingsSchema,
  /** HB-20, HB-57: developer mode and the engine switches. */
  devMode: developerSettingsSchema,
  /** HB-19: the trial, the student label and the plan change log. */
  planState: planStateSchema,
  /** HB-48 to HB-52: history, recordings, retention and strict local mode. */
  privacy: privacySettingsSchema,
  /** HB-22: the look of every window; System follows macOS. */
  theme: z.enum(["system", "light", "dark"]),
  /** HB-51: an optional local display name for the Home greeting; never published. */
  profile: z.strictObject({
    displayName: z.string().trim().max(60),
    showOnHome: z.boolean(),
  }),
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
    creatorMode: true,
    microphones: true,
    insertion: true,
    soundVolume: true,
    silentWarning: true,
    bar: true,
    smartFormatting: true,
    sessionLimitMinutes: true,
    contextAwareness: true,
    mouseButtons: true,
    typingReminder: true,
    languagePrompt: true,
    whisperMode: true,
    memory: true,
    learnCorrections: true,
    voiceProfile: true,
    email: true,
    jargonPacks: true,
    developerTools: true,
    experimental: true,
    commandMode: true,
    instruct: true,
    focus: true,
    plan: true,
    openHubOnLaunch: true,
    insights: true,
    profile: true,
    scratchpad: true,
    theme: true,
    language: true,
    notifications: true,
    privacy: true,
    planState: true,
    devMode: true,
    help: true,
    referral: true,
    notetaker: true,
    connectors: true,
    mcp: true,
    extensions: true,
  })
  .partial()
  .strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Storage key for each setting. */
export const SETTING_KEYS: Record<keyof Settings, string> = {
  holdShortcut: "hotkey.dictate_hold",
  handsFreeShortcut: "hotkey.hands_free",
  rewriteShortcut: "hotkey.rewrite",
  commandShortcut: "hotkey.command_mode",
  commandMode: "command_mode.settings",
  instructShortcut: "hotkey.instruct",
  instruct: "instruct.context",
  focusShortcut: "hotkey.focus",
  focus: "focus.settings",
  plan: "plan.tier",
  inputDevice: "audio.input_device",
  languages: "speech.languages",
  cleanupLevel: "cleanup.level",
  sounds: "sounds.events",
  muteWhileDictating: "media.mute_while_dictating",
  setupComplete: "onboarding.complete",
  pressEnterCommand: "press_enter.enabled",
  creatorMode: "ui.creator_mode",
  microphones: "audio.microphones",
  insertion: "insert.settings",
  soundVolume: "sounds.volume",
  silentWarning: "audio.silent_warning",
  bar: "ui.bar",
  smartFormatting: "format.smart",
  sessionLimitMinutes: "audio.session_limit_minutes",
  contextAwareness: "context.enabled",
  mouseButtons: "hotkey.mouse_buttons",
  typingReminder: "reminder.typing",
  languagePrompt: "speech.language_prompt",
  whisperMode: "audio.whisper_mode",
  memory: "memory.flags",
  learnCorrections: "dictionary.learn_corrections",
  voiceProfile: "voice_profile.flags",
  email: "email.settings",
  jargonPacks: "developer.jargon_packs",
  developerTools: "developer.tools",
  experimental: "experimental.flags",
  openHubOnLaunch: "app.open_hub_on_launch",
  insights: "insights.settings",
  profile: "profile.settings",
  scratchpadShortcut: "hotkey.scratchpad",
  meetingShortcut: "hotkey.meeting",
  recapShortcut: "hotkey.recap",
  copyLastShortcut: "hotkey.copy_last",
  pasteLastShortcut: "hotkey.paste_last",
  pressEnterShortcut: "hotkey.press_enter",
  scratchpad: "scratchpad.settings",
  theme: "ui.theme",
  language: "ui.language",
  notifications: "notifications.settings",
  privacy: "privacy.settings",
  planState: "plan.state",
  devMode: "dev.settings",
  help: "help.tours",
  referral: "referral.settings",
  notetaker: "notetaker.settings",
  connectors: "connectors.settings",
  mcp: "mcp.settings",
  extensions: "extensions.settings",
};

/** DC-31, DC-34 and DC-40 defaults. */
export const DEFAULT_INSERTION: Settings["insertion"] = {
  method: "auto",
  pasteInRemoteDesktops: false,
  typeInApps: [],
  pasteInApps: [],
};
export const SOUND_VOLUME_DEFAULT = 50;

/** HB-17 defaults for the Bar. */
export const DEFAULT_BAR: Settings["bar"] = {
  visible: true,
  allSpaces: true,
  aboveFullScreen: false,
};

/** HB-24 defaults. */
export const DEFAULT_NOTIFICATIONS: Settings["notifications"] = {
  dictationFailed: true,
  modelDownload: true,
  focusEnded: true,
  milestone: false,
  weeklySummary: false,
};

/** RW-18 defaults. */
export const DEFAULT_FOCUS: Settings["focus"] = { duration: 25 };

/** RW-11 and RW-17 defaults. */
export const DEFAULT_INSTRUCT: Settings["instruct"] = {
  fieldContext: true,
  memory: true,
  samples: true,
  saveThreads: true,
  model: "fast",
};

/** RW-08 defaults. */
export const DEFAULT_COMMAND_MODE: Settings["commandMode"] = {
  wakePhrase: "Hey Murmur",
  wakePhraseEnabled: true,
};

/** DC-40 defaults: every sound on except cancel. */
export const DEFAULT_SOUNDS: Settings["sounds"] = {
  start: true,
  lock: true,
  success: true,
  error: true,
  cancel: false,
  milestone: true,
  set: "subtle",
};

export const SHORTCUT_SLOTS = [
  "hold",
  "handsFree",
  "rewrite",
  "command",
  "instruct",
  "focus",
  "scratchpad",
  "meeting",
  "copyLast",
  "pasteLast",
  "pressEnter",
  "recap",
] as const;
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
  shortcutLabels: z.strictObject({
    hold: z.string(),
    handsFree: z.string(),
    rewrite: z.string(),
    command: z.string(),
    instruct: z.string(),
    focus: z.string(),
    scratchpad: z.string(),
    meeting: z.string(),
    copyLast: z.string(),
    pasteLast: z.string(),
    pressEnter: z.string(),
    recap: z.string(),
  }),
  /** Shortcuts the helper refused to listen for (DC-06). */
  unavailable: z.array(z.enum(SHORTCUT_SLOTS)),
  /** Null when the helper could not list devices. */
  devices: z.array(audioDeviceSchema).nullable(),
  /** HB-12: the settings that are not at their default, which can be put back. */
  changed: z.array(z.string()).default([]),
});
export type SettingsView = z.infer<typeof settingsViewSchema>;

export const shortcutResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), view: settingsViewSchema }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type ShortcutResult = z.infer<typeof shortcutResultSchema>;

/** HB-12: the settings that a row of the Settings page can put back to their default. */
export const RESETTABLE_SETTINGS = [
  "language",
  "notifications",
  "cleanupLevel",
  "pressEnterCommand",
  "sessionLimitMinutes",
  "smartFormatting",
  "insertion",
  "contextAwareness",
  "typingReminder",
  "creatorMode",
  "sounds",
  "soundVolume",
  "muteWhileDictating",
  "scratchpad",
  "languages",
  "languagePrompt",
  "inputDevice",
  "microphones",
  "silentWarning",
  "whisperMode",
] as const satisfies readonly (keyof Settings)[];
export type ResettableSetting = (typeof RESETTABLE_SETTINGS)[number];
