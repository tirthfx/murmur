import {
  makePrimary,
  SETTINGS_CLEANUP_LEVELS,
  SPEECH_LANGUAGES,
  translate,
  type AudioDevice,
  type CatalogueKey,
  type Settings,
} from "@murmur/shared";
import { reminderItems, type MenuRow, type TrayState } from "../tray/tray-menu";
import type { SessionChoices } from "./next-session";

export interface BarMenuState {
  /** The settings the next dictation will use, one-time choices included. */
  settings: Settings;
  /** Null when the helper could not list them. */
  devices: AudioDevice[] | null;
  /** The device the next dictation records from; null is the system default. */
  deviceId: string | null;
  /** A one-time choice waits. */
  pending: boolean;
  typingReminder: TrayState["typingReminder"];
}

export type BarMenuAction =
  | { type: "choose"; change: SessionChoices }
  | { type: "save" }
  | { type: "reminder"; choice: "hour" | "tomorrow" | "off" | "on" };

/** The Bar's right-click menu (DC-46): what the next dictation uses, with quick switches. */
export function barMenu(state: BarMenuState): MenuRow<BarMenuAction>[] {
  const { settings } = state;
  const language = settings.language;
  const tr = (key: CatalogueKey, name = "") => translate(language, key).replace("{name}", name);
  const devices = state.devices ?? [];
  const using =
    devices.find((device) => device.id === state.deviceId) ??
    devices.find((device) => device.isDefault);
  const choose = (change: SessionChoices): BarMenuAction => ({ type: "choose", change });
  const primary = SPEECH_LANGUAGES.find((entry) => entry.code === settings.languages[0]);

  const microphones: MenuRow<BarMenuAction>[] = [
    {
      kind: "item",
      label: tr("tray.microphone.auto"),
      checked: settings.inputDevice === "auto",
      action: choose({ inputDevice: "auto" }),
    },
    ...devices.map((device) => ({
      kind: "item" as const,
      label: device.name,
      checked: settings.inputDevice === device.id,
      action: choose({ inputDevice: device.id }),
    })),
  ];
  const languages: MenuRow<BarMenuAction>[] = [
    {
      kind: "item",
      label: tr("tray.languages.detect"),
      checked: settings.languages.length === 0,
      action: choose({ languages: [] }),
    },
    ...SPEECH_LANGUAGES.map((entry) => ({
      kind: "item" as const,
      label: entry.label,
      checked: settings.languages[0] === entry.code,
      action: choose({ languages: makePrimary(settings.languages, entry.code) }),
    })),
  ];
  const levels: MenuRow<BarMenuAction>[] = SETTINGS_CLEANUP_LEVELS.map((level) => ({
    kind: "item",
    label: tr(`barMenu.cleanup.${level}`),
    checked: settings.cleanupLevel === level,
    action: choose({ cleanupLevel: level }),
  }));

  return [
    {
      kind: "item",
      label: tr("barMenu.microphoneNow", using?.name ?? tr("barMenu.systemDefault")),
      submenu: microphones,
    },
    {
      kind: "item",
      label: tr("barMenu.language", primary?.label ?? tr("tray.languages.detect")),
      submenu: languages,
    },
    {
      kind: "item",
      label: tr("barMenu.cleanup", tr(`barMenu.cleanup.${settings.cleanupLevel}`)),
      submenu: levels,
    },
    { kind: "separator" },
    ...(state.pending
      ? [
          { kind: "item" as const, label: tr("barMenu.once"), enabled: false },
          { kind: "item" as const, label: tr("barMenu.save"), action: { type: "save" as const } },
          { kind: "separator" as const },
        ]
      : []),
    {
      kind: "item",
      label: tr("tray.reminder"),
      // The reminder's own actions are the tray's; only its choices are used here.
      submenu: reminderItems(state.typingReminder, language) as unknown as MenuRow<BarMenuAction>[],
    },
  ];
}
