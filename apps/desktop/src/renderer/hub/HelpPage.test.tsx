// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HelpPage } from "./HelpPage";
import { createMockApi, SAMPLE_SETTINGS } from "./test-api";

beforeEach(() => {
  window.murmur = createMockApi();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Help page (HB-08)", () => {
  it("lists five tours and starts one", async () => {
    const onStartTour = vi.fn();
    const user = userEvent.setup();
    render(<HelpPage onStartTour={onStartTour} onRunSetup={() => {}} />);
    expect((await screen.findByRole("list", { name: "Tours" })).children).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "Start Shortcuts" }));
    expect(onStartTour).toHaveBeenCalledWith(expect.objectContaining({ id: "shortcuts" }), 0);
  });

  it("resumes a tour at the step it stopped at", async () => {
    const settings = structuredClone(SAMPLE_SETTINGS);
    settings.settings.help = { tours: { shortcuts: { step: 2, done: false } } };
    window.murmur = createMockApi({ getSettings: vi.fn().mockResolvedValue(settings) });
    const onStartTour = vi.fn();
    const user = userEvent.setup();
    render(<HelpPage onStartTour={onStartTour} onRunSetup={() => {}} />);
    await user.click(await screen.findByRole("button", { name: "Resume Shortcuts at step 3" }));
    expect(onStartTour).toHaveBeenCalledWith(expect.objectContaining({ id: "shortcuts" }), 2);
  });

  it("restarts setup and writes a local problem report", async () => {
    const onRunSetup = vi.fn();
    const user = userEvent.setup();
    render(<HelpPage onStartTour={() => {}} onRunSetup={onRunSetup} />);
    await user.click(screen.getByRole("button", { name: "Restart the setup tutorial" }));
    expect(onRunSetup).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Report a problem" }));
    expect(window.murmur.reportProblem).toHaveBeenCalled();
    expect(await screen.findByText("Saved to /tmp/x.")).toBeTruthy();
    expect((await screen.findByTestId("help-version")).textContent).toBe("Murmur 1.2.3");
  });
});
