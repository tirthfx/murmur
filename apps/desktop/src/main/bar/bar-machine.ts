import { BAR_ERROR_TEXT, type BarView } from "@murmur/shared";

/**
 * The Bar's state machine. Pure: it returns the next view and, for short-lived states,
 * how long until a `timeout` event should be sent.
 */

export type BarEvent =
  | { type: "show" }
  | { type: "hide" }
  /** Recording started (key down, or a click in idle). */
  | { type: "start"; at: number }
  /** Hands-free lock while listening. */
  | { type: "lock" }
  /** Recording stopped; transcription runs. */
  | { type: "stop" }
  | { type: "cancel" }
  | { type: "transcribed"; words: number }
  | { type: "failed"; message?: string }
  /** Click in error: transcribe the last recording again. */
  | { type: "retry" }
  /** Something to tell the user. While recording it stays until the recording ends. */
  | { type: "warn"; message: string }
  | { type: "timeout" };

export interface BarStep {
  view: BarView;
  /** False when the event does not apply in this state; nothing changes. */
  changed: boolean;
  /** Send `timeout` after this many ms, or null for no timer. */
  timeoutMs: number | null;
}

export const DONE_MS = 800;
export const CANCELLED_MS = 600;
export const WARNING_MS = 3000;

export const INITIAL_VIEW: BarView = { state: "idle", startedAt: null, words: null, message: null };

function view(state: BarView["state"], fields: Partial<BarView> = {}): BarView {
  return { state, startedAt: null, words: null, message: null, ...fields };
}

/** A warning shown while the microphone keeps recording (for example a silent mic). */
function isRecordingWarning(current: BarView): boolean {
  return current.state === "warning" && current.startedAt !== null;
}

function isRecording(current: BarView): boolean {
  return current.state === "listening" || current.state === "locked" || isRecordingWarning(current);
}

export function transition(current: BarView, event: BarEvent): BarStep {
  const same: BarStep = { view: current, changed: false, timeoutMs: null };
  const to = (next: BarView, timeoutMs: number | null = null): BarStep => ({
    view: next,
    changed: true,
    timeoutMs,
  });

  switch (event.type) {
    case "show":
      return current.state === "hidden" ? to(view("idle")) : same;
    case "hide":
      return current.state === "hidden" ? same : to(view("hidden"));
    case "start":
      if (["idle", "done", "cancelled", "error"].includes(current.state)) {
        return to(view("listening", { startedAt: event.at }));
      }
      if (current.state === "warning" && !isRecordingWarning(current)) {
        return to(view("listening", { startedAt: event.at }));
      }
      return same;
    case "lock":
      return current.state === "listening"
        ? to(view("locked", { startedAt: current.startedAt }))
        : same;
    case "stop":
      return isRecording(current) ? to(view("processing")) : same;
    case "cancel":
      return current.state === "hidden" || current.state === "idle" || current.state === "cancelled"
        ? same
        : to(view("cancelled"), CANCELLED_MS);
    case "transcribed":
      return current.state === "processing"
        ? to(view("done", { words: event.words }), DONE_MS)
        : same;
    case "failed":
      return current.state === "processing"
        ? to(view("error", { message: event.message ?? BAR_ERROR_TEXT }))
        : same;
    case "retry":
      return current.state === "error" ? to(view("processing")) : same;
    case "warn":
      if (current.state === "hidden") return same;
      if (isRecording(current)) {
        return to(view("warning", { startedAt: current.startedAt, message: event.message }));
      }
      return to(view("warning", { message: event.message }), WARNING_MS);
    case "timeout":
      if (current.state === "done" || current.state === "cancelled") return to(view("idle"));
      if (current.state === "warning" && !isRecordingWarning(current)) return to(view("idle"));
      return same;
  }
}
