import type { Settings } from "@murmur/shared";

/**
 * Choices made on the Bar's menu for the next dictation only (DC-46). They are held in memory,
 * used by that dictation, and dropped when it is done, unless saved as the default.
 */

export type SessionChoices = Partial<Pick<Settings, "inputDevice" | "languages" | "cleanupLevel">>;

export interface NextSession {
  /** The settings the dictation in progress, or the next one, uses. */
  settings(): Settings;
  choose(change: SessionChoices): void;
  /** True while a choice waits for the next dictation. */
  pending(): boolean;
  /** Keeps the waiting choices as the settings. */
  save(): void;
  /** A recording started: the waiting choices are now its own. */
  started(): void;
  /** That dictation is done with. */
  finished(): void;
}

export function createNextSession(
  settings: () => Settings,
  update: (change: SessionChoices) => void,
): NextSession {
  let waiting: SessionChoices = {};
  let running: SessionChoices = {};
  const pending = () => Object.keys(waiting).length > 0;
  return {
    settings: () => ({ ...settings(), ...running, ...waiting }),
    choose(change) {
      waiting = { ...waiting, ...change };
    },
    pending,
    save() {
      if (!pending()) return;
      const kept = waiting;
      waiting = {};
      update(kept);
    },
    started() {
      running = waiting;
      waiting = {};
    },
    finished() {
      running = {};
    },
  };
}
