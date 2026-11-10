// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSection } from "./SettingsSection";
import { createMockApi, SAMPLE_SETTINGS } from "./test-api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(overrides: Parameters<typeof createMockApi>[0] = {}) {
  const api = createMockApi(overrides);
  vi.stubGlobal("murmur", api);
  window.murmur = api;
  render(<SettingsSection />);
  return api;
}

describe("Settings section", () => {
  it("shows the shortcuts by name", async () => {
    mount();
    expect(await screen.findByTestId("hold-label")).toBeTruthy();
    expect(screen.getByText("Push to talk")).toBeTruthy();
    expect(screen.getByText("Hands-free")).toBeTruthy();
  });

  it("records a new shortcut from the keyboard and pauses dictation meanwhile", async () => {
    const api = mount();
    await screen.findByTestId("hold-label");
    await userEvent.click(screen.getByRole("button", { name: "Change the Hands-free shortcut" }));
    await waitFor(() => expect(api.captureShortcut).toHaveBeenCalledWith(true));
    fireEvent.keyDown(window, { code: "KeyD", ctrlKey: true, altKey: true });
    await waitFor(() =>
      expect(api.setShortcut).toHaveBeenCalledWith("handsFree", {
        code: "KeyD",
        modifiers: ["option", "control"],
      }),
    );
    expect(api.captureShortcut).toHaveBeenLastCalledWith(false);
  });

  it("shows why a shortcut was refused", async () => {
    mount({
      setShortcut: vi
        .fn()
        .mockResolvedValue({ ok: false, message: "Command+Space is used by macOS for Spotlight." }),
    });
    await screen.findByTestId("hold-label");
    await userEvent.click(screen.getByRole("button", { name: "Change the Push to talk shortcut" }));
    fireEvent.keyDown(window, { code: "Space", metaKey: true });
    expect(await screen.findByText("Command+Space is used by macOS for Spotlight.")).toBeTruthy();
  });

  it("offers the double tap back once hands-free has its own shortcut", async () => {
    const withChord = {
      ...SAMPLE_SETTINGS,
      settings: {
        ...SAMPLE_SETTINGS.settings,
        handsFreeShortcut: { type: "key" as const, keyCode: 2, modifiers: ["control" as const] },
      },
      shortcutLabels: { hold: "Right Option", handsFree: "Control+D" },
    };
    const api = mount({ getSettings: vi.fn().mockResolvedValue(withChord) });
    await userEvent.click(
      await screen.findByRole("button", { name: "Use a double tap for hands-free" }),
    );
    expect(api.setShortcut).toHaveBeenCalledWith("handsFree", null);
  });

  it("explains when settings cannot be read", async () => {
    mount({ getSettings: vi.fn().mockRejectedValue(new Error("x")) });
    expect(await screen.findByText("Settings could not be read.")).toBeTruthy();
  });
});
