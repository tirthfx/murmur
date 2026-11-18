// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import { SETTINGS_INDEX, SETTINGS_PAGES, searchSettings } from "./settings-pages";
import { createMockApi, SAMPLE_SETTINGS } from "./test-api";

beforeEach(() => {
  window.murmur = createMockApi();
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "#");
  vi.unstubAllGlobals();
});

describe("settings index", () => {
  it("names each setting once, on a page that exists", () => {
    const ids = SETTINGS_INDEX.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const pages = new Set<string>(SETTINGS_PAGES.map((page) => page.id));
    for (const entry of SETTINGS_INDEX) expect(pages.has(entry.page)).toBe(true);
  });

  it("finds a setting by its label or other words, label matches first", () => {
    expect(searchSettings("whisper")[0]?.id).toBe("whisper");
    expect(searchSettings("fillers")[0]?.id).toBe("cleanup");
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("zzz")).toEqual([]);
  });
});

describe("Settings page", () => {
  it("starts on General and switches page from the list", async () => {
    const user = userEvent.setup();
    render(<SettingsPage onRunSetup={() => {}} />);
    expect(await screen.findByRole("switch", { name: "Launch at login" })).toBeTruthy();

    const nav = screen.getByRole("navigation", { name: "Settings pages" });
    await user.click(within(nav).getByRole("button", { name: "Microphone" }));
    expect(await screen.findByRole("switch", { name: "Whisper mode" })).toBeTruthy();
    expect(window.location.hash).toBe("#/settings/microphone");
    expect(screen.queryByRole("switch", { name: "Launch at login" })).toBeNull();
  });

  it("opens the page named in the hash", async () => {
    window.history.replaceState(null, "", "#/settings/system");
    render(<SettingsPage onRunSetup={() => {}} />);
    expect(
      await screen.findByRole("switch", { name: "Mute other audio while dictating" }),
    ).toBeTruthy();
  });

  it("jumps to a setting found by search and highlights it", async () => {
    const user = userEvent.setup();
    render(<SettingsPage onRunSetup={() => {}} />);
    await screen.findByRole("switch", { name: "Launch at login" });
    await user.type(screen.getByRole("textbox", { name: "Search settings" }), "whisper");
    await user.click(screen.getByRole("button", { name: "Whisper mode" }));
    await waitFor(() =>
      expect(document.querySelector('[data-setting="whisper"]')?.classList).toContain(
        "hub-setting-found",
      ),
    );
    expect(window.location.hash).toBe("#/settings/microphone");
  });

  it("every indexed setting has its row on its page", async () => {
    const user = userEvent.setup();
    const settings = structuredClone(SAMPLE_SETTINGS);
    settings.settings.devMode = { ...settings.settings.devMode, enabled: true };
    window.murmur = createMockApi({
      getSettings: vi.fn().mockResolvedValue(settings),
      updateSettings: vi.fn().mockResolvedValue(settings),
    });
    render(<SettingsPage onRunSetup={() => {}} />);
    await screen.findByRole("switch", { name: "Launch at login" });
    // Command Mode and Focus Mode rows show only while their experiment is on.
    const optional = new Set(["command-mode", "focus-mode"]);
    const nav = screen.getByRole("navigation", { name: "Settings pages" });
    for (const page of SETTINGS_PAGES) {
      await user.click(within(nav).getByRole("button", { name: page.title }));
      for (const entry of SETTINGS_INDEX.filter((item) => item.page === page.id)) {
        if (optional.has(entry.id)) continue;
        await waitFor(() =>
          expect(document.querySelector(`[data-setting="${entry.id}"]`)).not.toBeNull(),
        );
      }
    }
  });

  it("turns launch at login on", async () => {
    const user = userEvent.setup();
    render(<SettingsPage onRunSetup={() => {}} />);
    await user.click(await screen.findByRole("switch", { name: "Launch at login" }));
    expect(window.murmur.loginItemSet).toHaveBeenCalledWith(true);
  });

  it("explains when launch at login is not available", async () => {
    window.murmur = createMockApi({
      loginItemGet: vi.fn().mockResolvedValue({ available: false, enabled: false }),
    });
    render(<SettingsPage onRunSetup={() => {}} />);
    expect(await screen.findByText(/a development run cannot be added/)).toBeTruthy();
  });

  it("saves Show the Hub when Murmur starts", async () => {
    const user = userEvent.setup();
    render(<SettingsPage onRunSetup={() => {}} />);
    await user.click(
      await screen.findByRole("switch", { name: "Show the Hub when Murmur starts" }),
    );
    expect(window.murmur.updateSettings).toHaveBeenCalledWith({ openHubOnLaunch: false });
  });

  it("chooses the appearance", async () => {
    const user = userEvent.setup();
    render(<SettingsPage onRunSetup={() => {}} />);
    const dark = await screen.findByRole("radio", { name: "Dark" });
    expect(screen.getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("true");
    await user.click(dark);
    expect(window.murmur.updateSettings).toHaveBeenCalledWith({ theme: "dark" });
  });

  it("turns a notification on", async () => {
    const user = userEvent.setup();
    render(<SettingsPage onRunSetup={() => {}} />);
    await user.click(await screen.findByRole("switch", { name: "A milestone was reached" }));
    expect(window.murmur.updateSettings).toHaveBeenCalledWith({
      notifications: expect.objectContaining({ milestone: true, dictationFailed: true }),
    });
  });

  it("hides Testing until the version is clicked five times", async () => {
    const user = userEvent.setup();
    render(<SettingsPage onRunSetup={() => {}} />);
    const nav = await screen.findByRole("navigation", { name: "Settings pages" });
    await screen.findByRole("switch", { name: "Launch at login" });
    expect(within(nav).queryByRole("button", { name: "Testing" })).toBeNull();
    const version = await screen.findByTestId("settings-version");
    for (let i = 0; i < 4; i++) await user.click(version);
    expect(window.murmur.updateSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({ devMode: expect.anything() }),
    );
    await user.click(version);
    expect(window.murmur.updateSettings).toHaveBeenCalledWith({
      devMode: expect.objectContaining({ enabled: true }),
    });
  });

  it("sends the Testing route back to General while developer mode is off", async () => {
    window.history.replaceState(null, "", "#/settings/testing");
    render(<SettingsPage onRunSetup={() => {}} />);
    expect(await screen.findByRole("switch", { name: "Launch at login" })).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe("#/settings/general"));
  });
});
