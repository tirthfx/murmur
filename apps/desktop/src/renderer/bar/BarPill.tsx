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
}

const METER_BARS = 5;

export function BarPill({ view, level, now, ...handlers }: BarPillProps) {
  if (view.state === "hidden") return null;
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
