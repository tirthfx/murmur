/**
 * Interface text (HB-23) for what main draws itself: the tray menu and notifications. One
 * catalogue per language; English is complete and is the fallback for any missing key, so a
 * raw key name is never shown. `{name}` marks a value filled in at run time.
 */

export const APP_LANGUAGES = ["en"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

export const APP_LANGUAGE_NAMES: Record<AppLanguage, string> = { en: "English" };

const en = {
  "tray.start": "Start dictation",
  "tray.stop": "Stop dictation",
  "tray.microphone": "Microphone",
  "tray.microphone.auto": "Auto",
  "tray.microphone.saved": "Saved microphone (not connected)",
  "tray.languages": "Languages",
  "tray.languages.detect": "Detect automatically",
  "tray.copyLast": "Copy last transcript",
  "barMenu.microphoneNow": "Microphone: {name}",
  "barMenu.systemDefault": "System default",
  "barMenu.language": "Language: {name}",
  "barMenu.cleanup": "Cleanup: {name}",
  "barMenu.cleanup.off": "Off",
  "barMenu.cleanup.light": "Light",
  "barMenu.cleanup.standard": "Standard",
  "barMenu.cleanup.full": "Full",
  "barMenu.once": "Changes here are for the next dictation only",
  "barMenu.save": "Save as default",
  "barMenu.whisper": "Whisper mode",
  "barMenu.on": "On",
  "barMenu.off": "Off",
  "tray.retryLast": "Retry last dictation",
  "tray.reminder": "Typing reminder",
  "tray.reminder.on": "Turn on",
  "tray.reminder.snoozed": "Snoozed",
  "tray.reminder.resume": "Resume now",
  "tray.reminder.hour": "Snooze for 1 hour",
  "tray.reminder.tomorrow": "Snooze until tomorrow",
  "tray.reminder.off": "Turn off",
  "tray.focus.start": "Start Focus",
  "tray.focus.on": "Focus is on",
  "tray.focus.off": "Turn off Focus",
  "tray.meeting.start": "Record a meeting",
  "tray.meeting.stop": "Stop recording the meeting",
  "tray.meeting.recording": "Recording a meeting: {elapsed}",
  "tray.meeting.next": "Next: {title}, {when}",
  "tray.meeting.join": "Join the meeting",
  "tray.meeting.recordEvent": "Record this meeting",
  "tray.meeting.brief": "Open the brief",
  "tray.quit": "Quit Murmur",
  "tray.tooltip": "Murmur",
  "tray.tooltip.listening": "Murmur: listening",
  "tray.tooltip.warning": "Murmur: the last dictation had a problem",
  "tray.tooltip.meeting": "Murmur: recording a meeting",
  "notify.dictationFailed.title": "A dictation did not go in",
  "notify.dictationFailed.body": "Its recording is kept. Open Murmur to retry it.",
  "notify.modelReady.title": "The speech model is ready",
  "notify.modelReady.body": "Dictation works offline from now on.",
  "notify.modelFailed.title": "The speech model did not download",
  "notify.modelFailed.body": "Open Murmur to try again.",
  "notify.focusEnded.title": "Focus ended",
  "notify.focusEnded.body": "Blocked apps and sites are open again.",
  "notify.milestone.title": "Milestone: {name}",
  "notify.milestone.body": "See it on the Insights page.",
  "notify.weekly.title": "Your week with Murmur",
  "notify.weekly.body": "{words} words dictated last week. Daily streak: {streak}.",
  "notify.test.title": "Murmur notifications work",
  "notify.test.body": "This is how Murmur lets you know about things.",
} as const;

export type CatalogueKey = keyof typeof en;

/** Per-language text; English is also kept apart below as the fallback. */
export const CATALOGUES: Record<AppLanguage, Partial<Record<CatalogueKey, string>>> = {
  en: { ...en },
};

/** A string in the chosen language, falling back to English; values fill `{name}` marks. */
export function translate(
  language: string,
  key: CatalogueKey,
  values: Record<string, string | number> = {},
): string {
  const catalogue = CATALOGUES[language as AppLanguage] ?? en;
  const text = catalogue[key] ?? en[key];
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}
