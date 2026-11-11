import type { Settings } from "@murmur/shared";

/** Words typed in the window that trigger a nudge (DC-08). */
export const TYPING_THRESHOLD_WORDS = 60;
export const TYPING_WINDOW_MS = 2 * 60_000;
/** At most one nudge in this long. */
export const NUDGE_GAP_MS = 60 * 60_000;

export type SnoozeChoice = "hour" | "tomorrow" | "off" | "on";

export interface TypingReminderDeps {
  settings(): Settings;
  update(reminder: Settings["typingReminder"]): void;
  /** A dictation is recording or being processed. */
  isDictating(): boolean;
  now(): number;
  /** Shows the nudge. */
  nudge(message: string): void;
  /** "Right Option", for the message. */
  holdLabel(): string;
}

export interface TypingReminder {
  /** The helper reports words typed over a period. */
  record(words: number): void;
  snooze(choice: SnoozeChoice): void;
  /** True when it is on and not snoozed right now. */
  isActive(): boolean;
}

/** 09:00 local time on the day after `now`. */
export function tomorrowMorning(now: number): number {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}

/**
 * Suggests dictating when someone types a lot: more than 60 words in a rolling two minutes,
 * at most once an hour, never during a dictation. The snooze lives in settings, so it
 * survives a restart; the counts live only in memory.
 */
export function createTypingReminder(deps: TypingReminderDeps): TypingReminder {
  let recent: { at: number; words: number }[] = [];
  let lastNudge: number | null = null;

  function active(now: number): boolean {
    const { enabled, snoozedUntil } = deps.settings().typingReminder;
    return enabled && (snoozedUntil === null || snoozedUntil <= now);
  }

  return {
    record(words) {
      const now = deps.now();
      recent = recent.filter((entry) => now - entry.at < TYPING_WINDOW_MS);
      recent.push({ at: now, words });
      if (!active(now) || deps.isDictating()) return;
      if (lastNudge !== null && now - lastNudge < NUDGE_GAP_MS) return;
      const total = recent.reduce((sum, entry) => sum + entry.words, 0);
      if (total <= TYPING_THRESHOLD_WORDS) return;
      lastNudge = now;
      recent = [];
      deps.nudge(`Dictate instead? Hold ${deps.holdLabel()}.`);
    },
    snooze(choice) {
      const now = deps.now();
      const current = deps.settings().typingReminder;
      if (choice === "on") deps.update({ enabled: true, snoozedUntil: null });
      else if (choice === "off") deps.update({ ...current, enabled: false });
      else if (choice === "hour") deps.update({ enabled: true, snoozedUntil: now + 60 * 60_000 });
      else deps.update({ enabled: true, snoozedUntil: tomorrowMorning(now) });
    },
    isActive: () => active(deps.now()),
  };
}
