import {
  REWRITE_PANEL_BINDING_ID,
  SHORTCUT_SLOTS,
  planAllows,
  type AudioDevice,
  type CapturedKey,
  type HotkeyBinding,
  type Settings,
  type SettingsPatch,
  type SettingsView,
  type ShortcutResult,
  type ShortcutSlot,
} from "@murmur/shared";
import { SLOT_FIELD, type SettingsStore } from "./settings-store";
import {
  checkShortcut,
  sameTrigger,
  SLOT_NAMES,
  type KeyPlatform,
  type UsedShortcut,
} from "./shortcuts";

export interface SettingsServiceDeps {
  store: SettingsStore;
  platform: KeyPlatform;
  listDevices: () => Promise<AudioDevice[]>;
  /** What each shortcut returns to (DC-06). Without it there is nothing to reset to. */
  defaults?: Settings;
  /** Binding ids the helper refused at the last configuration. */
  rejected?: () => string[];
  /** Other shortcuts Murmur binds (named Rewrite shortcuts), so a slot cannot take one. */
  otherShortcuts?: () => UsedShortcut[];
}

export interface SettingsService {
  view(): Promise<SettingsView>;
  update(patch: SettingsPatch): Promise<SettingsView>;
  setShortcut(slot: ShortcutSlot, key: CapturedKey | null): Promise<ShortcutResult>;
  /** HB-12: puts settings back to their defaults. */
  reset(keys: readonly (keyof Settings)[]): Promise<SettingsView>;
  /** Back to the default for one shortcut, or for all of them (DC-06). */
  resetShortcuts(slot: ShortcutSlot | "all"): Promise<ShortcutResult>;
}

/** The helper's binding id for each shortcut. */
const BINDING_SLOTS: Record<string, ShortcutSlot> = {
  "dictate-hold": "hold",
  "dictate-toggle": "handsFree",
  "rewrite-panel": "rewrite",
  "command-mode": "command",
  "instruct-mode": "instruct",
  "focus-toggle": "focus",
  "scratchpad-open": "scratchpad",
  "meeting-toggle": "meeting",
  "copy-last": "copyLast",
  "paste-last": "pasteLast",
  "press-enter": "pressEnter",
  "meeting-recap": "recap",
};

/**
 * The hotkey bindings the settings ask for. Hands-free is a press binding when set, and the
 * cancel key (Escape) is always bound; main ignores it unless a dictation is running.
 */
