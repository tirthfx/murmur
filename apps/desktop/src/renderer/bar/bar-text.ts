import type { BarView } from "@murmur/shared";

export type BarIcon = "mic" | "lock" | "spinner" | "check" | "alert" | "retry" | "cancel";

/** The words and icon for each state. */
export function describeView(view: BarView): { text: string; icon: BarIcon | null } {
  switch (view.state) {
    case "hidden":
      return { text: "", icon: null };
    case "idle":
      return { text: "", icon: "mic" };
    case "listening":
      return { text: "Listening", icon: "mic" };
    case "locked":
      return { text: "Hands-free", icon: "lock" };
    case "processing":
      return { text: "Transcribing", icon: "spinner" };
    case "done": {
      const words = view.words ?? 0;
      return { text: `${words} ${words === 1 ? "word" : "words"}`, icon: "check" };
    }
    case "warning":
      return { text: view.message ?? "Check the microphone", icon: "alert" };
    case "error":
      return { text: view.message ?? "Transcription failed. Tap to retry.", icon: "retry" };
    case "cancelled":
      return { text: "Cancelled", icon: "cancel" };
    case "ask":
      return { text: view.message ?? "", icon: "check" };
  }
}

/**
 * HB-25: what a screen reader hears when the state changes. The level meter, the elapsed
 * time and Focus Mode's countdown are never announced; they would repeat every second.
 */
export function announcement(view: BarView): string {
  switch (view.state) {
    case "listening":
      return "Listening";
    case "locked":
      return "Hands-free dictation on";
    case "processing":
      return "Transcribing";
    case "done": {
      const words = view.words ?? 0;
      return `Done, ${words} ${words === 1 ? "word" : "words"}`;
    }
    case "warning":
    case "error":
    case "ask":
      return describeView(view).text;
    case "cancelled":
      return "Cancelled";
    default:
      return "";
  }
}

/** m:ss since `startedAt`. */
export function elapsed(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Maps -60..0 dBFS to 0..1 for the meter. */
export function meterFill(rmsDb: number | null): number {
  if (rmsDb === null) return 0;
  return Math.min(1, Math.max(0, (rmsDb + 60) / 60));
}
