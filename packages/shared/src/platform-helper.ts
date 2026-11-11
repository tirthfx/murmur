import { z } from "zod";
import type {
  AudioDevice,
  AudioLevel,
  AudioSilent,
  AudioDevicesChanged,
  AudioRouteChanged,
  AudioStartInput,
  AudioStartResult,
  AudioStopResult,
} from "./audio";
import type { HelloPayload } from "./helper-protocol";
import type { ContextSnapshotInput, FocusContext } from "./context";
import type { TypingActivity } from "./typing";
import type { InsertTextInput, InsertTextResult } from "./insert";
import type {
  SpeechModelLoadInput,
  SpeechModelLoadResult,
  TranscribeFileInput,
  Transcript,
} from "./speech";
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
  /**
   * Starts a microphone session. The helper only reads the microphone permission; if it is
   * not granted this rejects with PERMISSION_DENIED and nothing is prompted. One session at
   * a time (BUSY otherwise). Audio stays in the helper and is written to a file.
   */
  startAudio(input: AudioStartInput): Promise<AudioStartResult>;
  /** Connected input devices. Needs no permission. */
  listAudioDevices(): Promise<AudioDevice[]>;
  /** Ends the session and returns its statistics and file reference. */
  stopAudio(sessionId: string): Promise<AudioStopResult>;
  /** Ends the session and deletes its file. */
  cancelAudio(sessionId: string): Promise<{ discarded: boolean }>;
  onAudioLevel(handler: (level: AudioLevel) => void): Unsubscribe;
  onAudioSilent(handler: (silent: AudioSilent) => void): Unsubscribe;
  /** The connected inputs changed. Works without a session and needs no permission. */
  onAudioDevicesChanged(handler: (change: AudioDevicesChanged) => void): Unsubscribe;
  /** A running session moved to another input. */
  onAudioRouteChanged(handler: (change: AudioRouteChanged) => void): Unsubscribe;
  /** Loads a speech model from local folders. The first load can take minutes. */
  loadSpeechModel(input: SpeechModelLoadInput): Promise<SpeechModelLoadResult>;
  unloadSpeechModel(): Promise<void>;
  /** Transcribes a recorded file on the device. No network is used. */
  transcribeFile(input: TranscribeFileInput): Promise<Transcript>;
  /**
   * Inserts text into the focused field: paste with the clipboard restored afterwards, or
   * typed when paste is not handled. Needs Accessibility; rejects with PERMISSION_DENIED
   * without prompting when it is missing.
   */
  insertText(input: InsertTextInput): Promise<InsertTextResult>;
  /** Puts text on the clipboard. Needs no permission. */
  copyText(text: string): Promise<void>;
  /**
   * The focused field around the caret. Needs Accessibility; rejects with PERMISSION_DENIED
   * without prompting when it is missing. Secure fields come back with no text.
   */
  focusContext(input?: ContextSnapshotInput): Promise<FocusContext>;
  /** Turns typed-word counting on or off (DC-08). Counts only, never characters. */
  watchTyping(enabled: boolean): Promise<void>;
  onTypingActivity(handler: (activity: TypingActivity) => void): Unsubscribe;
  /** The output's mute switch: null when there is none. */
  getOutputMuted(): Promise<boolean | null>;
  /** Sets the output mute and returns what it was before. */
  setOutputMuted(muted: boolean): Promise<boolean>;
  getStatus(): HelperStatus;
  onStatusChange(handler: (status: HelperStatus) => void): Unsubscribe;
}
