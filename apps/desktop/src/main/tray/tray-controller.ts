import {
  makePrimary,
  type AudioDevice,
  type FocusDuration,
  type FocusState,
  formatElapsed,
  type RecordingState,
  type Settings,
  type SettingsPatch,
} from "@murmur/shared";
import type { Clock, Logger, TimerHandle } from "../helper/types";
import type { RecorderEvent } from "../recorder";
import {
  trayMenu,
  trayTooltip,
  type TrayAction,
  type TrayItem,
  type TrayState,
  type TrayStatus,
} from "./tray-menu";

/** How long the warning dot stays after a problem, unless a new dictation starts first. */
export const WARNING_MS = 10_000;

export interface TrayView {
  items: TrayItem[];
  status: TrayStatus;
  tooltip: string;
  /** Text next to the icon while a meeting records, such as "12:04". */
  elapsed?: string;
  /** NT-29: the next meeting next to the icon, such as "Design sync in 12 min". */
  nextText?: string;
}

/** Draws the tray. Electron in production, a recorder in tests. */
export interface TrayHost {
  render(view: TrayView): void;
}

export interface TrayControllerDeps {
  host: TrayHost;
  clock: Clock;
  logger: Logger;
  settings(): Settings;
  updateSettings(patch: SettingsPatch): void;
  listDevices(): Promise<AudioDevice[]>;
  /** The most recent successful dictation, or null. */
  lastTranscript(): string | null;
  toggleDictation(): void;
  canRetry(): boolean;
  retryLast(): void;
  snoozeReminder(choice: "hour" | "tomorrow" | "off" | "on"): void;
  copy(text: string): void;
  quit(): void;
  /** Focus Mode now; absent where there is none. */
  focusState?(): FocusState;
  startFocus?(duration: FocusDuration): void;
  stopFocus?(): void;
  /** NT-04: the meeting recording; absent where there is none. */
  meetingState?(): RecordingState;
  startMeeting?(): void;
  stopMeeting?(): void;
  /**
   * NT-29: the next calendar meeting, or null when there is none or the setting is off. `text` is
   * what goes next to the icon.
   */
  nextMeeting?(): {
    eventId: string;
    title: string;
    when: string;
    hasLink: boolean;
    /** NT-11: whether a brief has been built for it. */
    hasBrief?: boolean;
    text: string;
  } | null;
  joinMeeting?(eventId: string): void;
  recordEvent?(eventId: string): void;
  /** NT-11: shows the brief of the next meeting in the Hub. */
  openBrief?(eventId: string): void;
}

export interface TrayController {
  /** Follows a dictation: the label, the red dot, the warning dot. */
  handleRecorderEvent(event: RecorderEvent): void;
  /** The helper stopped: no recording can be running. */
  handleHelperDown(): void;
  /** Reads the microphone list again and redraws if it changed. */
  refreshDevices(): Promise<void>;
  /** Redraws from the current settings and state. */
  refresh(): void;
  perform(action: TrayAction): void;
  view(): TrayView;
}

const WARNINGS: ReadonlySet<RecorderEvent["type"]> = new Set([
  "start-failed",
  "silent-mic",
  "stop-failed",
  "transcription-failed",
  "insert-failed",
]);

