import { z } from "zod";
import type { HelloPayload } from "./helper-protocol";
import type { HotkeyBinding, HotkeyConfigureResult, HotkeyEvent, HotkeyTapStatus } from "./hotkeys";
import type { PermissionKind, PermissionRequestResult, PermissionSnapshot } from "./permissions";

/**
 * The seam between the app and the native helper. The rest of the app depends on this
 * interface only; each OS supplies an implementation (the Mac one launches the Swift helper).
 * It grows as helper capabilities land: permissions, hotkeys, audio and so on.
 */

/** Lifecycle of the helper as the app sees it. */
export const HELPER_STATES = ["stopped", "starting", "ready", "error", "unavailable"] as const;
export type HelperState = (typeof HELPER_STATES)[number];

/** `unavailable` means there is no helper to run (binary missing, unsupported platform). */
export const helperStatusSchema = z.strictObject({
  state: z.enum(HELPER_STATES),
  helperVersion: z.string().min(1).nullable(),
  message: z.string().nullable(),
});

export type HelperStatus = z.infer<typeof helperStatusSchema>;

export type Unsubscribe = () => void;

export interface PlatformHelper {
  /**
   * Starts the helper under supervision. Resolves with its hello info once the handshake
   * succeeds, and rejects if the helper cannot be used (missing binary, protocol mismatch,
   * restart limit reached).
   */
  start(): Promise<HelloPayload>;
  /** Asks the helper to stop and waits until it has, killing it if it does not. */
  shutdown(reason: string): Promise<void>;
  /** Kills the helper at once without waiting. Last-resort cleanup when the process is exiting. */
  terminate(): void;
  /** Round trip to the helper. Resolves with its uptime in milliseconds. */
  ping(): Promise<{ uptimeMs: number }>;
  /** Reads the current status of every permission. Never prompts. */
  checkPermissions(): Promise<PermissionSnapshot>;
  /**
   * Asks the OS to grant one permission, which may show a system prompt. Only call this
   * from a user click. Rejects for kinds that cannot be requested.
   */
  requestPermission(kind: PermissionKind): Promise<PermissionRequestResult>;
  /**
   * Replaces every hotkey binding in the running helper. The helper listens to keys only
   * while at least one binding is set, and never asks for a permission to do so. Bindings
   * are lost when the helper restarts, so callers configure again on each `ready`.
   */
  configureHotkeys(bindings: HotkeyBinding[]): Promise<HotkeyConfigureResult>;
  onHotkeyEvent(handler: (event: HotkeyEvent) => void): Unsubscribe;
  onHotkeyTapStatus(handler: (status: HotkeyTapStatus) => void): Unsubscribe;
  getStatus(): HelperStatus;
  onStatusChange(handler: (status: HelperStatus) => void): Unsubscribe;
}
