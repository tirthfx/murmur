// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BarView } from "@murmur/shared";
import { BarPill } from "./BarPill";
import { elapsed, meterFill } from "./bar-text";

afterEach(cleanup);

function view(state: BarView["state"], fields: Partial<BarView> = {}): BarView {
  return { state, startedAt: null, words: null, message: null, ...fields };
}

const now = 1_000_000;

describe("Bar pill", () => {
  const cases: [BarView, string, string][] = [
    [view("idle"), "", "mic"],
    [view("listening", { startedAt: now - 7_000 }), "Listening", "mic"],
    [view("locked", { startedAt: now - 65_000 }), "Hands-free", "lock"],
    [view("processing"), "Transcribing", "spinner"],
    [view("done", { words: 12 }), "12 words", "check"],
    [view("done", { words: 1 }), "1 word", "check"],
    [view("warning", { message: "No sound from Desk Mic" }), "No sound from Desk Mic", "alert"],
    [
      view("error", { message: "Transcription failed. Tap to retry." }),
      "Transcription failed. Tap to retry.",
      "retry",
    ],
    [view("cancelled"), "Cancelled", "cancel"],
    [view("idle", { focus: { endsAt: now + 24 * 60_000 + 5_000 } }), "Focus 24:05", "mic"],
    [view("idle", { focus: { endsAt: null } }), "Focus", "mic"],
  ];

  for (const [current, text, icon] of cases) {
    it(`${current.state}${current.words ? ` (${current.words})` : ""}${current.focus ? " in Focus" : ""} shows "${text}" with the ${icon} icon`, () => {
      const { container } = render(<BarPill view={current} level={null} now={now} />);
      const pill = container.querySelector(".bar-pill");
      expect(pill?.getAttribute("data-state")).toBe(current.state);
      expect(container.querySelector(`[data-icon="${icon}"]`)).not.toBeNull();
      if (text) expect(container.querySelector(".bar-text")?.textContent).toBe(text);
      // The visible text is the state; Focus's countdown is never announced.
      if (current.state === "idle") expect(screen.getByRole("status").textContent).toBe("");
    });
  }

  it("shows a meeting being recorded: the time while idle, the dot in every state", () => {
    const meeting = { startedAt: now - 125_000 };
    const { container, rerender } = render(
      <BarPill view={view("idle", { meeting })} level={null} now={now} />,
    );
    expect(container.querySelector(".bar-text")?.textContent).toBe("Meeting");
    expect(container.querySelector(".bar-time")?.textContent).toBe(elapsed(meeting.startedAt, now));
    expect(screen.getByRole("img", { name: "Recording a meeting" })).toBeTruthy();
    rerender(
      <BarPill
        view={view("listening", { startedAt: now - 3_000, meeting })}
        level={null}
        now={now}
      />,
    );
    expect(container.querySelector(".bar-text")?.textContent).toBe("Listening");
    expect(container.querySelector(".bar-time")?.textContent).toBe(elapsed(now - 3_000, now));
    expect(screen.getByRole("img", { name: "Recording a meeting" })).toBeTruthy();
  });

  it("asks with Save and Dismiss, and the buttons do not start a drag", () => {
    const onAnswer = vi.fn();
    const onPointerDown = vi.fn();
    render(
      <BarPill
        view={view("ask", { message: "Save to Memory?", detail: "I prefer metric units." })}
        level={null}
        now={now}
        onAnswer={onAnswer}
        onPointerDown={onPointerDown}
      />,
    );
    expect(screen.getByRole("alertdialog", { name: "Save to Memory?" })).toBeTruthy();
    expect(screen.getByText("I prefer metric units.")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.pointerDown(save);
    expect(onPointerDown).not.toHaveBeenCalled();
    save.click();
    screen.getByRole("button", { name: "Dismiss" }).click();
    expect(onAnswer.mock.calls).toEqual([["yes"], ["no"]]);
  });

  it("asks with the buttons it is given, and Never can say more than its label", () => {
    const onAnswer = vi.fn();
    render(
      <BarPill
        view={view("ask", {
          message: "Record this meeting?",
          detail: "Zoom call detected",
          actions: [
            { answer: "yes", label: "Record", primary: true },
            { answer: "no", label: "Not now" },
            { answer: "never", label: "Never", hint: "Never for this app" },
          ],
        })}
        level={null}
        now={now}
        onAnswer={onAnswer}
      />,
    );
    screen.getByRole("button", { name: "Record" }).click();
    screen.getByRole("button", { name: "Not now" }).click();
    screen.getByRole("button", { name: "Never for this app" }).click();
    expect(onAnswer.mock.calls).toEqual([["yes"], ["no"], ["never"]]);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("draws nothing when hidden", () => {
    const { container } = render(<BarPill view={view("hidden")} level={null} now={now} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the elapsed time and a level meter while recording", () => {
    const { container } = render(
      <BarPill view={view("listening", { startedAt: now - 65_000 })} level={-18} now={now} />,
    );
    expect(screen.getByText("1:05")).toBeTruthy();
    const lit = container.querySelectorAll('.bar-meter-step[data-on="true"]').length;
    expect(lit).toBe(4);
  });

  it("formats time and meter levels", () => {
    expect(elapsed(0, 9_999)).toBe("0:09");
    expect(elapsed(5_000, 0)).toBe("0:00");
    expect(meterFill(-60)).toBe(0);
    expect(meterFill(0)).toBe(1);
    expect(meterFill(-120)).toBe(0);
    expect(meterFill(null)).toBe(0);
  });
});

describe("screen reader announcements (HB-25)", () => {
  it("announces each state once, without the meter or the clock", () => {
    const at = Date.now();
    const states: [Partial<BarView> & { state: BarView["state"] }, string][] = [
      [{ state: "listening", startedAt: at }, "Listening"],
      [{ state: "locked", startedAt: at }, "Hands-free dictation on"],
      [{ state: "processing" }, "Transcribing"],
      [{ state: "done", words: 12 }, "Done, 12 words"],
      [{ state: "warning", message: "Check the microphone" }, "Check the microphone"],
      [
        { state: "error", message: "Transcription failed. Tap to retry." },
        "Transcription failed. Tap to retry.",
      ],
    ];
    for (const [change, heard] of states) {
      const full: BarView = {
        startedAt: null,
        words: null,
        message: null,
        ...change,
      };
      const { unmount } = render(<BarPill view={full} level={-20} now={at + 65_000} />);
      const status = screen.getByRole("status");
      expect(status.textContent).toBe(heard);
      expect(status.textContent).not.toMatch(/\d:\d\d/);
      unmount();
    }
  });
});
