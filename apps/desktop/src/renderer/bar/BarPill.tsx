import type { PointerEvent } from "react";
import { focusTimeLeft, type BarView } from "@murmur/shared";
import { announcement, describeView, elapsed, meterFill } from "./bar-text";
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
  const described = describeView(view);
  // While idle, Focus Mode shows its time left (RW-18).
  const focusText =
    view.state === "idle" && view.focus
      ? view.focus.endsAt === null
        ? "Focus"
        : `Focus ${focusTimeLeft(view.focus.endsAt, now)}`
      : null;
  // NT-04: a meeting recording shows on the idle Bar with its time.
  const meetingIdle = view.state === "idle" && view.meeting ? view.meeting : null;
  const text = meetingIdle ? "Meeting" : (focusText ?? described.text);
  const clockFrom = view.startedAt ?? meetingIdle?.startedAt ?? null;
  const icon = described.icon;
  const recording = view.state === "listening" || view.state === "locked";
  const fill = meterFill(level);
  return (
    <div className="bar-pill" data-state={view.state} {...handlers}>
      {/* HB-25: only state changes are announced, never the meter or the clock. */}
      <span className="bar-announce" role="status" aria-live="polite" aria-atomic="true">
        {announcement(view)}
      </span>
      {view.meeting && <span className="bar-rec-dot" role="img" aria-label="Recording a meeting" />}
      {icon && !meetingIdle && <Icon name={icon} />}
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
      {clockFrom !== null && (
        <span className="bar-time" aria-hidden="true">
          {elapsed(clockFrom, now)}
        </span>
      )}
    </div>
  );
}
