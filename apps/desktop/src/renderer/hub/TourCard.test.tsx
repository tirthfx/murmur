// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tour } from "@murmur/shared";
import { TourCard } from "./TourCard";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "#");
});

const tour: Tour = {
  id: "t",
  title: "Test tour",
  summary: "",
  steps: [
    { hash: "#/home", target: "#first", title: "One", text: "First step." },
    { hash: "#/history", target: "#second", title: "Two", text: "Second step." },
  ],
};

describe("tour card (HB-08)", () => {
  it("goes to the step's page and highlights its part", async () => {
    const target = document.createElement("div");
    target.id = "first";
    document.body.append(target);
    render(<TourCard tour={tour} step={0} onStep={() => {}} onStop={() => {}} />);
    expect(window.location.hash).toBe("#/home");
    expect(target.classList.contains("hub-tour-target")).toBe(true);
    expect(screen.getByText("Test tour · step 1 of 2")).toBeTruthy();
  });

  it("moves on, stops, and finishes on the last step", async () => {
    const onStep = vi.fn();
    const onStop = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<TourCard tour={tour} step={0} onStep={onStep} onStop={onStop} />);
    await user.click(screen.getByRole("button", { name: "Next step" }));
    expect(onStep).toHaveBeenCalledWith(1);
    rerender(<TourCard tour={tour} step={1} onStep={onStep} onStop={onStop} />);
    await user.click(screen.getByRole("button", { name: "Finish the tour" }));
    expect(onStop).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole("button", { name: "Stop the tour" }));
    expect(onStop).toHaveBeenCalledWith(false);
  });
});