export function bindingsFor(
  settings: Settings,
  cancelKeyCode: number | null = null,
): HotkeyBinding[] {
  const bindings: HotkeyBinding[] = [
    // Exclusive: another key while it is held ends the dictation (DC-02).
    {
      id: "dictate-hold",
      action: "dictate.hold",
      trigger: settings.holdShortcut,
      mode: "hold",
      exclusive: true,
    },
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
  // Command Mode and Focus Mode are on Pro and up (RW-22).
  if (
    settings.experimental.commandMode &&
    settings.commandShortcut &&
    planAllows(settings.plan, "commandMode")
  ) {
    bindings.push({
      id: "command-mode",
      action: "command.mode",
      trigger: settings.commandShortcut,
      mode: "hold",
      exclusive: true,
    });
  }
  if (settings.instructShortcut) {
    bindings.push({
      id: "instruct-mode",
      action: "instruct.mode",
      trigger: settings.instructShortcut,
      mode: "hold",
    });
  }
  // Focus Mode (RW-18, experimental): a press turns it on or off.
  if (
    settings.experimental.focusMode &&
    settings.focusShortcut &&
    planAllows(settings.plan, "focusMode")
  ) {
    bindings.push({
      id: "focus-toggle",
      action: "focus.toggle",
      trigger: settings.focusShortcut,
      mode: "press",
    });
  }
  // Scratchpad (HB-26, HB-34): a press opens its window; nothing while Scratchpad is off.
  if (settings.scratchpad.enabled && settings.scratchpadShortcut) {
    bindings.push({
      id: "scratchpad-open",
      action: "scratchpad.open",
      trigger: settings.scratchpadShortcut,
      mode: "press",
    });
  }
  // Notetaker (NT-03): a press starts a meeting recording, and the next one stops it.
  if (settings.meetingShortcut) {
    bindings.push({
      id: "meeting-toggle",
      action: "notetaker.start",
      trigger: settings.meetingShortcut,
      mode: "press",
    });
  }
  // DC-39. After the others, so a shortcut the person gave something else keeps working.
  if (settings.copyLastShortcut) {
    bindings.push({
      id: "copy-last",
      action: "copy.last",
      trigger: settings.copyLastShortcut,
      mode: "press",
    });
  }
  if (settings.pasteLastShortcut) {
    bindings.push({
      id: "paste-last",
      action: "paste.last",
      trigger: settings.pasteLastShortcut,
      mode: "press",
    });
  }
  if (settings.pressEnterShortcut) {
    bindings.push({
      id: "press-enter",
      action: "press.enter",
      trigger: settings.pressEnterShortcut,
      mode: "press",
    });
  }
  // DC-04: the extra mouse buttons that act on a press.
  for (const [button, id, action] of [
    [settings.mouseButtons.pressEnter, "press-enter-mouse", "press.enter"],
    [settings.mouseButtons.copyLast, "copy-last-mouse", "copy.last"],
  ] as const) {
    if (button === null || button === undefined) continue;
    bindings.push({ id, action, trigger: { type: "mouse", button }, mode: "press" });
  }
  // NT-13: the recap of the meeting being recorded.
  if (settings.recapShortcut) {
    bindings.push({
      id: "meeting-recap",
      action: "notetaker.recap",
      trigger: settings.recapShortcut,
      mode: "press",
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

  /** The settings that differ from their defaults. */
  const changed = (settings: Settings): string[] => {
    const { defaults } = deps;
    if (!defaults) return [];
    return (Object.keys(defaults) as (keyof Settings)[]).filter(
      (key) => JSON.stringify(settings[key]) !== JSON.stringify(defaults[key]),
    );
  };

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
        instruct: settings.instructShortcut ? platform.label(settings.instructShortcut) : "Off",
        focus: settings.focusShortcut ? platform.label(settings.focusShortcut) : "Off",
        scratchpad: settings.scratchpadShortcut
          ? platform.label(settings.scratchpadShortcut)
          : "Off",
        meeting: settings.meetingShortcut ? platform.label(settings.meetingShortcut) : "Off",
        copyLast: settings.copyLastShortcut ? platform.label(settings.copyLastShortcut) : "Off",
        pasteLast: settings.pasteLastShortcut ? platform.label(settings.pasteLastShortcut) : "Off",
        pressEnter: settings.pressEnterShortcut
          ? platform.label(settings.pressEnterShortcut)
          : "Off",
        recap: settings.recapShortcut ? platform.label(settings.recapShortcut) : "Off",
      },
      unavailable: (deps.rejected?.() ?? []).flatMap((id) => BINDING_SLOTS[id] ?? []),
      devices,
      changed: changed(settings),
    };
  }

  return {
    view,
    async update(patch) {
      store.update(patch);
      return view();
    },
    async reset(keys) {
      const { defaults } = deps;
      if (defaults) {
        const patch = Object.fromEntries(keys.map((key) => [key, defaults[key]]));
        store.update(patch as SettingsPatch);
      }
      return view();
    },
    async resetShortcuts(slot) {
      const defaults = deps.defaults;
      if (!defaults) return { ok: false, message: "There is nothing to reset to." };
      const slots = slot === "all" ? SHORTCUT_SLOTS : [slot];
      const current = store.get();
      if (slot !== "all") {
        const wanted = defaults[SLOT_FIELD[slot]];
        const holder = SHORTCUT_SLOTS.find((other) => {
          const trigger = current[SLOT_FIELD[other]];
          return other !== slot && wanted && trigger && sameTrigger(trigger, wanted);
        });
        if (holder) {
          return {
            ok: false,
            message: `The default is in use for ${SLOT_NAMES[holder]}. Change that one first.`,
          };
        }
      }
      for (const each of slots) store.setShortcut(each, defaults[SLOT_FIELD[each]]);
      return { ok: true, view: await view() };
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
          instruct: settings.instructShortcut,
          focus: settings.focusShortcut,
          scratchpad: settings.scratchpadShortcut,
          meeting: settings.meetingShortcut,
          copyLast: settings.copyLastShortcut,
          pasteLast: settings.pasteLastShortcut,
          pressEnter: settings.pressEnterShortcut,
          recap: settings.recapShortcut,
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
