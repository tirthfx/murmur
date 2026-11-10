import type {
  AudioDevice,
  CapturedKey,
  HotkeyBinding,
  Settings,
  SettingsPatch,
  SettingsView,
  ShortcutResult,
  ShortcutSlot,
} from "@murmur/shared";
import type { SettingsStore } from "./settings-store";
import { checkShortcut, type KeyPlatform } from "./shortcuts";

export interface SettingsServiceDeps {
  store: SettingsStore;
  platform: KeyPlatform;
  listDevices: () => Promise<AudioDevice[]>;
}

export interface SettingsService {
  view(): Promise<SettingsView>;
  update(patch: SettingsPatch): Promise<SettingsView>;
  setShortcut(slot: ShortcutSlot, key: CapturedKey | null): Promise<ShortcutResult>;
}

/** The hotkey bindings the settings ask for. Hands-free is a press binding when set. */
export function bindingsFor(settings: Settings): HotkeyBinding[] {
  const bindings: HotkeyBinding[] = [
    { id: "dictate-hold", action: "dictate.hold", trigger: settings.holdShortcut, mode: "hold" },
  ];
  if (settings.handsFreeShortcut) {
    bindings.push({
      id: "dictate-toggle",
      action: "dictate.toggle",
      trigger: settings.handsFreeShortcut,
      mode: "press",
    });
  }
  return bindings;
}

/** The input device to ask the helper for: null means the system default. */
export function deviceFor(settings: Settings): string | null {
  return settings.inputDevice === "auto" ? null : settings.inputDevice;
}

/** Languages sent to the speech model: fixed mode sends exactly one. */
export function languagesFor(settings: Settings): string[] {
  return settings.language === "auto" ? [] : [settings.language];
}

export function createSettingsService(deps: SettingsServiceDeps): SettingsService {
  const { store, platform } = deps;

  async function view(): Promise<SettingsView> {
    const settings = store.get();
    const hold = platform.label(settings.holdShortcut);
    let devices: AudioDevice[] | null = null;
    try {
      devices = await deps.listDevices();
    } catch {
      // The helper is not running; the page shows the saved choice only.
    }
    return {
      settings,
      shortcutLabels: {
        hold,
        handsFree: settings.handsFreeShortcut
          ? platform.label(settings.handsFreeShortcut)
          : `Double-tap ${hold}`,
      },
      devices,
    };
  }

  return {
    view,
    async update(patch) {
      store.update(patch);
      return view();
    },
    async setShortcut(slot, key) {
      if (key === null) {
        if (slot === "hold") return { ok: false, message: "Push to talk always needs a key." };
        store.setShortcut(slot, null);
        return { ok: true, view: await view() };
      }
      const settings = store.get();
      const result = checkShortcut(
        key,
        slot,
        { hold: settings.holdShortcut, handsFree: settings.handsFreeShortcut },
        platform,
      );
      if (!result.ok) return result;
      store.setShortcut(slot, result.trigger);
      return { ok: true, view: await view() };
    },
  };
}