export function createTrayController(deps: TrayControllerDeps): TrayController {
  let recording = false;
  let warning = false;
  let warningTimer: TimerHandle | null = null;
  let devices: AudioDevice[] | null = null;
  let deviceKey = "";

  function meeting(): TrayState["meeting"] {
    const now = deps.meetingState?.();
    if (!now) return undefined;
    if (now.status === "recording") {
      return { status: "recording", elapsed: formatElapsed(deps.clock.now() - now.startedAt) };
    }
    return { status: now.status === "idle" ? "idle" : "busy" };
  }

  /** The next meeting; none while one is being recorded (the time of that one is shown instead). */
  function nextMeeting() {
    return meeting()?.status === "recording" ? null : (deps.nextMeeting?.() ?? null);
  }

  function state(): TrayState {
    const settings = deps.settings();
    const current = meeting();
    const next = nextMeeting();
    return {
      recording,
      ...(current ? { meeting: current } : {}),
      ...(next
        ? {
            next: {
              eventId: next.eventId,
              title: next.title,
              when: next.when,
              hasLink: next.hasLink,
              hasBrief: next.hasBrief === true,
            },
          }
        : {}),
      status: recording
        ? "listening"
        : current?.status === "recording"
          ? "meeting"
          : warning
            ? "warning"
            : "idle",
      devices,
      inputDevice: settings.inputDevice,
      languages: settings.languages,
      language: settings.language,
      hasLastTranscript: deps.lastTranscript() !== null,
      canRetry: deps.canRetry(),
      typingReminder: !settings.typingReminder.enabled
        ? "off"
        : settings.typingReminder.snoozedUntil !== null &&
            settings.typingReminder.snoozedUntil > deps.clock.now()
          ? "snoozed"
          : "on",
      focus:
        settings.experimental.focusMode && deps.focusState
          ? { state: deps.focusState(), duration: settings.focus.duration }
          : null,
    };
  }

  function view(): TrayView {
    const current = state();
    return {
      items: trayMenu(current),
      status: current.status,
      tooltip: trayTooltip(current.status, current.language),
      ...(current.meeting?.status === "recording" ? { elapsed: current.meeting.elapsed } : {}),
      ...(nextMeeting() ? { nextText: nextMeeting()!.text } : {}),
    };
  }

  function refresh(): void {
    deps.host.render(view());
  }

  function setWarning(on: boolean): void {
    if (warningTimer !== null) deps.clock.clearTimeout(warningTimer);
    warningTimer = null;
    warning = on;
    if (on) {
      warningTimer = deps.clock.setTimeout(() => {
        warningTimer = null;
        warning = false;
        refresh();
      }, WARNING_MS);
    }
  }

  return {
    handleRecorderEvent(event) {
      if (event.type === "started") {
        recording = true;
        setWarning(false);
      } else if (event.type === "stopped" || event.type === "cancelled") {
        recording = false;
      } else if (event.type === "start-failed") {
        recording = false;
      }
      if (WARNINGS.has(event.type)) setWarning(true);
      refresh();
    },
    handleHelperDown() {
      if (!recording) return;
      recording = false;
      refresh();
    },
    async refreshDevices() {
      let next: AudioDevice[] | null;
      try {
        next = await deps.listDevices();
      } catch {
        // The helper is not running: keep "Auto" only.
        next = null;
      }
      const key = JSON.stringify(next?.map((device) => [device.id, device.name]) ?? null);
      if (key === deviceKey && (devices === null) === (next === null)) return;
      deviceKey = key;
      devices = next;
      refresh();
    },
    refresh,
    perform(action) {
      switch (action.type) {
        case "toggle":
          deps.toggleDictation();
          return;
        case "device":
          deps.updateSettings({ inputDevice: action.id });
          return;
        case "language":
          deps.updateSettings({
            languages:
              action.code === "auto" ? [] : makePrimary(deps.settings().languages, action.code),
          });
          return;
        case "copy-last": {
          const text = deps.lastTranscript();
          if (text === null) deps.logger.info("no transcript to copy yet");
          else deps.copy(text);
          return;
        }
        case "retry-last":
          deps.retryLast();
          return;
        case "reminder":
          deps.snoozeReminder(action.choice);
          return;
        case "focus":
          deps.startFocus?.(action.duration);
          return;
        case "focus-off":
          deps.stopFocus?.();
          return;
        case "meeting-start":
          deps.startMeeting?.();
          return;
        case "meeting-stop":
          deps.stopMeeting?.();
          return;
        case "meeting-join":
          deps.joinMeeting?.(action.eventId);
          return;
        case "meeting-record-event":
          deps.recordEvent?.(action.eventId);
          return;
        case "meeting-brief":
          deps.openBrief?.(action.eventId);
          return;
        case "quit":
          deps.quit();
          return;
      }
    },
    view,
  };
}
