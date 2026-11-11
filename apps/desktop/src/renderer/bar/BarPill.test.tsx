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
  ];

  for (const [current, text, icon] of cases) {
    it(`${current.state}${current.words ? ` (${current.words})` : ""} shows "${text}" with the ${icon} icon`, () => {
      const { container } = render(<BarPill view={current} level={null} now={now} />);
      const pill = container.querySelector(".bar-pill");
      expect(pill?.getAttribute("data-state")).toBe(current.state);
      expect(container.querySelector(`[data-icon="${icon}"]`)).not.toBeNull();
      if (text) expect(screen.getByText(text)).toBeTruthy();
      expect(screen.getByRole("status").getAttribute("aria-label")).toBe(text || "Murmur");
    });
  }

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
