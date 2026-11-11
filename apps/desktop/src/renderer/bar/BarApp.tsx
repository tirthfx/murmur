import { useEffect, useRef, useState, type PointerEvent } from "react";
import { BAR_STATES, type BarView, type MurmurBarApi } from "@murmur/shared";
import { BarPill } from "./BarPill";
import { playSound } from "./sounds";

/** Movement below this many points is a click, not a drag. */
const CLICK_SLOP = 4;

export function BarApp({ api }: { api: MurmurBarApi }) {
  const [view, setView] = useState<BarView | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    void api.ready().then((initial) => alive && setView(initial));
    const offView = api.onView((next) => {
      setView(next);
      if (next.state !== "listening" && next.state !== "locked") setLevel(null);
    });
    const offLevel = api.onLevel(setLevel);
    const offSound = api.onSound(playSound);
    return () => {
      alive = false;
      offView();
      offLevel();
      offSound();
    };
  }, [api]);

  const ticking = view?.startedAt != null;
  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [ticking]);

  if (!view) return null;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.screenX, y: event.screenY, moved: false };
    api.dragStart();
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    const dx = event.screenX - start.x;
    const dy = event.screenY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    start.moved = true;
    api.drag(dx, dy);
  };
  const onPointerUp = () => {
    const start = drag.current;
    drag.current = null;
    if (!start) return;
    if (start.moved) api.dragEnd();
    else api.click();
  };

  return (
    <BarPill
      view={view}
      level={level}
      now={now}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onAnswer={(choice) => api.answer(choice)}
    />
  );
}

/** Development only: every state side by side, for looking at the Bar in a normal browser. */
export function BarGallery() {
  const now = Date.now();
  const sample = (state: BarView["state"]): BarView => ({
    state,
    startedAt: state === "listening" || state === "locked" ? now - 7_000 : null,
    words: state === "done" ? 12 : null,
    message:
      state === "warning"
        ? "No sound from MacBook Pro Microphone"
        : state === "error"
          ? "Transcription failed. Tap to retry."
          : null,
  });
  return (
    <div className="bar-gallery">
      {BAR_STATES.filter((state) => state !== "hidden").map((state) => (
        <div key={state} className="bar-gallery-row">
          <code>{state}</code>
          <BarPill view={sample(state)} level={state === "listening" ? -18 : null} now={now} />
        </div>
      ))}
    </div>
  );
}
