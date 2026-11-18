// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_TIPS, tipFor } from "@murmur/shared";
import { HomePage } from "./HomePage";
import { createMockApi, SAMPLE_SETTINGS } from "./test-api";

const READY = {
  model: { state: "ready", label: "Small", totalBytes: 1, downloadedBytes: 0, message: null },
  blockers: [],
} as const;

beforeEach(() => {
  window.murmur = createMockApi({ getSetupStatus: vi.fn().mockResolvedValue(READY) });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("tips", () => {
  it("gives one tip a day", () => {
    const day = new Date(2026, 10, 18, 9);
    expect(tipFor(day)).toBe(tipFor(new Date(2026, 10, 18, 22)));
    expect(tipFor(day)).not.toBe(tipFor(new Date(2026, 10, 19, 9)));
    expect(HOME_TIPS).toContain(tipFor(day));
  });
});

describe("Home page", () => {
  it("shows today, the shortcut and the last dictation", async () => {
    render(<HomePage />);
    expect((await screen.findByRole("group", { name: "Words today" })).textContent).toContain(
      "120",
    );
    expect(screen.getByRole("group", { name: "Dictations today" }).textContent).toContain("4");
    expect(await screen.findByText("So we go at three.")).toBeTruthy();
    expect(screen.getByText(/to dictate, and let go to insert/)).toBeTruthy();
    // Everything is set up: no checklist.
    expect(screen.queryByRole("list", { name: "Setup checklist" })).toBeNull();
  });

  it("greets by name only when it is shown", async () => {
    const settings = structuredClone(SAMPLE_SETTINGS);
    settings.settings.profile = { displayName: "Sam", showOnHome: true };
    window.murmur = createMockApi({
      getSettings: vi.fn().mockResolvedValue(settings),
      getSetupStatus: vi.fn().mockResolvedValue(READY),
    });
    render(<HomePage />);
    expect(await screen.findByRole("heading", { name: /, Sam$/ })).toBeTruthy();
    cleanup();

    settings.settings.profile = { displayName: "Sam", showOnHome: false };
    render(<HomePage />);
    await screen.findByRole("group", { name: "Words today" });
    expect(screen.queryByRole("heading", { name: /Sam/ })).toBeNull();
  });

  it("offers the model download when it is missing, and starts it", async () => {
    const user = userEvent.setup();
    window.murmur = createMockApi({
      getSetupStatus: vi.fn().mockResolvedValue({
        model: { ...READY.model, state: "missing" },
        blockers: ["speechModel"],
      }),
    });
    render(<HomePage />);
    await user.click(await screen.findByRole("button", { name: "Download the speech model" }));
    expect(window.murmur.downloadSpeechModel).toHaveBeenCalled();
  });

  it("shows the checklist until setup is done and ticks items off as they are", async () => {
    const getSetupStatus = vi
      .fn()
      .mockResolvedValueOnce({ ...READY, blockers: ["accessibility"] })
      .mockResolvedValue(READY);
    window.murmur = createMockApi({
      getSetupStatus,
      homeView: vi.fn().mockResolvedValue({
        todayWords: 0,
        todayDictations: 0,
        todayTimeSavedMs: 0,
        totalDictations: 0,
        last: null,
      }),
    });
    render(<HomePage />);
    const list = await screen.findByRole("list", { name: "Setup checklist" });
    expect(list.textContent).toContain("○ Permissions");
    await waitFor(() => expect(list.textContent).toContain("✓ Permissions"), { timeout: 2500 });
    // The first dictation is still to do.
    expect(list.textContent).toContain("○ First dictation");
  });
});
