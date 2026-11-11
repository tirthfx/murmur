import { SPEECH_LANGUAGES, type AudioDevice, type SpeechLanguage } from "@murmur/shared";

/** What the menu bar icon shows next to the microphone. */
export type TrayStatus = "idle" | "listening" | "warning";

export interface TrayState {
  recording: boolean;
  status: TrayStatus;
  /** Null until the first device list arrives, or when the helper is not running. */
  devices: AudioDevice[] | null;
  /** "auto" or a device id. */
  inputDevice: string;
  language: SpeechLanguage;
  hasLastTranscript: boolean;
}

export type TrayAction =
  | { type: "toggle" }
  | { type: "device"; id: string }
  | { type: "language"; code: SpeechLanguage }
  | { type: "copy-last" }
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
      submenu: SPEECH_LANGUAGES.map((language) => ({
        kind: "item" as const,
        label: language.label,
        checked: state.language === language.code,
        action: { type: "language" as const, code: language.code },
      })),
    },
    { kind: "separator" },
    {
      kind: "item",
      label: "Copy last transcript",
      enabled: state.hasLastTranscript,
      action: { type: "copy-last" },
    },
    { kind: "separator" },
    { kind: "item", label: "Quit Murmur", action: { type: "quit" } },
  ];
}

export function trayTooltip(status: TrayStatus): string {
  if (status === "listening") return "Murmur: listening";
  if (status === "warning") return "Murmur: the last dictation had a problem";
  return "Murmur";
}
