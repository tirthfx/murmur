import type { BarView } from "@murmur/shared";
import type { Clock, TimerHandle } from "../helper/types";
import { INITIAL_VIEW, transition, type BarEvent } from "./bar-machine";

/** Where views go: the Bar window in the app, a fake in tests. */
export interface BarPort {
  render(view: BarView): void;
  level(rmsDb: number): void;
}

export interface BarController {
  dispatch(event: BarEvent): void;
  level(rmsDb: number): void;
  getView(): BarView;
  /** A click on the pill: retry in `error`. Other states ignore clicks for now. */
  click(): "retry" | null;
}

/** Runs the state machine, owns the one timer, and pushes every change to the port. */
export function createBarController(port: BarPort, clock: Clock): BarController {
  let current: BarView = INITIAL_VIEW;
  let timer: TimerHandle | null = null;

  function dispatch(event: BarEvent): void {
    const step = transition(current, event);
    if (!step.changed) return;
    if (timer !== null) {
      clock.clearTimeout(timer);
      timer = null;
    }
    current = step.view;
    if (step.timeoutMs !== null) {
      timer = clock.setTimeout(() => {
        timer = null;
        dispatch({ type: "timeout" });
      }, step.timeoutMs);
    }
    port.render(current);
  }

  return {
    dispatch,
    level(rmsDb) {
      if (
        current.state === "listening" ||
        current.state === "locked" ||
        current.state === "warning"
      ) {
        port.level(rmsDb);
      }
    },
    getView: () => current,
    click() {
      return current.state === "error" ? "retry" : null;
    },
  };
}
