import type {
  BarAnswer,
  DetectEvent,
  DetectSettings,
  MeetingMatcher,
  RecordingState,
} from "@murmur/shared";
import type { Clock, Logger, TimerHandle } from "../helper/types";
import type { StartResult } from "./meeting-recorder";

export interface MeetingDetectorDeps {
  clock: Clock;
  matchers(): MeetingMatcher[];
  /** `notetaker.detect`. */
  settings(): DetectSettings;
  recording(): RecordingState;
  /**
   * Shows "Record this meeting?" on the Bar with Record, Not now and Never for this app.
   * False when the Bar could not show it (a dictation is recording): nothing is asked then.
   */
  showPrompt(app: { id: string; name: string }): boolean;
  hidePrompt(): void;
  /** Starts a recording the way the owner would (the consent notice still applies). */
  start(): Promise<StartResult>;
  stop(): Promise<unknown>;
  /** The owner chose "Never for this app". */
  neverFor(id: string): void;
  logger: Logger;
}

export interface MeetingDetector {
  /** A call started or ended for a matcher. */
  event(event: DetectEvent): void;
  /** The Bar prompt was answered. False when no prompt of this detector was waiting. */
  answer(answer: BarAnswer): boolean;
  /** The meeting recording changed state (a stop by the owner counts too). */
  recordingChanged(state: RecordingState): void;
  /** Forgets every call and closes the prompt, for when detection is turned off. */
  reset(): void;
}

/** A call must be seen this long before it is acted on, so a flicker does nothing. */
export const DEBOUNCE_MS = 2_000;
/** A recording that Murmur started ends this long after the call did. */
export const ENDING_MS = 60_000;

type CallState = "candidate" | "prompted" | "declined" | "recording" | "ending";

/**
 * Turns "a call started or ended" into a prompt and, when asked to, a recording and its end
 * (NT-01). Per app the states are: candidate (seen, waiting out the debounce), prompted (the
 * Bar asks), declined (Not now, a timeout, or a recording that was already running: nothing
 * more until the call ends), recording (started here) and ending (the call is gone; the
 * recording stops after a minute unless it comes back). Nothing is captured before the owner
 * says Record, unless auto record is on.
 */
export function createMeetingDetector(deps: MeetingDetectorDeps): MeetingDetector {
  const states = new Map<string, CallState>();
  const timers = new Map<string, TimerHandle>();
  let promptFor: string | null = null;

  const clear = (id: string) => {
    const timer = timers.get(id);
    if (timer !== undefined) deps.clock.clearTimeout(timer);
    timers.delete(id);
  };
  const forget = (id: string) => {
    clear(id);
    states.delete(id);
  };
  const after = (id: string, ms: number, action: () => void) => {
    clear(id);
    timers.set(
      id,
      deps.clock.setTimeout(() => {
        timers.delete(id);
        action();
      }, ms),
    );
  };

  function allowed(id: string): boolean {
    const settings = deps.settings();
    return settings.enabled && settings.apps[id] !== false && !settings.neverApps.includes(id);
  }

  async function record(id: string): Promise<void> {
    const result = await deps.start();
    if (states.get(id) === undefined) return;
    if (result.ok) states.set(id, "recording");
    else {
      deps.logger.info(`detected call not recorded: ${result.message}`);
      states.set(id, "declined");
    }
  }

  function decide(id: string, name: string): void {
    if (states.get(id) !== "candidate") return;
    if (deps.recording().status !== "idle" || promptFor !== null) {
      // Something is recording already, or the Bar is asking about another call.
      states.set(id, "declined");
      return;
    }
    if (deps.settings().autoRecord) {
      void record(id);
      return;
    }
    if (!deps.showPrompt({ id, name })) {
      states.set(id, "declined");
      return;
    }
    states.set(id, "prompted");
    promptFor = id;
  }

  return {
    event(event) {
      const matcher = deps.matchers().find((candidate) => candidate.id === event.matcherId);
      if (!matcher) return;
      const id = matcher.id;
      const state = states.get(id);
      if (event.active) {
        if (!allowed(id)) return;
        if (state === "ending") {
          clear(id);
          states.set(id, "recording");
        } else if (state === undefined) {
          states.set(id, "candidate");
          after(id, DEBOUNCE_MS, () => decide(id, matcher.name));
        }
        return;
      }
      if (state === "recording") {
        states.set(id, "ending");
        after(id, ENDING_MS, () => {
          if (states.get(id) !== "ending") return;
          forget(id);
          void deps.stop();
        });
      } else if (state === "prompted") {
        if (promptFor === id) {
          promptFor = null;
          deps.hidePrompt();
        }
        forget(id);
      } else if (state !== "ending") {
        forget(id);
      }
    },

    answer(answer) {
      const id = promptFor;
      if (id === null) return false;
      promptFor = null;
      if (answer === "yes") void record(id);
      else if (answer === "never") {
        forget(id);
        deps.neverFor(id);
      } else states.set(id, "declined");
      return true;
    },

    recordingChanged(state) {
      if (state.status !== "idle") return;
      for (const [id, current] of states) {
        if (current === "recording") {
          // The owner stopped it while the call goes on: do not ask again for this call.
          clear(id);
          states.set(id, "declined");
        } else if (current === "ending") forget(id);
      }
    },

    reset() {
      for (const id of [...states.keys()]) forget(id);
      if (promptFor !== null) deps.hidePrompt();
      promptFor = null;
    },
  };
}
