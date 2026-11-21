import {
  FOCUS_DURATIONS,
  focusDurationLabel,
  SPEECH_LANGUAGES,
  type AudioDevice,
  type FocusDuration,
  type FocusState,
  type SpeechLanguage,
  translate,
  type CatalogueKey,
} from "@murmur/shared";

/** Tray text in the interface language (HB-23). */
const tr = (language: string | undefined, key: CatalogueKey) => translate(language ?? "en", key);

/** What the menu bar icon shows next to the microphone. */
export type TrayStatus = "idle" | "listening" | "warning" | "meeting";

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
  /** The interface language (HB-23); English when not given. */
  language?: string;
  /** Focus Mode (RW-18); null while it is off in Experimental. */
  focus?: { state: FocusState; duration: FocusDuration } | null;
  /**
   * NT-04: the meeting recording. `elapsed` is shown while it records; `busy` while it is
   * starting or stopping. Absent where the Notetaker is not wired in.
   */
  meeting?: { status: "idle" } | { status: "busy" } | { status: "recording"; elapsed: string };
  /** NT-29: the next calendar meeting, or null/absent when there is none or it is turned off. */
  next?: {
    eventId: string;
    /** The full title, for the menu. */
    title: string;
    /** "in 12 min", "now". */
    when: string;
    /** Whether it has a call link to join. */
    hasLink: boolean;
  } | null;
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
  | { type: "meeting-start" }
  | { type: "meeting-stop" }
  /** NT-29: opens the next meeting's call link. */
  | { type: "meeting-join"; eventId: string }
  /** NT-02: records the next meeting with its title and people. */
  | { type: "meeting-record-event"; eventId: string }
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
function focusItems(focus: NonNullable<TrayState["focus"]>, language?: string): TrayItem[] {
  if (focus.state.status !== "off") {
    return [{ kind: "item", label: tr(language, "tray.focus.off"), action: { type: "focus-off" } }];
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
      label: tr(state.language, "tray.microphone.auto"),
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
      label: tr(state.language, "tray.microphone.saved"),
      checked: true,
      enabled: false,
    });
  }
  return items;
}

function reminderItems(status: TrayState["typingReminder"], language?: string): TrayItem[] {
  if (status === "off") {
    return [
      {
        kind: "item",
        label: tr(language, "tray.reminder.on"),
        action: { type: "reminder", choice: "on" },
      },
    ];
  }
  return [
    ...(status === "snoozed"
      ? [
          { kind: "item" as const, label: tr(language, "tray.reminder.snoozed"), enabled: false },
          {
            kind: "item" as const,
            label: tr(language, "tray.reminder.resume"),
            action: { type: "reminder" as const, choice: "on" as const },
          },
        ]
      : []),
    {
      kind: "item",
      label: tr(language, "tray.reminder.hour"),
      action: { type: "reminder", choice: "hour" },
    },
    {
      kind: "item",
      label: tr(language, "tray.reminder.tomorrow"),
      action: { type: "reminder", choice: "tomorrow" },
    },
    { kind: "separator" },
    {
      kind: "item",
      label: tr(language, "tray.reminder.off"),
      action: { type: "reminder", choice: "off" },
    },
  ];
}

/** NT-04: start a meeting recording, or show the one running with a way to stop it. */
function meetingItems(meeting: NonNullable<TrayState["meeting"]>, language?: string): TrayItem[] {
  if (meeting.status === "recording") {
    return [
      {
        kind: "item",
        label: tr(language, "tray.meeting.recording").replace("{elapsed}", meeting.elapsed),
        enabled: false,
      },
      { kind: "item", label: tr(language, "tray.meeting.stop"), action: { type: "meeting-stop" } },
    ];
  }
  return [
    {
      kind: "item",
      label: tr(language, "tray.meeting.start"),
      enabled: meeting.status === "idle",
      action: { type: "meeting-start" },
    },
  ];
}

/** NT-29: the next calendar meeting, with a way to join it and to record it. */
function nextItems(
  next: NonNullable<TrayState["next"]>,
  meetingBusy: boolean,
  language?: string,
): TrayItem[] {
  return [
    {
      kind: "item",
      label: tr(language, "tray.meeting.next")
        .replace("{title}", next.title)
        .replace("{when}", next.when),
      enabled: false,
    },
    ...(next.hasLink
      ? [
          {
            kind: "item" as const,
            label: tr(language, "tray.meeting.join"),
            action: { type: "meeting-join" as const, eventId: next.eventId },
          },
        ]
      : []),
    {
      kind: "item",
      label: tr(language, "tray.meeting.recordEvent"),
      enabled: !meetingBusy,
      action: { type: "meeting-record-event", eventId: next.eventId },
    },
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
      label: tr(state.language, state.recording ? "tray.stop" : "tray.start"),
      action: { type: "toggle" },
    },
    ...(state.meeting ? meetingItems(state.meeting, state.language) : []),
    ...(state.next
      ? nextItems(
          state.next,
          state.meeting !== undefined && state.meeting.status !== "idle",
          state.language,
        )
      : []),
    { kind: "separator" },
    { kind: "item", label: tr(state.language, "tray.microphone"), submenu: microphoneItems(state) },
    {
      kind: "item",
      label: tr(state.language, "tray.languages"),
      submenu: [
        {
          kind: "item" as const,
          label: tr(state.language, "tray.languages.detect"),
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
      label: tr(state.language, "tray.copyLast"),
      enabled: state.hasLastTranscript,
      action: { type: "copy-last" },
    },
    {
      kind: "item",
      label: tr(state.language, "tray.retryLast"),
      enabled: state.canRetry,
      action: { type: "retry-last" },
    },
    {
      kind: "item",
      label: tr(state.language, "tray.reminder"),
      submenu: reminderItems(state.typingReminder, state.language),
    },
    ...(state.focus
      ? [
          {
            kind: "item" as const,
            label: tr(
              state.language,
              state.focus.state.status === "off" ? "tray.focus.start" : "tray.focus.on",
            ),
            submenu: focusItems(state.focus, state.language),
          },
        ]
      : []),
    { kind: "separator" },
    { kind: "item", label: tr(state.language, "tray.quit"), action: { type: "quit" } },
  ];
}

export function trayTooltip(status: TrayStatus, language?: string): string {
  if (status === "listening") return tr(language, "tray.tooltip.listening");
  if (status === "warning") return tr(language, "tray.tooltip.warning");
  if (status === "meeting") return tr(language, "tray.tooltip.meeting");
  return tr(language, "tray.tooltip");
}
