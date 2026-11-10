import {
  REQUESTABLE_PERMISSION_KINDS,
  type PermissionKind,
  type PermissionStatus,
} from "@murmur/shared";

export interface PermissionCopy {
  title: string;
  /** Why Murmur needs it, in plain words. */
  reason: string;
}

export const PERMISSION_COPY: Readonly<Record<PermissionKind, PermissionCopy>> = {
  microphone: {
    title: "Microphone",
    reason: "Lets Murmur hear your voice so it can turn what you say into text.",
  },
  accessibility: {
    title: "Accessibility",
    reason:
      "Lets Murmur see which app and text field you are working in, and type or paste your words there.",
  },
  inputMonitoring: {
    title: "Input Monitoring",
    reason:
      "Lets Murmur notice your dictation shortcut while another app is in front. Without it the shortcut only works inside Murmur.",
  },
  screenRecording: {
    title: "Screen Recording",
    reason:
      "Only needed to capture the sound other apps play during a meeting. macOS lists it as Screen & System Audio Recording. Murmur does not ask for it yet.",
  },
};

/** Order the rows appear in. */
export const PERMISSION_ORDER: readonly PermissionKind[] = [
  "microphone",
  "accessibility",
  "inputMonitoring",
  "screenRecording",
];

export const STATUS_LABEL: Readonly<Record<PermissionStatus, string>> = {
  granted: "Granted",
  denied: "Not granted",
  not_determined: "Not asked yet",
  unknown: "Unknown",
};

export const STATUS_BADGE_VARIANT: Readonly<
  Record<PermissionStatus, "success" | "warning" | "neutral">
> = {
  granted: "success",
  denied: "warning",
  not_determined: "neutral",
  unknown: "neutral",
};

export function canRequest(kind: PermissionKind): boolean {
  return (REQUESTABLE_PERMISSION_KINDS as readonly string[]).includes(kind);
}
