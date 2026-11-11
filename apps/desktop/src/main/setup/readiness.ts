import type { DictationBlocker, HelperStatus, PermissionSnapshot } from "@murmur/shared";
import type { SpeechState } from "../speech/speech-service";

export interface ReadinessInput {
  helper: HelperStatus["state"];
  /** Null before the first check. */
  permissions: PermissionSnapshot | null;
  speech: SpeechState;
}

const REQUIRED = ["microphone", "accessibility", "inputMonitoring"] as const;

/**
 * What still blocks dictation (DC-44): the helper, the three permissions and a loaded speech
 * model. A permission whose status cannot be read ("unknown") is not counted, so a status the
 * OS will not report never locks the user out; the recording itself then decides.
 */
export function dictationBlockers(input: ReadinessInput): DictationBlocker[] {
  const blockers: DictationBlocker[] = [];
  if (input.helper !== "ready") blockers.push("helper");
  for (const kind of REQUIRED) {
    const status = input.permissions?.[kind] ?? "unknown";
    if (status === "denied" || status === "not_determined") blockers.push(kind);
  }
  if (input.speech !== "ready") blockers.push("speechModel");
  return blockers;
}

export function hasPermissionBlocker(blockers: readonly DictationBlocker[]): boolean {
  return blockers.some((blocker) => (REQUIRED as readonly string[]).includes(blocker));
}
