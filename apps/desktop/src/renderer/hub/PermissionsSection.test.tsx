// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { createMockApi, SAMPLE_PERMISSIONS } from "./test-api";

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

async function openSettings() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByText("Settings"));
  await screen.findByRole("heading", { level: 2, name: "Permissions" });
  return user;
}

const row = (kind: string) => screen.getByTestId(`permission-${kind}`);

describe("Permissions section", () => {
  beforeEach(() => {
    stubBrowserApis();
    window.murmur = createMockApi();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not check or request anything until the Settings page is open", async () => {
    render(<App />);
    await waitFor(() => expect(window.murmur.getAppInfo).toHaveBeenCalled());
    expect(window.murmur.getPermissions).not.toHaveBeenCalled();
    expect(window.murmur.requestPermission).not.toHaveBeenCalled();
  });

  it("renders four rows with a reason each", async () => {
    await openSettings();
    for (const [kind, title] of [
      ["microphone", "Microphone"],
      ["accessibility", "Accessibility"],
      ["inputMonitoring", "Input Monitoring"],
      ["screenRecording", "Screen Recording"],
    ] as const) {
      const r = within(row(kind));
      expect(r.getByText(title)).toBeTruthy();
      expect(r.getByRole("button", { name: `Open System Settings for ${title}` })).toBeTruthy();
    }
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("shows the status of each permission", async () => {
    await openSettings();
    await waitFor(() =>
      expect(screen.getByTestId("permission-status-microphone").textContent).toBe("Granted"),
    );
    expect(screen.getByTestId("permission-status-accessibility").textContent).toBe("Not granted");
    expect(screen.getByTestId("permission-status-inputMonitoring").textContent).toBe(
      "Not asked yet",
    );
    expect(screen.getByTestId("permission-status-screenRecording").textContent).toBe("Unknown");
  });

  it("requests nothing on load, and Request calls the API with the right kind", async () => {
    const user = await openSettings();
    expect(window.murmur.requestPermission).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Request Accessibility" }));
    expect(window.murmur.requestPermission).toHaveBeenCalledExactlyOnceWith("accessibility");

    await user.click(screen.getByRole("button", { name: "Request Input Monitoring" }));
    expect(window.murmur.requestPermission).toHaveBeenLastCalledWith("inputMonitoring");
    expect(window.murmur.requestPermission).toHaveBeenCalledTimes(2);
  });

  it("has no Request button for Screen Recording", async () => {
    await openSettings();
    expect(within(row("screenRecording")).queryByRole("button", { name: /^Request/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Request / })).toHaveLength(3);
  });

  it("disables Request once a permission is granted", async () => {
    await openSettings();
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Request Microphone" }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
  });

  it("opens the System Settings pane by kind", async () => {
    const user = await openSettings();
    await user.click(screen.getByRole("button", { name: "Open System Settings for Microphone" }));
    expect(window.murmur.openPermissionSettings).toHaveBeenCalledExactlyOnceWith("microphone");
    await user.click(
      screen.getByRole("button", { name: "Open System Settings for Screen Recording" }),
    );
    expect(window.murmur.openPermissionSettings).toHaveBeenLastCalledWith("screenRecording");
  });

  it("refreshes statuses when the window gains focus", async () => {
    await openSettings();
    await waitFor(() => expect(window.murmur.getPermissions).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("permission-status-accessibility").textContent).toBe("Not granted");

    window.murmur.getPermissions = vi.fn().mockResolvedValue({
      ...SAMPLE_PERMISSIONS,
      statuses: { ...SAMPLE_PERMISSIONS.statuses, accessibility: "granted" },
    });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("permission-status-accessibility").textContent).toBe("Granted"),
    );
    expect(window.murmur.getPermissions).toHaveBeenCalledTimes(1);
  });

  it("stops listening for focus when the page is left", async () => {
    const user = await openSettings();
    const getPermissions = window.murmur.getPermissions as ReturnType<typeof vi.fn>;
    await user.click(screen.getByText("Home"));
    getPermissions.mockClear();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(getPermissions).not.toHaveBeenCalled();
  });

  it("shows the helper's message when statuses are unknown", async () => {
    window.murmur = createMockApi({
      getPermissions: vi.fn().mockResolvedValue({
        statuses: {
          microphone: "unknown",
          accessibility: "unknown",
          inputMonitoring: "unknown",
          screenRecording: "unknown",
        },
        message: "The helper is not running, so permission status is unknown.",
      }),
    });
    await openSettings();
    await waitFor(() =>
      expect(screen.getByTestId("permissions-message").textContent).toMatch(
        /helper is not running/,
      ),
    );
    expect(screen.getByTestId("permission-status-microphone").textContent).toBe("Unknown");
  });

  it("says so when the status cannot be read at all", async () => {
    window.murmur = createMockApi({ getPermissions: vi.fn().mockRejectedValue(new Error("x")) });
    await openSettings();
    await waitFor(() =>
      expect(screen.getByTestId("permissions-message").textContent).toBe(
        "Could not read permission status.",
      ),
    );
  });

  it("shows the fresh statuses returned by a request", async () => {
    window.murmur = createMockApi({
      requestPermission: vi.fn().mockResolvedValue({
        ...SAMPLE_PERMISSIONS,
        statuses: { ...SAMPLE_PERMISSIONS.statuses, inputMonitoring: "granted" },
      }),
    });
    const user = await openSettings();
    await user.click(screen.getByRole("button", { name: "Request Input Monitoring" }));
    await waitFor(() =>
      expect(screen.getByTestId("permission-status-inputMonitoring").textContent).toBe("Granted"),
    );
  });
});
