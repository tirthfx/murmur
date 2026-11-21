/** The pages inside Settings (HB-12), in order. Testing comes with developer mode (#161). */
export const SETTINGS_PAGES = [
  { id: "general", title: "General" },
  { id: "system", title: "System" },
  { id: "shortcuts", title: "Shortcuts" },
  { id: "languages", title: "Languages" },
  { id: "microphone", title: "Microphone" },
  { id: "experimental", title: "Experimental" },
  { id: "plans", title: "Plans" },
  { id: "privacy", title: "Data and Privacy" },
  { id: "testing", title: "Testing" },
] as const;

/** Pages shown only in developer mode (HB-20). */
export const DEVELOPER_PAGES: readonly string[] = ["testing"];

export type SettingsPageId = (typeof SETTINGS_PAGES)[number]["id"];

export function isSettingsPageId(value: string): value is SettingsPageId {
  return SETTINGS_PAGES.some((page) => page.id === value);
}

/** One searchable setting: the page it is on and the `data-setting` id of its row. */
export interface SettingEntry {
  id: string;
  page: SettingsPageId;
  label: string;
  /** Other words it can be found by. */
  words?: string;
}

/** Every setting, once, with its page (HB-12). Each id is a `data-setting` row on that page. */
export const SETTINGS_INDEX: readonly SettingEntry[] = [
  { id: "launch-at-login", page: "general", label: "Launch at login", words: "start login" },
  { id: "open-hub", page: "general", label: "Show the Hub when Murmur starts", words: "window" },
  { id: "theme", page: "general", label: "Appearance", words: "theme dark light mode" },
  { id: "display-name", page: "general", label: "Your name", words: "display name greeting" },
  { id: "app-language", page: "general", label: "App language", words: "interface english" },
  { id: "notifications", page: "general", label: "Notifications", words: "alerts weekly summary" },
  { id: "referral", page: "general", label: "Referrals", words: "invite code" },
  { id: "permissions", page: "general", label: "Permissions", words: "microphone accessibility" },
  { id: "setup", page: "general", label: "Run setup again", words: "onboarding tutorial" },
  { id: "cleanup", page: "system", label: "Cleanup", words: "fillers punctuation level" },
  { id: "press-enter", page: "system", label: "Say “press enter” to press Return" },
  { id: "context", page: "system", label: "Use the text around the cursor", words: "context" },
  { id: "typing-reminder", page: "system", label: "Suggest dictating after a lot of typing" },
  { id: "sounds", page: "system", label: "Sounds", words: "tones audio" },
  { id: "mute", page: "system", label: "Mute other audio while dictating" },
  { id: "scratchpad", page: "system", label: "Scratchpad", words: "notes tabs" },
  {
    id: "meeting-notice",
    page: "system",
    label: "Recording notice",
    words: "meeting consent notetaker tell participants",
  },
  {
    id: "meeting-detect",
    page: "system",
    label: "Meeting detection",
    words: "zoom meet teams call notetaker record automatic",
  },
  {
    id: "meeting-summary",
    page: "system",
    label: "Meeting summaries",
    words: "notetaker skill length automatic",
  },
  {
    id: "meeting-tasks",
    page: "system",
    label: "Tasks from meetings",
    words: "notetaker my tasks suggest owner",
  },
  {
    id: "meeting-ask",
    page: "system",
    label: "Ask across meetings",
    words: "notetaker question chat search notes scope",
  },
  {
    id: "meeting-folders",
    page: "system",
    label: "Meeting folders",
    words: "notetaker inbox suggest default folder",
  },
  {
    id: "meeting-language",
    page: "system",
    label: "Meeting languages",
    words: "notetaker translate english transcript rerun summary language",
  },
  {
    id: "meeting-corrections",
    page: "system",
    label: "Transcript corrections",
    words: "notetaker edit fix words speaker dictionary",
  },
  { id: "instruct", page: "system", label: "Instruct Mode", words: "draft context" },
  { id: "hold", page: "shortcuts", label: "Push to talk", words: "shortcut key hotkey" },
  { id: "hands-free", page: "shortcuts", label: "Hands-free", words: "shortcut key lock" },
  { id: "rewrite", page: "shortcuts", label: "Rewrite shortcut", words: "key" },
  {
    id: "scratchpad-shortcut",
    page: "shortcuts",
    label: "Scratchpad shortcut",
    words: "notes key",
  },
  {
    id: "meeting-shortcut",
    page: "shortcuts",
    label: "Meeting recording shortcut",
    words: "notetaker record meeting key",
  },
  { id: "mouse-hold", page: "shortcuts", label: "Push to talk (mouse)", words: "button" },
  { id: "mouse-hands-free", page: "shortcuts", label: "Hands-free (mouse)", words: "button" },
  { id: "languages", page: "languages", label: "Dictation languages", words: "language" },
  { id: "microphone", page: "microphone", label: "Microphone", words: "input device" },
  { id: "whisper", page: "microphone", label: "Whisper mode", words: "quiet" },
  { id: "mic-check", page: "microphone", label: "Microphone check", words: "level test" },
  { id: "experimental", page: "experimental", label: "Experimental options" },
  { id: "command-mode", page: "experimental", label: "Command Mode", words: "commands" },
  { id: "focus-mode", page: "experimental", label: "Focus Mode", words: "block apps sites" },
  { id: "plan", page: "plans", label: "Plan", words: "tier free pro" },
  { id: "privacy", page: "privacy", label: "What leaves this Mac", words: "data network" },
  {
    id: "privacy-modes",
    page: "privacy",
    label: "Privacy mode",
    words: "balanced minimal full recordings history",
  },
  { id: "retention", page: "privacy", label: "Retention", words: "keep delete days" },
  { id: "storage", page: "privacy", label: "Local storage", words: "folder size finder" },
  { id: "export", page: "privacy", label: "Export", words: "backup save data" },
  { id: "delete", page: "privacy", label: "Delete data", words: "erase reset remove" },
  { id: "developer-mode", page: "testing", label: "Developer mode", words: "testing" },
  { id: "flags", page: "testing", label: "Feature flags", words: "experiments override" },
  { id: "tools", page: "testing", label: "Testing tools", words: "diagnostics notification bar" },
  { id: "engine", page: "testing", label: "Engine switches", words: "cleanup typed context" },
  { id: "strict-local", page: "privacy", label: "Strict local mode", words: "offline network" },
];

/** Settings whose label or words contain every typed word, best first. */
export function searchSettings(query: string): SettingEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored = SETTINGS_INDEX.flatMap((entry) => {
    const label = entry.label.toLowerCase();
    const text = `${label} ${entry.words ?? ""}`;
    if (!words.every((word) => text.includes(word))) return [];
    const score = label.startsWith(words[0]!)
      ? 0
      : words.every((word) => label.includes(word))
        ? 1
        : 2;
    return [{ entry, score }];
  });
  return scored.sort((a, b) => a.score - b.score).map((item) => item.entry);
}

/** `#/settings/system` → "system". */
export function settingsPageFromHash(hash: string): SettingsPageId | null {
  const match = /^#\/settings\/([a-z]+)$/.exec(hash);
  return match && isSettingsPageId(match[1]!) ? match[1] : null;
}
