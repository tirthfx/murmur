// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScratchpadPage } from "./ScratchpadPage";
import { createMockApi } from "./test-api";

beforeEach(() => {
  window.murmur = createMockApi();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Hub Scratchpad page", () => {
  it("opens the window, or a recent note in it", async () => {
    const user = userEvent.setup();
    render(<ScratchpadPage />);
    await user.click(screen.getByRole("button", { name: "Open the Scratchpad" }));
    expect(window.murmur.scratchpadOpen).toHaveBeenCalledWith(null);
    await user.click(await screen.findByRole("button", { name: "Open the note Ideas" }));
    expect(window.murmur.scratchpadOpen).toHaveBeenCalledWith("n1");
  });
});
