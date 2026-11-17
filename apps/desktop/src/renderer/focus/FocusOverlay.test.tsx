// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FocusOverlayState, MurmurFocusApi } from "@murmur/shared";
import { FocusOverlay } from "./FocusOverlay";

afterEach(cleanup);

function api(state: FocusOverlayState): MurmurFocusApi {
  return {
    ready: vi.fn().mockResolvedValue(state),
    onState: vi.fn(() => () => {}),
    goBack: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    turnOff: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Focus overlay", () => {
  it("says what is blocked and offers the three ways out", async () => {
    const focus = api({ stage: "blocked", name: "Safari" });
    render(<FocusOverlay api={focus} />);
    expect(await screen.findByText("Focus is on. Safari is blocked.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Go back to the previous app" }));
    await userEvent.click(screen.getByRole("button", { name: "Pause Focus for 10 minutes" }));
    await userEvent.click(screen.getByRole("button", { name: "Turn off Focus" }));
    expect(focus.goBack).toHaveBeenCalled();
    expect(focus.pause).toHaveBeenCalled();
    expect(focus.turnOff).toHaveBeenCalled();
  });

  it("draws nothing while hidden", async () => {
    const { container } = render(<FocusOverlay api={api({ stage: "hidden" })} />);
    await Promise.resolve();
    expect(container.textContent).toBe("");
  });
});
