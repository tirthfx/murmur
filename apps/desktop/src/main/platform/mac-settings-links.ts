import type { PermissionKind } from "@murmur/shared";

/**
 * Where each permission lives in System Settings. This is a fixed allow-list: the renderer
 * only ever names a permission, and the URL comes from this table. Nothing is built from
 * input, so no other URL can be opened through this path.
 */
const PANES: Readonly<Record<PermissionKind, string>> = {
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  inputMonitoring: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
  screenRecording: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
};

/** The Settings URL for a permission, or null for a name that is not on the list. */
export function permissionSettingsUrl(kind: unknown): string | null {
  if (typeof kind !== "string" || !Object.hasOwn(PANES, kind)) return null;
  return PANES[kind as PermissionKind];
}

/** Every URL this module can return. Exposed for tests. */
export function allPermissionSettingsUrls(): string[] {
  return Object.values(PANES);
}
