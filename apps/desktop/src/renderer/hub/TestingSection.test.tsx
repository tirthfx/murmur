// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestingSection } from "./TestingSection";
import { createMockApi, SAMPLE_SETTINGS } from "./test-api";

beforeEach(() => {
  window.murmur = createMockApi();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(change: (settings: typeof SAMPLE_SETTINGS.settings) => void = () => {}) {
  const settings = structuredClone(SAMPLE_SETTINGS.settings);
  settings.devMode = { ...settings.devMode, enabled: true };
  change(settings);
  const update = vi.fn();
  const onRunSetup = vi.fn();
  render(<TestingSection settings={settings} update={update} onRunSetup={onRunSetup} />);
  return { update, onRunSetup };
}

describe("Testing page (HB-20, HB-54 to HB-57)", () => {
  it("warns, and turns developer mode off", async () => {
    const { update } = mount();
    expect(screen.getByText("For testing. These tools can change or delete data.")).toBeTruthy();
    await userEvent.click(screen.getByRole("switch", { name: "Developer mode" }));
    expect(update).toHaveBeenCalledWith({ devMode: expect.objectContaining({ enabled: false }) });
  });

  it("marks an overridden flag and resets it", async () => {
    const { update } = mount((settings) => {
      settings.experimental.focusMode = true;
    });
    const list = screen.getByRole("list", { name: "Feature flags" });
    expect(within(list).getByRole("switch", { name: "Focus Mode · overridden" })).toBeTruthy();
    await userEvent.click(
      within(list).getByRole("button", { name: "Reset Focus Mode to its default" }),
    );
    expect(update).toHaveBeenCalledWith({
      experimental: expect.objectContaining({ focusMode: false }),
    });
  });

  it("runs tools, restarting setup in the Hub", async () => {
    const { onRunSetup } = mount();
    await userEvent.click(screen.getByRole("button", { name: "Send a test notification" }));
    expect(window.murmur.testingTool).toHaveBeenCalledWith("testNotification");
    await userEvent.click(screen.getByRole("button", { name: "Restart onboarding" }));
    expect(onRunSetup).toHaveBeenCalled();
  });

  it("counts what a personalisation reset deletes before doing it", async () => {
    window.murmur = createMockApi({
      dataCounts: vi.fn().mockResolvedValue({
        categories: [
          { category: "dictionary", count: 3, bytes: 0 },
          { category: "dictations", count: 40, bytes: 0 },
        ],
        failedFiles: 0,
      }),
    });
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Reset personalisation" }));
    expect(await screen.findByText("Delete 3 items: this cannot be undone")).toBeTruthy();
    expect(window.murmur.testingTool).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm resetting personalisation" }),
    );
    expect(window.murmur.testingTool).toHaveBeenCalledWith("resetPersonalisation");
  });

  it("sets the engine switches", async () => {
    const { update } = mount();
    await userEvent.click(screen.getByRole("switch", { name: "Force typed insertion" }));
    expect(update).toHaveBeenCalledWith({ devMode: expect.objectContaining({ forceTyped: true }) });
  });

  it("inspects the app in front after a countdown, never showing secure values", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mount();
    await user.click(screen.getByRole("button", { name: "Inspect the app in front in 3 seconds" }));
    expect(window.murmur.axInspect).not.toHaveBeenCalled();
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(window.murmur.axInspect).toHaveBeenCalledWith(false);
    const tree = await screen.findByRole("list", { name: "Accessibility tree" });
    expect(tree.textContent).toContain("secure: true");
    expect(tree.textContent).not.toContain("value");
    expect(screen.getByText(/Stopped at the limit/)).toBeTruthy();
  });
});
