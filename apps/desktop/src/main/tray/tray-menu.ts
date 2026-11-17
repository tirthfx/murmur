import {
  FOCUS_DURATIONS,
  focusDurationLabel,
  SPEECH_LANGUAGES,
  type AudioDevice,
  type FocusDuration,
  type FocusState,
  type SpeechLanguage,
} from "@murmur/shared";

/** What the menu bar icon shows next to the microphone. */
export type TrayStatus = "idle" | "listening" | "warning";

export interface TrayState {
  recording: boolean;
  status: TrayStatus;
  /** Null until the first device list arrives, or when the helper is not running. */
  devices: AudioDevice[] | null;
  /** "auto" or a device id. */
  inputDevice: string;
  /** In order, primary first; empty means detect. */
  languages: SpeechLanguage[];
  hasLastTranscript: boolean;
  /** A failed dictation can be transcribed again. */
  canRetry: boolean;
  typingReminder: "on" | "snoozed" | "off";
  /** Focus Mode (RW-18); null while it is off in Experimental. */
  focus?: { state: FocusState; duration: FocusDuration } | null;
}

export type TrayAction =
  | { type: "toggle" }
  | { type: "device"; id: string }
  /** Makes a language the primary one, or "auto" to detect. */
  | { type: "language"; code: SpeechLanguage | "auto" }
  | { type: "copy-last" }
  | { type: "retry-last" }
  | { type: "reminder"; choice: "hour" | "tomorrow" | "off" | "on" }
  | { type: "focus"; duration: FocusDuration }
  | { type: "focus-off" }
  | { type: "quit" };

/** One menu row, independent of the toolkit that draws it. */
export type TrayItem =
  | { kind: "separator" }
  | {
      kind: "item";
      label: string;
      action?: TrayAction;
      enabled?: boolean;
      /** Present on rows that are one choice of several. */
      checked?: boolean;
      submenu?: TrayItem[];
    };

/** Focus Mode: turn it off, or start it for a chosen time (the last one is checked). */
function focusItems(focus: NonNullable<TrayState["focus"]>): TrayItem[] {
  if (focus.state.status !== "off") {
    return [{ kind: "item", label: "Turn off Focus", action: { type: "focus-off" } }];
  }
  return FOCUS_DURATIONS.map((duration) => ({
    kind: "item" as const,
    label: focusDurationLabel(duration),
    checked: focus.duration === duration,
    action: { type: "focus" as const, duration },
  }));
}

function microphoneItems(state: TrayState): TrayItem[] {
  const devices = state.devices ?? [];
  const items: TrayItem[] = [
    {
      kind: "item",
      label: "Auto",
      checked: state.inputDevice === "auto",
      action: { type: "device", id: "auto" },
    },
  ];
  for (const device of devices) {
    items.push({
      kind: "item",
      label: device.name,
      checked: state.inputDevice === device.id,
      action: { type: "device", id: device.id },
    });
  }
  // The saved microphone is unplugged: keep it visible so the check mark has a home.
  if (state.inputDevice !== "auto" && !devices.some((device) => device.id === state.inputDevice)) {
    items.push({
      kind: "item",
      label: "Saved microphone (not connected)",
      checked: true,
      enabled: false,
    });
  }
  return items;
}

function reminderItems(status: TrayState["typingReminder"]): TrayItem[] {
  if (status === "off") {
    return [{ kind: "item", label: "Turn on", action: { type: "reminder", choice: "on" } }];
  }
  return [
    ...(status === "snoozed"
      ? [
          { kind: "item" as const, label: "Snoozed", enabled: false },
          {
            kind: "item" as const,
            label: "Resume now",
            action: { type: "reminder" as const, choice: "on" as const },
          },
        ]
      : []),
    { kind: "item", label: "Snooze for 1 hour", action: { type: "reminder", choice: "hour" } },
    {
      kind: "item",
      label: "Snooze until tomorrow",
      action: { type: "reminder", choice: "tomorrow" },
    },
    { kind: "separator" },
    { kind: "item", label: "Turn off", action: { type: "reminder", choice: "off" } },
  ];
}

/**
 * The tray menu (DC-45, minimal M1 set), in order: start or stop, microphone, languages,
 * copy last transcript, quit. Quit is always present and always enabled.
 */
export function trayMenu(state: TrayState): TrayItem[] {
  return [
    {
      kind: "item",
      label: state.recording ? "Stop dictation" : "Start dictation",
      action: { type: "toggle" },
    },
    { kind: "separator" },
    { kind: "item", label: "Microphone", submenu: microphoneItems(state) },
    {
      kind: "item",
      label: "Languages",
      submenu: [
        {
          kind: "item" as const,
          label: "Detect automatically",
          checked: state.languages.length === 0,
          action: { type: "language" as const, code: "auto" as const },
        },
        // The check marks the primary language; the others stay chosen in Settings.
        ...SPEECH_LANGUAGES.map((language) => ({
          kind: "item" as const,
          label: language.label,
          checked: state.languages[0] === language.code,
          action: { type: "language" as const, code: language.code },
        })),
      ],
    },
    { kind: "separator" },
    {
      kind: "item",
      label: "Copy last transcript",
      enabled: state.hasLastTranscript,
      action: { type: "copy-last" },
    },
    {
      kind: "item",
      label: "Retry last dictation",
      enabled: state.canRetry,
      action: { type: "retry-last" },
    },
    { kind: "item", label: "Typing reminder", submenu: reminderItems(state.typingReminder) },
    ...(state.focus
      ? [
          {
            kind: "item" as const,
            label: state.focus.state.status === "off" ? "Start Focus" : "Focus is on",
            submenu: focusItems(state.focus),
          },
        ]
      : []),
    { kind: "separator" },
    { kind: "item", label: "Quit Murmur", action: { type: "quit" } },
  ];
}

export function trayTooltip(status: TrayStatus): string {
  if (status === "listening") return "Murmur: listening";
  if (status === "warning") return "Murmur: the last dictation had a problem";
  return "Murmur";
}
