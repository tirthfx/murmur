import { z } from "zod";

/**
 * Permissions the app asks the OS for. The names are generic on purpose: each platform
 * helper maps them to its own mechanism, and nothing here says how a platform does it.
 */

export const PERMISSION_KINDS = [
  "microphone",
  "accessibility",
  "inputMonitoring",
  "screenRecording",
] as const;
export type PermissionKind = (typeof PERMISSION_KINDS)[number];
export const permissionKindSchema = z.enum(PERMISSION_KINDS);

/** Kinds a user click may request. Screen Recording is status only in this milestone. */
export const REQUESTABLE_PERMISSION_KINDS = [
  "microphone",
  "accessibility",
  "inputMonitoring",
] as const;
export type RequestablePermissionKind = (typeof REQUESTABLE_PERMISSION_KINDS)[number];
export const requestablePermissionKindSchema = z.enum(REQUESTABLE_PERMISSION_KINDS);

export function isRequestablePermissionKind(value: unknown): value is RequestablePermissionKind {
  return requestablePermissionKindSchema.safeParse(value).success;
}

/**
 * `not_determined` means the user was never asked. `unknown` means the OS does not report
 * a clean state for this permission, or no status could be read at all.
 */
export const PERMISSION_STATUS_VALUES = ["granted", "denied", "not_determined", "unknown"] as const;
export type PermissionStatus = (typeof PERMISSION_STATUS_VALUES)[number];
export const permissionStatusSchema = z.enum(PERMISSION_STATUS_VALUES);

/** One status per kind. */
export const permissionSnapshotSchema = z.object({
  microphone: permissionStatusSchema,
  accessibility: permissionStatusSchema,
  inputMonitoring: permissionStatusSchema,
  screenRecording: permissionStatusSchema,
});
export type PermissionSnapshot = z.infer<typeof permissionSnapshotSchema>;

/** Result of a `permissions.request` call. */
export const permissionRequestResultSchema = z.object({
  /** Status at the moment the request returned. A prompt may still be on screen. */
  status: permissionStatusSchema,
  openedSettings: z.boolean(),
});
export type PermissionRequestResult = z.infer<typeof permissionRequestResultSchema>;

/** What main tells the Hub: the statuses plus a message when they could not be read. */
export const permissionsInfoSchema = z.strictObject({
  statuses: permissionSnapshotSchema,
  /** Set when the statuses are placeholders because the helper could not answer. */
  message: z.string().nullable(),
});
export type PermissionsInfo = z.infer<typeof permissionsInfoSchema>;

export function unknownPermissionSnapshot(): PermissionSnapshot {
  return {
    microphone: "unknown",
    accessibility: "unknown",
    inputMonitoring: "unknown",
    screenRecording: "unknown",
  };
}
