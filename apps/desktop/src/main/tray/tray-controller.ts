import { makePrimary, type AudioDevice, type Settings, type SettingsPatch } from "@murmur/shared";
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

  function state(): TrayState {
    const settings = deps.settings();
    return {
      recording,
      status: recording ? "listening" : warning ? "warning" : "idle",
      devices,
      inputDevice: settings.inputDevice,
      languages: settings.languages,
      hasLastTranscript: deps.lastTranscript() !== null,
      canRetry: deps.canRetry(),
      typingReminder: !settings.typingReminder.enabled
        ? "off"
        : settings.typingReminder.snoozedUntil !== null &&
            settings.typingReminder.snoozedUntil > deps.clock.now()
          ? "snoozed"
          : "on",
    };
  }

  function view(): TrayView {
    const current = state();
    return {
      items: trayMenu(current),
      status: current.status,
      tooltip: trayTooltip(current.status),
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
        case "quit":
          deps.quit();
          return;
      }
    },
    view,
  };
}
