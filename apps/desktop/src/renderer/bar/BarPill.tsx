import type { PointerEvent } from "react";
import type { BarView } from "@murmur/shared";
import { describeView, elapsed, meterFill } from "./bar-text";
import { Icon } from "./icons";

export interface BarPillProps {
  view: BarView;
  level: number | null;
  now: number;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (event: PointerEvent<HTMLDivElement>) => void;
  /** Yes or No for a question (`ask`). */
  onAnswer?: (choice: "yes" | "no") => void;
}

const METER_BARS = 5;

/** Buttons must not start a drag of the pill. */
const keepFromDrag = (event: PointerEvent<HTMLButtonElement>) => event.stopPropagation();

export function BarPill({ view, level, now, onAnswer, ...handlers }: BarPillProps) {
  if (view.state === "hidden") return null;
  if (view.state === "ask") {
    return (
      <div
        className="bar-pill bar-ask"
        data-state="ask"
        role="alertdialog"
        aria-label={view.message ?? ""}
        {...handlers}
      >
        <span className="bar-ask-text">
          <span className="bar-text">{view.message}</span>
          {view.detail ? (
            <span className="bar-detail" title={view.detail}>
              {view.detail}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className="bar-button bar-button-primary"
          onPointerDown={keepFromDrag}
          onClick={() => onAnswer?.("yes")}
        >
          Save
        </button>
        <button
          type="button"
          className="bar-button"
          onPointerDown={keepFromDrag}
          onClick={() => onAnswer?.("no")}
        >
          Dismiss
        </button>
      </div>
    );
  }
  const { text, icon } = describeView(view);
  const recording = view.state === "listening" || view.state === "locked";
  const fill = meterFill(level);
  return (
    <div
      className="bar-pill"
      data-state={view.state}
      role="status"
      aria-live="polite"
      aria-label={text || "Murmur"}
      {...handlers}
    >
      {icon && <Icon name={icon} />}
      {text && <span className="bar-text">{text}</span>}
      {recording && (
        <span className="bar-meter" aria-hidden="true">
          {Array.from({ length: METER_BARS }, (_, index) => (
            <span
              key={index}
              className="bar-meter-step"
              data-on={fill > index / METER_BARS ? "true" : "false"}
            />
          ))}
        </span>
      )}
      {view.startedAt !== null && <span className="bar-time">{elapsed(view.startedAt, now)}</span>}
    </div>
  );
}
