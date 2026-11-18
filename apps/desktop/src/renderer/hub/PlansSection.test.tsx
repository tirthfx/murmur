// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlansSection } from "./PlansSection";
import { createMockApi } from "./test-api";

beforeEach(() => {
  window.murmur = createMockApi();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Plans page (HB-19)", () => {
  it("says nothing is charged and shows Free's weekly usage", async () => {
    render(<PlansSection tier="free" onTier={() => {}} />);
    expect(screen.getByTestId("no-charge").textContent).toMatch(/no payment is ever made/);
    expect((await screen.findByTestId("weekly-usage")).textContent).toBe(
      "1,234 of 2,000 words this week.",
    );
  });

  it("starts a trial and shows the days left, with extend and end", async () => {
    const user = userEvent.setup();
    render(<PlansSection tier="free" onTier={() => {}} />);
    await user.click(await screen.findByRole("button", { name: "Start a 14-day trial of Pro" }));
    expect(window.murmur.planAct).toHaveBeenCalledWith({ type: "startTrial" });
    expect((await screen.findByTestId("trial-state")).textContent).toMatch(/14 days left/);
    expect(screen.getByRole("list", { name: "Plan changes" }).textContent).toContain(
      "Trial of Pro started",
    );
    await user.click(screen.getByRole("button", { name: "End the trial now" }));
    expect(window.murmur.planAct).toHaveBeenLastCalledWith({ type: "endTrial" });
  });

  it("sets the student label", async () => {
    const user = userEvent.setup();
    render(<PlansSection tier="pro" onTier={() => {}} />);
    await user.click(await screen.findByRole("switch", { name: "Student" }));
    expect(window.murmur.planAct).toHaveBeenCalledWith({ type: "student", on: true });
  });
});
