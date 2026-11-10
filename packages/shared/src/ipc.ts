import { z } from "zod";
import {
  permissionKindSchema,
  permissionsInfoSchema,
  requestablePermissionKindSchema,
  type PermissionKind,
  type PermissionsInfo,
  type RequestablePermissionKind,
} from "./permissions";
import { helperStatusSchema, type HelperStatus } from "./platform-helper";
import {
  capturedKeySchema,
  settingsPatchSchema,
  settingsViewSchema,
  shortcutResultSchema,
  type CapturedKey,
  type SettingsPatch,
  type SettingsView,
  type ShortcutResult,
  type ShortcutSlot,
} from "./settings";

/**
 * Renderer-to-main IPC contract. Channel names, payload schemas and the API the
 * preload exposes all live here so main, preload and renderer cannot drift.
 */

export const IPC_CHANNELS = {
  getAppInfo: "app:get-info",
  getHelperStatus: "helper:get-status",
  getPermissions: "permissions:get",
  requestPermission: "permissions:request",
  openPermissionSettings: "permissions:open-settings",
  getSettings: "settings:get",
  updateSettings: "settings:update",
  setShortcut: "settings:set-shortcut",
  captureShortcut: "settings:capture-shortcut",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const appInfoSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.string().min(1),
});

export type AppInfo = z.infer<typeof appInfoSchema>;

/** Per-channel schema for the arguments a renderer may send, and for the reply main returns. */
export const IPC_CONTRACT = {
  [IPC_CHANNELS.getAppInfo]: {
    args: z.tuple([]),
    result: appInfoSchema,
  },
  [IPC_CHANNELS.getHelperStatus]: {
    args: z.tuple([]),
    result: helperStatusSchema,
  },
  [IPC_CHANNELS.getPermissions]: {
    args: z.tuple([]),
    result: permissionsInfoSchema,
  },
  // Screen Recording and unknown kinds fail validation here, so they never reach main's logic.
  [IPC_CHANNELS.requestPermission]: {
    args: z.tuple([requestablePermissionKindSchema]),
    result: permissionsInfoSchema,
  },
  // The renderer names the permission only. Main decides which URL to open.
  [IPC_CHANNELS.openPermissionSettings]: {
    args: z.tuple([permissionKindSchema]),
    result: z.void(),
  },
  [IPC_CHANNELS.getSettings]: {
    args: z.tuple([]),
    result: settingsViewSchema,
  },
  [IPC_CHANNELS.updateSettings]: {
    args: z.tuple([settingsPatchSchema]),
    result: settingsViewSchema,
  },
  // A null key clears the slot (only hands-free can be cleared).
  [IPC_CHANNELS.setShortcut]: {
    args: z.tuple([z.enum(["hold", "handsFree"]), capturedKeySchema.nullable()]),
    result: shortcutResultSchema,
  },
  // Pauses the dictation key while the Hub records a new shortcut.
  [IPC_CHANNELS.captureShortcut]: {
    args: z.tuple([z.boolean()]),
    result: z.void(),
  },
} as const satisfies Record<IpcChannel, { args: z.ZodType; result: z.ZodType }>;

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === "string" && Object.values<string>(IPC_CHANNELS).includes(value);
}

export type IpcRequestResult =
  { ok: true; args: unknown[] } | { ok: false; reason: "unknown-channel" | "invalid-args" };

/**
 * Validates the arguments of an inbound IPC call. The failure reason never
 * includes the payload, so callers can log it without leaking content.
 */
export function parseIpcRequest(channel: unknown, args: readonly unknown[]): IpcRequestResult {
  if (!isIpcChannel(channel)) {
    return { ok: false, reason: "unknown-channel" };
  }
  const parsed = IPC_CONTRACT[channel].args.safeParse(args);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-args" };
  }
  return { ok: true, args: parsed.data as unknown[] };
}

/** The API the preload script exposes to the renderer as `window.murmur`. */
export interface MurmurApi {
  getAppInfo(): Promise<AppInfo>;
  getHelperStatus(): Promise<HelperStatus>;
  /** Re-checks every permission now and returns the result. */
  getPermissions(): Promise<PermissionsInfo>;
  /** Asks for one permission (may show a system prompt), then returns the fresh status. */
  requestPermission(kind: RequestablePermissionKind): Promise<PermissionsInfo>;
  /** Opens the System Settings pane for this permission. */
  openPermissionSettings(kind: PermissionKind): Promise<void>;
  getSettings(): Promise<SettingsView>;
  updateSettings(patch: SettingsPatch): Promise<SettingsView>;
  /** Checks and saves a captured shortcut; the result names the conflict when refused. */
  setShortcut(slot: ShortcutSlot, key: CapturedKey | null): Promise<ShortcutResult>;
  /** True while the Hub listens for a new shortcut, so the old one does not start dictation. */
  captureShortcut(active: boolean): Promise<void>;
}
