import {
  FOCUS_LIMITS,
  FOCUS_MESSAGES,
  type FocusDuration,
  type FocusEndReason,
  type FocusRule,
  type FocusState,
  type FrontApp,
} from "@murmur/shared";
import type { Clock, Logger, TimerHandle } from "../helper/types";

export interface FocusControllerDeps {
  /** Blocked apps; read on every change of the app in front. */
  rules: () => FocusRule[];
  /** Session rows; null without a database. */
  sessions: {
    start(plannedMs: number | null): string;
    end(id: string, reason: FocusEndReason): void;
  } | null;
  /** Whether Focus Mode is on in Experimental. */
  enabled: () => boolean;
  /** The duration the shortcut uses: the last one chosen. */
  lastDuration: () => FocusDuration;
  saveDuration: (duration: FocusDuration) => void;
  watchFrontApp: (enabled: boolean) => Promise<void>;
  overlay: { show(name: string): void; hide(): void };
  /** Says something on the Bar ("Focus ended"). */
  say: (message: string) => void;
  activateApp: (bundleId: string) => Promise<void>;
  /** Murmur's own process: the overlay itself takes the front, and must not count. */
  ownPid: number;
  clock: Clock & { now(): number };
  logger: Logger;
  /** Called after every change of state (the Bar, the tray, the Hub). */
  onChange?: (state: FocusState) => void;
}

export interface FocusController {
  state(): FocusState;
  /** Turns Focus on for this long (or the last duration); remembered for next time. */
  start(duration?: FocusDuration): void;
  stop(reason?: FocusEndReason): void;
  /** The shortcut: on with the last duration, or off. */
  toggle(): void;
  /** Overlay: Pause Focus for 10 minutes. */
  pause(): void;
  /** Overlay: go back to the app used before the blocked one. */
  goBack(): Promise<void>;
  /** The helper reported the app in front. */
  frontApp(app: FrontApp): void;
  /** The helper came back after a restart: ask for the front app again if Focus is on. */
  helperReady(): void;
  /** Experimental switched off, or a blocked app removed: check again. */
  refresh(): void;
  /** Murmur is quitting: an open session ends as `quit`. */
  quit(): void;
}

/** When nothing else was used before the blocked app. */
const FALLBACK_APP = "com.apple.finder";

function minutes(duration: FocusDuration): number | null {
  return duration === "untilOff" ? null : duration * 60_000;
}

/**
 * Focus Mode (RW-18, RW-19, RW-21). Owns the timer and the session rows; shows the overlay
 * while a blocked app is in front, and hides it when another app is. Apps are never quit.
 */
export function createFocusController(deps: FocusControllerDeps): FocusController {
  const { clock } = deps;
  let current: FocusState = { status: "off" };
  let sessionId: string | null = null;
  let timer: TimerHandle | null = null;
  /** The last app in front that was not blocked and not Murmur: where Go back goes. */
  let previous: string | null = null;
  /** The blocked app the overlay is shown for. */
  let blocked: string | null = null;
  let lastFront: FrontApp | null = null;

  function clearTimer(): void {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  }

  function changed(): void {
    deps.onChange?.(current);
  }

  function watch(on: boolean): void {
    deps.watchFrontApp(on).catch((error: unknown) => {
      deps.logger.warn(
        `could not ${on ? "watch" : "stop watching"} the app in front: ${String(error)}`,
      );
    });
  }

  function hideOverlay(): void {
    if (blocked === null) return;
    blocked = null;
    deps.overlay.hide();
  }

  function endSession(reason: FocusEndReason): void {
    if (sessionId !== null) deps.sessions?.end(sessionId, reason);
    sessionId = null;
  }

  function begin(plannedMs: number | null): void {
    clearTimer();
    sessionId = deps.sessions?.start(plannedMs) ?? null;
    const endsAt = plannedMs === null ? null : clock.now() + plannedMs;
    current = { status: "on", endsAt };
    if (plannedMs !== null) {
      timer = clock.setTimeout(() => {
        timer = null;
        stop("timer");
        deps.say(FOCUS_MESSAGES.ended);
      }, plannedMs);
    }
    lastFront = null;
    watch(true);
    changed();
  }

  function stop(reason: FocusEndReason = "user"): void {
    if (current.status === "off") return;
    clearTimer();
    endSession(reason);
    hideOverlay();
    if (current.status === "on") watch(false);
    current = { status: "off" };
    deps.logger.info(`Focus ended (${reason})`);
    changed();
  }

  function isBlocked(bundleId: string | null): FocusRule | null {
    if (!bundleId) return null;
    return deps.rules().find((rule) => rule.kind === "app" && rule.value === bundleId) ?? null;
  }

  function check(app: FrontApp): void {
    if (current.status !== "on") {
      hideOverlay();
      return;
    }
    const rule = isBlocked(app.bundleId);
    if (rule) {
      if (blocked !== rule.value) {
        blocked = rule.value;
        deps.overlay.show(app.name ?? rule.label);
      }
      return;
    }
    hideOverlay();
    if (app.bundleId) previous = app.bundleId;
  }

  return {
    state: () => current,

    start(duration) {
      if (!deps.enabled()) {
        deps.logger.info("Focus Mode is off in Experimental");
        return;
      }
      const chosen = duration ?? deps.lastDuration();
      if (duration !== undefined) deps.saveDuration(duration);
      if (current.status !== "off") stop("user");
      deps.logger.info(`Focus on (${chosen === "untilOff" ? "until off" : `${chosen} min`})`);
      begin(minutes(chosen));
    },

    stop,

    toggle() {
      if (current.status === "off") this.start();
      else stop("user");
    },

    pause() {
      if (current.status !== "on") return;
      const remainingMs =
        current.endsAt === null ? null : Math.max(0, current.endsAt - clock.now());
      clearTimer();
      endSession("paused");
      hideOverlay();
      watch(false);
      const resumeAt = clock.now() + FOCUS_LIMITS.pauseMs;
      current = { status: "paused", resumeAt, remainingMs };
      timer = clock.setTimeout(() => {
        timer = null;
        if (current.status !== "paused") return;
        if (remainingMs !== null && remainingMs <= 0) {
          current = { status: "off" };
          changed();
          deps.say(FOCUS_MESSAGES.ended);
          return;
        }
        begin(remainingMs);
        deps.say(FOCUS_MESSAGES.resumed);
      }, FOCUS_LIMITS.pauseMs);
      deps.say(FOCUS_MESSAGES.paused);
      changed();
    },

    async goBack() {
      const target = previous && !isBlocked(previous) ? previous : FALLBACK_APP;
      await deps.activateApp(target);
    },

    frontApp(app) {
      // The overlay itself (or the Hub) in front changes nothing.
      if (app.pid !== null && app.pid === deps.ownPid) return;
      lastFront = app;
      check(app);
    },

    helperReady() {
      if (current.status === "on") watch(true);
    },

    refresh() {
      if (current.status !== "off" && !deps.enabled()) {
        stop("user");
        return;
      }
      if (lastFront) check(lastFront);
    },

    quit() {
      if (current.status === "on") endSession("quit");
      clearTimer();
      current = { status: "off" };
    },
  };
}
