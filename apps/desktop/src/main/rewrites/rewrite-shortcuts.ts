import type {
  CapturedKey,
  HotkeyBinding,
  Rewrite,
  RewriteShortcutResult,
  Settings,
} from "@murmur/shared";
import {
  checkTrigger,
  SLOT_NAMES,
  type KeyPlatform,
  type UsedShortcut,
} from "../settings/shortcuts";
import { decodeTrigger, type RewriteStore } from "./rewrite-store";

/** How a refusal names a Rewrite's shortcut. */
const useOf = (rewrite: Rewrite) => `the “${rewrite.name}” Rewrite`;

/** Helper bindings for the enabled Rewrites that have their own shortcut (RW-04). */
export function rewriteBindings(rewrites: readonly Rewrite[]): HotkeyBinding[] {
  return rewrites.flatMap((rewrite) => {
    const trigger = rewrite.enabled ? decodeTrigger(rewrite.shortcut) : null;
    return trigger
      ? [
          {
            id: `rewrite:${rewrite.id}`.slice(0, 64),
            action: "rewrite" as const,
            trigger,
            mode: "press" as const,
            rewriteId: rewrite.id,
          },
        ]
      : [];
  });
}

/** Every Rewrite's shortcut, for refusing a Settings slot that would clash with one. */
export function rewriteShortcutsInUse(
  rewrites: readonly Rewrite[],
  exceptId?: string,
): UsedShortcut[] {
  return rewrites.flatMap((rewrite) => {
    const trigger = rewrite.id === exceptId ? null : decodeTrigger(rewrite.shortcut);
    return trigger ? [{ use: useOf(rewrite), trigger }] : [];
  });
}

/** The Settings slots' shortcuts, named as in Settings. */
export function slotShortcutsInUse(settings: Settings): UsedShortcut[] {
  const slots: [keyof typeof SLOT_NAMES, Settings["holdShortcut"] | null][] = [
    ["hold", settings.holdShortcut],
    ["handsFree", settings.handsFreeShortcut],
    ["rewrite", settings.rewriteShortcut],
  ];
  return slots.flatMap(([slot, trigger]) => (trigger ? [{ use: SLOT_NAMES[slot], trigger }] : []));
}

/** Readable shortcut names for the Hub. */
export function withShortcutLabels(rewrites: readonly Rewrite[], platform: KeyPlatform): Rewrite[] {
  return rewrites.map((rewrite) => {
    const trigger = decodeTrigger(rewrite.shortcut);
    return { ...rewrite, shortcutLabel: trigger ? platform.label(trigger) : null };
  });
}

export interface SetRewriteShortcutDeps {
  store: Pick<RewriteStore, "get" | "list" | "setShortcut">;
  settings: () => Settings;
  platform: KeyPlatform;
}

/** Checks a captured key against every other shortcut and saves it; null removes it. */
export function setRewriteShortcut(
  deps: SetRewriteShortcutDeps,
  id: string,
  key: CapturedKey | null,
): RewriteShortcutResult {
  if (!deps.store.get(id)) return { ok: false, message: "This Rewrite no longer exists." };
  if (key === null) return deps.store.setShortcut(id, null);
  const used = [
    ...slotShortcutsInUse(deps.settings()),
    ...rewriteShortcutsInUse(deps.store.list(), id),
  ];
  const checked = checkTrigger(key, used, deps.platform, true);
  if (!checked.ok) return checked;
  return deps.store.setShortcut(id, checked.trigger);
}
