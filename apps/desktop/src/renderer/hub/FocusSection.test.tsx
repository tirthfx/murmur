// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FocusRule, SettingsView } from "@murmur/shared";
import { SettingsSection } from "./SettingsSection";
import { createMockApi, SAMPLE_SETTINGS } from "./test-api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ON: SettingsView = {
  ...SAMPLE_SETTINGS,
  settings: {
    ...SAMPLE_SETTINGS.settings,
    experimental: { ...SAMPLE_SETTINGS.settings.experimental, focusMode: true },
    focus: { duration: 50 },
  },
  shortcutLabels: { ...SAMPLE_SETTINGS.shortcutLabels, focus: "Control+Option+F" },
};

const safari: FocusRule = {
  id: "r1",
  kind: "app",
  value: "com.apple.Safari",
  label: "Safari",
  createdAt: 1,
};

function mount(view: SettingsView = ON, overrides: Parameters<typeof createMockApi>[0] = {}) {
  const api = createMockApi({
    getSettings: vi.fn().mockResolvedValue(view),
    updateSettings: vi.fn().mockResolvedValue(view),
    focusInstalledApps: vi.fn().mockResolvedValue([
      { bundleId: "com.apple.Music", name: "Music" },
      { bundleId: "com.apple.Safari", name: "Safari" },
    ]),
    ...overrides,
  });
  vi.stubGlobal("murmur", api);
  window.murmur = api;
  render(<SettingsSection page="experimental" onRunSetup={() => {}} />);
  return api;
}

describe("Focus Mode section", () => {
  it("is shown only while Focus Mode is on in Experimental", async () => {
    mount(SAMPLE_SETTINGS);
    await screen.findAllByRole("switch");
    expect(screen.queryByRole("heading", { name: "Focus Mode" })).toBeNull();
  });

  it("starts Focus for the chosen duration", async () => {
    const api = mount();
    await userEvent.click(await screen.findByRole("button", { name: "Start Focus" }));
    expect(api.focusStart).toHaveBeenCalledWith(50);
    expect(screen.getByTestId("focus-label")).toBeTruthy();
  });

  it("blocks an app by bundle id and lists it", async () => {
    const focusApps = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([safari]);
    const api = mount(ON, {
      focusApps,
      focusAddApp: vi.fn().mockResolvedValue({ ok: true, rule: safari }),
    });
    expect(await screen.findByText("No apps are blocked yet.")).toBeTruthy();
    await waitFor(() => expect(api.focusInstalledApps).toHaveBeenCalled());
    await userEvent.type(screen.getByLabelText("Or an app's bundle id"), "com.apple.Safari");
    await userEvent.click(screen.getByRole("button", { name: "Block this bundle id" }));
    expect(api.focusAddApp).toHaveBeenCalledWith({
      bundleId: "com.apple.Safari",
      label: "com.apple.Safari",
    });
    const list = await screen.findByRole("list", { name: "Blocked apps" });
    expect(list.textContent).toContain("Safari");
    await userEvent.click(screen.getByRole("button", { name: "Stop blocking Safari" }));
    expect(api.focusRemoveApp).toHaveBeenCalledWith("r1");
  });

  it("refuses a bundle id that is not one", async () => {
    const api = mount();
    await userEvent.type(await screen.findByLabelText("Or an app's bundle id"), "not an id");
    await userEvent.click(screen.getByRole("button", { name: "Block this bundle id" }));
    expect((await screen.findAllByText(/Use an app's bundle id/)).length).toBeGreaterThan(0);
    expect(api.focusAddApp).not.toHaveBeenCalled();
  });

  it("blocks a site, says when a browser cannot be read, and removes it", async () => {
    const site: FocusRule = {
      ...safari,
      id: "s1",
      kind: "site",
      value: "example.com",
      label: "example.com",
    };
    const focusSites = vi
      .fn()
      .mockResolvedValueOnce({ rules: [], unavailableIn: ["Firefox"] })
      .mockResolvedValue({ rules: [site], unavailableIn: ["Firefox"] });
    const api = mount(ON, {
      focusSites,
      focusAddSite: vi.fn().mockResolvedValue({ ok: true, rule: site }),
    });
    expect(await screen.findByText("Website blocking is not available in Firefox.")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Site to block"), "https://www.example.com/");
    await userEvent.click(screen.getByRole("button", { name: "Block this site" }));
    expect(api.focusAddSite).toHaveBeenCalledWith({ site: "https://www.example.com/" });
    const list = await screen.findByRole("list", { name: "Blocked sites" });
    expect(list.textContent).toContain("example.com");
    await userEvent.click(screen.getByRole("button", { name: "Stop blocking example.com" }));
    expect(api.focusRemoveApp).toHaveBeenCalledWith("s1");
  });
});
