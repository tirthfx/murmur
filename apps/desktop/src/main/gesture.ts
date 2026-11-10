import type { Clock, TimerHandle } from "./helper/types";

/** What the dictation key gesture asks the recorder to do. */
export type GestureCommand = "start" | "stop" | "lock" | "cancel";

/** A press shorter than this is a tap (DC-03). */
export const TAP_MAX_MS = 300;
/** The second tap must start within this long of the first (DC-03). */
export const DOUBLE_TAP_MS = 400;

type State =
  | { kind: "idle" }
  /** Key held, recording. */
  | { kind: "held"; downAt: number }
  /** A short tap: recording, waiting to see whether a second tap comes. */
  | { kind: "tapped"; firstDownAt: number; timer: TimerHandle }
  /** Hands-free: recording without holding the key. */
  | { kind: "locked"; ignoreNextUp: boolean }
  /** Stopped by a key press; its release must not start anything. */
  | { kind: "stopping" };

/**
 * Push-to-talk and hands-free from one key (DC-02, DC-03, DC-05). Hold to dictate; a quick
 * double tap locks recording; while locked the next press stops it; the hands-free shortcut
 * toggles the lock; Escape cancels while recording. The lock exists only in memory, so it
 * can never survive a restart.
 */
export class DictationGesture {
  private state: State = { kind: "idle" };

  constructor(
    private readonly clock: Clock,
    private readonly run: (command: GestureCommand) => void,
  ) {}

  get recording(): boolean {
    return (
      this.state.kind === "held" || this.state.kind === "tapped" || this.state.kind === "locked"
    );
  }

  get locked(): boolean {
    return this.state.kind === "locked";
  }

  holdDown(at: number): void {
    const state = this.state;
    switch (state.kind) {
      case "idle":
      case "stopping":
        this.state = { kind: "held", downAt: at };
        this.run("start");
        return;
      case "tapped":
        this.clock.clearTimeout(state.timer);
        if (at - state.firstDownAt <= DOUBLE_TAP_MS) {
          this.state = { kind: "locked", ignoreNextUp: true };
          this.run("lock");
        } else {
          // Too late for a double tap: the first tap's recording ends, a new one starts.
          this.run("stop");
          this.state = { kind: "held", downAt: at };
          this.run("start");
        }
        return;
      case "locked":
        this.state = { kind: "stopping" };
        this.run("stop");
        return;
      case "held":
        return;
    }
  }

  holdUp(at: number): void {
    const state = this.state;
    switch (state.kind) {
      case "held": {
        if (at - state.downAt >= TAP_MAX_MS) {
          this.state = { kind: "idle" };
          this.run("stop");
          return;
        }
        const wait = Math.max(0, state.downAt + DOUBLE_TAP_MS - at);
        const timer = this.clock.setTimeout(() => {
          if (this.state.kind !== "tapped") return;
          this.state = { kind: "idle" };
          this.run("stop");
        }, wait);
        this.state = { kind: "tapped", firstDownAt: state.downAt, timer };
        return;
      }
      case "locked":
        if (state.ignoreNextUp) this.state = { kind: "locked", ignoreNextUp: false };
        return;
      case "stopping":
        this.state = { kind: "idle" };
        return;
      default:
        return;
    }
  }

  /** The hands-free shortcut: lock when idle or recording, stop when locked. */
  toggle(): void {
    const state = this.state;
    if (state.kind === "tapped") this.clock.clearTimeout(state.timer);
    if (state.kind === "locked") {
      this.state = { kind: "idle" };
      this.run("stop");
      return;
    }
    if (state.kind === "idle" || state.kind === "stopping") this.run("start");
    this.state = { kind: "locked", ignoreNextUp: state.kind === "held" };
    this.run("lock");
  }

  /** Escape: cancels a recording; ignored otherwise (the app in front still gets it). */
  cancel(): void {
    const state = this.state;
    if (!this.recording) return;
    if (state.kind === "tapped") this.clock.clearTimeout(state.timer);
    this.state = { kind: "idle" };
    this.run("cancel");
  }

  /** Forget everything, for example when the helper restarted mid-session. */
  reset(): void {
    const state = this.state;
    if (state.kind === "tapped") this.clock.clearTimeout(state.timer);
    this.state = { kind: "idle" };
  }
}
