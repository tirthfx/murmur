// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MurmurApi, PermissionsInfo, SetupStatus } from "@murmur/shared";
import { App } from "./App";
import { SAMPLE_PERMISSIONS, SAMPLE_SETTINGS, SAMPLE_SETUP, createMockApi } from "./test-api";

function stubBrowserApis() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

const FRESH = {
  ...SAMPLE_SETTINGS,
  settings: { ...SAMPLE_SETTINGS.settings, setupComplete: false },
};

const permissions = (statuses: Partial<PermissionsInfo["statuses"]>): PermissionsInfo => ({
  statuses: {
    microphone: "granted",
    accessibility: "granted",
    inputMonitoring: "granted",
    screenRecording: "unknown",
    ...statuses,
  },
  message: null,
});

const setupStatus = (
  model: Partial<SetupStatus["model"]>,
  blockers: SetupStatus["blockers"] = [],
): SetupStatus => ({ model: { ...SAMPLE_SETUP.model, ...model }, blockers });

function fresh(overrides: Partial<MurmurApi> = {}) {
  window.murmur = createMockApi({
    getSettings: vi.fn().mockResolvedValue(FRESH),
    getPermissions: vi.fn().mockResolvedValue(permissions({})),
    ...overrides,
  });
}

const title = () => screen.getByRole("heading", { level: 1 }).textContent;
const press = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole("button", { name }));

