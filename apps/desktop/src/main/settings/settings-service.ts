import {
  REWRITE_PANEL_BINDING_ID,
  type AudioDevice,
  type CapturedKey,
  type HotkeyBinding,
  type Settings,
  type SettingsPatch,
  type SettingsView,
  type ShortcutResult,
  type ShortcutSlot,
} from "@murmur/shared";
import type { SettingsStore } from "./settings-store";
import { checkShortcut, type KeyPlatform, type UsedShortcut } from "./shortcuts";

export interface SettingsServiceDeps {
  store: SettingsStore;
  platform: KeyPlatform;
  listDevices: () => Promise<AudioDevice[]>;
  /** Other shortcuts Murmur binds (named Rewrite shortcuts), so a slot cannot take one. */
  otherShortcuts?: () => UsedShortcut[];
}

export interface SettingsService {
  view(): Promise<SettingsView>;
  update(patch: SettingsPatch): Promise<SettingsView>;
  setShortcut(slot: ShortcutSlot, key: CapturedKey | null): Promise<ShortcutResult>;
}

/**
 * The hotkey bindings the settings ask for. Hands-free is a press binding when set, and the
 * cancel key (Escape) is always bound; main ignores it unless a dictation is running.
 */
export function bindingsFor(
  settings: Settings,
  cancelKeyCode: number | null = null,
): HotkeyBinding[] {
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
  if (settings.mouseButtons.hold !== null) {
    bindings.push({
      id: "dictate-hold-mouse",
      action: "dictate.hold",
      trigger: { type: "mouse", button: settings.mouseButtons.hold },
      mode: "hold",
    });
  }
  if (settings.mouseButtons.handsFree !== null) {
    bindings.push({
      id: "dictate-toggle-mouse",
      action: "dictate.toggle",
      trigger: { type: "mouse", button: settings.mouseButtons.handsFree },
      mode: "press",
    });
  }
  if (settings.rewriteShortcut) {
    bindings.push({
      id: "rewrite-panel",
      action: "rewrite",
      trigger: settings.rewriteShortcut,
      mode: "press",
      rewriteId: REWRITE_PANEL_BINDING_ID,
    });
  }
  // Command Mode (RW-08, experimental): exclusive, so Command+C never starts it.
  if (settings.experimental.commandMode && settings.commandShortcut) {
    bindings.push({
      id: "command-mode",
      action: "command.mode",
      trigger: settings.commandShortcut,
      mode: "hold",
      exclusive: true,
    });
  }
  if (cancelKeyCode !== null) {
    bindings.push({
      id: "dictate-cancel",
      action: "dictate.cancel",
      trigger: { type: "key", keyCode: cancelKeyCode, modifiers: [] },
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
/**
 * Codes for the speech model, in order; empty means detect. The Hindi-in-Latin profile is
 * recognised as Hindi or English and written in Latin letters afterwards.
 */
export function languagesFor(settings: Settings): string[] {
  const codes = settings.languages.flatMap((code) => (code === "hi-Latn" ? ["hi", "en"] : [code]));
  return [...new Set(codes)];
}

/** Whether Devanagari in the text should be written in Latin letters. */
export function wantsLatinHindi(settings: Settings): boolean {
  return settings.languages.includes("hi-Latn");
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
        rewrite: settings.rewriteShortcut ? platform.label(settings.rewriteShortcut) : "Off",
        command: settings.commandShortcut ? platform.label(settings.commandShortcut) : "Off",
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
        {
          hold: settings.holdShortcut,
          handsFree: settings.handsFreeShortcut,
          rewrite: settings.rewriteShortcut,
          command: settings.commandShortcut,
        },
        platform,
        deps.otherShortcuts?.() ?? [],
      );
      if (!result.ok) return result;
      store.setShortcut(slot, result.trigger);
      return { ok: true, view: await view() };
    },
  };
}
