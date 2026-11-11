import type { RecorderEvent } from "../recorder";
import type { BarEvent } from "./bar-machine";

/** What the Bar shows for each step of a dictation. */
export function barEventFor(event: RecorderEvent): BarEvent {
  switch (event.type) {
    case "started":
      return { type: "start", at: event.at };
    case "locked":
      return { type: "lock" };
    case "cancelled":
      return { type: "cancel" };
    case "start-failed":
      return { type: "warn", message: event.message };
    case "stopped":
      return { type: "stop" };
    case "silent-mic":
      return { type: "warn", message: `No sound from ${event.deviceName}` };
    case "no-speech":
      return { type: "warn", message: "No speech detected" };
    case "stop-failed":
      return { type: "warn", message: "The recording could not be saved" };
    case "transcribed":
      return { type: "transcribed", words: event.words };
    case "transcription-failed":
      return { type: "failed" };
    case "copied-instead":
      return { type: "warn", message: "Copied. Grant Accessibility to paste." };
    case "enter-skipped":
      return { type: "warn", message: "Return was not pressed: another app is in front" };
    case "insert-failed":
      return { type: "warn", message: "The text could not be pasted" };
  }
}