describe("Onboarding", () => {
  beforeEach(() => {
    stubBrowserApis();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens on a new profile instead of the Hub", async () => {
    fresh();
    render(<App />);
    expect(await screen.findByTestId("setup")).toBeTruthy();
    expect(title()).toBe("Welcome to Murmur");
    expect(screen.getByTestId("setup-progress").textContent).toBe("Step 1 of 8");
    expect(screen.queryByRole("navigation", { name: "Hub pages" })).toBeNull();
  });

  it("does not open once setup is complete", async () => {
    window.murmur = createMockApi();
    render(<App />);
    expect(await screen.findByRole("navigation", { name: "Hub pages" })).toBeTruthy();
    expect(screen.queryByTestId("setup")).toBeNull();
  });

  it("walks through every step and saves the setup-complete flag", async () => {
    const user = userEvent.setup();
    fresh();
    render(<App />);
    await screen.findByTestId("setup");
    const seen = [title()];
    await press(user, "Get started");
    for (let step = 0; step < 5; step++) {
      seen.push(title());
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", false),
      );
      await press(user, "Continue");
    }
    seen.push(title());
    expect(seen).toEqual([
      "Welcome to Murmur",
      "Microphone",
      "Accessibility",
      "Input Monitoring",
      "Speech model",
      "Dictation shortcut",
      "Try it",
    ]);
    await press(user, "Skip");
    expect(title()).toBe("All set");
    expect(screen.getByText("Murmur is ready")).toBeTruthy();
    await press(user, "Finish");
    expect(window.murmur.updateSettings).toHaveBeenCalledWith({ setupComplete: true });
    expect(await screen.findByRole("navigation", { name: "Hub pages" })).toBeTruthy();
  });

  it("never shows an account or sign-in step", async () => {
    const user = userEvent.setup();
    fresh();
    render(<App />);
    await screen.findByTestId("setup");
    for (let step = 0; step < 8; step++) {
      expect(document.body.textContent).not.toMatch(/sign in|log in|password|email/i);
      const forward = screen
        .getAllByRole("button")
        .find((button) => /Get started|Continue|Skip/.test(button.textContent ?? ""));
      if (!forward) break;
      await waitFor(() => expect(forward).toHaveProperty("disabled", false));
      await user.click(forward);
    }
    expect(title()).toBe("All set");
  });

  it("keeps a denied permission step visible with a System Settings link", async () => {
    const user = userEvent.setup();
    fresh({
      getPermissions: vi.fn().mockResolvedValue(permissions({ microphone: "denied" })),
    });
    render(<App />);
    await screen.findByTestId("setup");
    await press(user, "Get started");
    await waitFor(() =>
      expect(screen.getByTestId("setup-permission-status").textContent).toBe("Not granted"),
    );
    expect(screen.getByText("Murmur does not have Microphone access")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", true);
    await press(user, "Open System Settings for Microphone");
    expect(window.murmur.openPermissionSettings).toHaveBeenCalledWith("microphone");
    expect(title()).toBe("Microphone");
  });

  it("asks for a permission only on a click, then shows the new status", async () => {
    const user = userEvent.setup();
    fresh({
      getPermissions: vi.fn().mockResolvedValue(permissions({ microphone: "not_determined" })),
      requestPermission: vi.fn().mockResolvedValue(permissions({})),
    });
    render(<App />);
    await screen.findByTestId("setup");
    await press(user, "Get started");
    expect(window.murmur.requestPermission).not.toHaveBeenCalled();
    await press(user, "Allow Microphone");
    expect(window.murmur.requestPermission).toHaveBeenCalledWith("microphone");
    await waitFor(() =>
      expect(screen.getByTestId("setup-permission-status").textContent).toBe("Granted"),
    );
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", false);
  });

  it("picks up a grant made in System Settings when the window regains focus", async () => {
    const user = userEvent.setup();
    const getPermissions = vi.fn().mockResolvedValue(permissions({ microphone: "denied" }));
    fresh({ getPermissions });
    render(<App />);
    await screen.findByTestId("setup");
    await press(user, "Get started");
    await waitFor(() =>
      expect(screen.getByTestId("setup-permission-status").textContent).toBe("Not granted"),
    );
    getPermissions.mockResolvedValue(permissions({}));
    window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect(screen.getByTestId("setup-permission-status").textContent).toBe("Granted"),
    );
  });

  it("downloads the model with progress, and lets the step be skipped", async () => {
    const user = userEvent.setup();
    const getSetupStatus = vi
      .fn()
      .mockResolvedValue(setupStatus({ state: "missing" }, ["speechModel"]));
    const downloadSpeechModel = vi
      .fn()
      .mockResolvedValue(
        setupStatus({ state: "downloading", downloadedBytes: 324_000_000 }, ["speechModel"]),
      );
    fresh({ getSetupStatus, downloadSpeechModel });
    render(<App />);
    await screen.findByTestId("setup");
    await press(user, "Get started");
    for (let step = 0; step < 3; step++) await press(user, "Continue");
    expect(title()).toBe("Speech model");
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", true);
    await press(user, "Download the speech model");
    expect(downloadSpeechModel).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.getByTestId("setup-model-progress").textContent).toBe("324 MB of 648 MB"),
    );
    await press(user, "Skip for now");
    expect(title()).toBe("Dictation shortcut");
  });

  it("says what is missing on the last steps when dictation is blocked", async () => {
    const user = userEvent.setup();
    fresh({
      getPermissions: vi.fn().mockResolvedValue(permissions({ accessibility: "denied" })),
      getSetupStatus: vi
        .fn()
        .mockResolvedValue(setupStatus({ state: "missing" }, ["accessibility", "speechModel"])),
    });
    render(<App />);
    await screen.findByTestId("setup");
    await press(user, "Get started");
    await press(user, "Continue");
    await press(user, "Skip for now");
    await press(user, "Continue");
    await press(user, "Skip for now");
    await press(user, "Continue");
    expect(title()).toBe("Try it");
    expect(screen.getByText("Dictation is not ready yet")).toBeTruthy();
    await press(user, "Skip");
    expect(title()).toBe("Almost there");
    expect(screen.getByText("Dictation will not start until these are done")).toBeTruthy();
    expect(document.body.textContent).toContain("Accessibility access is not granted.");
  });

  it("shows that the test dictation worked when text arrives in the box", async () => {
    const user = userEvent.setup();
    fresh();
    render(<App />);
    await screen.findByTestId("setup");
    await press(user, "Get started");
    for (let step = 0; step < 5; step++) await press(user, "Continue");
    expect(title()).toBe("Try it");
    await user.type(screen.getByRole("textbox", { name: "Test box" }), "Hello there.");
    expect(screen.getByText("It works")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  it("can be run again from Settings and closed at any step", async () => {
    const user = userEvent.setup();
    window.murmur = createMockApi({
      getPermissions: vi.fn().mockResolvedValue(SAMPLE_PERMISSIONS),
    });
    render(<App />);
    await screen.findByRole("navigation", { name: "Hub pages" });
    await user.click(screen.getByText("Settings"));
    await press(user, "Run setup again");
    expect(title()).toBe("Welcome to Murmur");
    await press(user, "Close setup");
    expect(await screen.findByRole("navigation", { name: "Hub pages" })).toBeTruthy();
    expect(window.murmur.updateSettings).not.toHaveBeenCalled();
  });
});
