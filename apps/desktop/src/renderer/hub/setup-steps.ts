import type { DictationBlocker, PermissionKind, SpeechModelStatus } from "@murmur/shared";

/** First-run setup, in order (DC-44). */
export const SETUP_STEPS = [
  "welcome",
  "microphone",
  "accessibility",
  "inputMonitoring",
  "model",
  "shortcut",
  "try",
  "done",
] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number];

export const STEP_TITLES: Readonly<Record<SetupStepId, string>> = {
  welcome: "Welcome to Murmur",
  microphone: "Microphone",
  accessibility: "Accessibility",
  inputMonitoring: "Input Monitoring",
  model: "Speech model",
  shortcut: "Dictation shortcut",
  try: "Try it",
  done: "All set",
};

const PERMISSION_STEPS: readonly SetupStepId[] = ["microphone", "accessibility", "inputMonitoring"];

export function isPermissionStep(step: SetupStepId): step is Extract<SetupStepId, PermissionKind> {
  return PERMISSION_STEPS.includes(step);
}

/** "648 MB", "2.5 GB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

/** Download progress from 0 to 100. */
export function modelProgress(status: SpeechModelStatus): number {
  if (status.totalBytes === 0) return 0;
  return Math.min(100, Math.floor((status.downloadedBytes / status.totalBytes) * 100));
}

const BLOCKER_LABEL: Readonly<Record<DictationBlocker, string>> = {
  helper: "The helper is not running.",
  microphone: "Microphone access is not granted.",
  accessibility: "Accessibility access is not granted.",
  inputMonitoring: "Input Monitoring access is not granted.",
  speechModel: "The speech model is not downloaded or still loading.",
};

/** One sentence per missing piece, for the Try it and All set steps. */
export function blockerLines(blockers: readonly DictationBlocker[]): string[] {
  return blockers.map((blocker) => BLOCKER_LABEL[blocker]);
}
