// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { PAGES } from "./pages";
import { createMockApi } from "./test-api";

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

describe("Hub", () => {
  beforeEach(() => {
    stubBrowserApis();
    window.murmur = createMockApi();
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "#");
    vi.unstubAllGlobals();
  });

  it("lists every planned page in the navigation", async () => {
    render(<App />);
    await screen.findByRole("navigation", { name: "Hub pages" });
    const nav = screen.getByRole("navigation", { name: "Hub pages" });
    for (const page of PAGES) {
      expect(nav.textContent).toContain(page.title);
    }
    expect(PAGES.map((page) => page.title)).toEqual([
      "Home",
      "Dictation",
      "Dictionary",
      "Snippets",
      "Styles",
      "Rewrites",
      "Instruct",
      "Scratchpad",
      "History",
      "My Voice",
      "Memory",
      "Insights",
      "Settings",
      "Help",
    ]);
  });

  it("opens the page named in the hash and remembers a chosen page", async () => {
    window.history.replaceState(null, "", "#/insights");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("navigation", { name: "Hub pages" });
    expect(screen.getByRole("heading", { level: 1, name: "Insights" })).toBeTruthy();

    await user.click(screen.getByText("History"));
    expect(window.location.hash).toBe("#/history");
    expect(window.murmur.hubSetPage).toHaveBeenCalledWith("history");
  });

  it("shows Home for an unknown page", async () => {
    window.history.replaceState(null, "", "#/lens");
    render(<App />);
    await screen.findByRole("navigation", { name: "Hub pages" });
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeTruthy();
  });

  it("starts on Home and switches page when a navigation item is chosen", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("navigation", { name: "Hub pages" });

    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeTruthy();

    await user.click(screen.getByText("Help"));

    expect(screen.getByRole("heading", { level: 1, name: "Help" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Guided tours" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Home" })).toBeNull();
  });

  it("shows the app version from the preload API", async () => {
    render(<App />);
    await screen.findByRole("navigation", { name: "Hub pages" });
    await waitFor(() =>
      expect(screen.getByTestId("app-version").textContent).toBe("Version 1.2.3"),
    );
    expect(window.murmur.getAppInfo).toHaveBeenCalledOnce();
  });

  it("still renders when the version cannot be read", async () => {
    window.murmur = createMockApi({
      getAppInfo: vi.fn().mockRejectedValue(new Error("nope")),
      getHelperStatus: vi.fn().mockRejectedValue(new Error("nope")),
    });
    render(<App />);
    await screen.findByRole("navigation", { name: "Hub pages" });
    await waitFor(() => expect(window.murmur.getAppInfo).toHaveBeenCalled());
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeTruthy();
    expect(screen.queryByTestId("app-version")).toBeNull();
  });

  it("shows the helper status on the Settings page only", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("navigation", { name: "Hub pages" });
    expect(screen.queryByTestId("helper-status")).toBeNull();

    await user.click(screen.getByText("Settings"));

    await waitFor(() =>
      expect(screen.getByTestId("helper-status").textContent).toBe("Helper: ready (version 0.1.0)"),
    );
  });

  it("explains when the helper is unavailable", async () => {
    window.murmur.getHelperStatus = vi.fn().mockResolvedValue({
      state: "unavailable",
      helperVersion: null,
      message: "The helper has not been built.",
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("navigation", { name: "Hub pages" });
    await user.click(screen.getByText("Settings"));
    await waitFor(() =>
      expect(screen.getByTestId("helper-status").textContent).toBe(
        "Helper: unavailable. The helper has not been built.",
      ),
    );
  });
});
