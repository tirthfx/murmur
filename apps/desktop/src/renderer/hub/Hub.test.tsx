// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { PAGES } from "./pages";

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
    window.murmur = {
      getAppInfo: vi
        .fn()
        .mockResolvedValue({ name: "Murmur", version: "1.2.3", platform: "darwin" }),
    };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists every planned page in the navigation", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Hub pages" });
    for (const page of PAGES) {
      expect(nav.textContent).toContain(page.title);
    }
    expect(PAGES.map((page) => page.title)).toEqual([
      "Home",
      "Dictionary",
      "Snippets",
      "Styles",
      "Rewrites",
      "Scratchpad",
      "Notetaker",
      "Tasks",
      "Insights",
      "Settings",
    ]);
  });

  it("starts on Home and switches page when a navigation item is chosen", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeTruthy();

    await user.click(screen.getByText("Snippets"));

    expect(screen.getByRole("heading", { level: 1, name: "Snippets" })).toBeTruthy();
    expect(screen.getByText("No snippets yet")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: "Home" })).toBeNull();
  });

  it("shows the app version from the preload API", async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId("app-version").textContent).toBe("Version 1.2.3"),
    );
    expect(window.murmur.getAppInfo).toHaveBeenCalledOnce();
  });

  it("still renders when the version cannot be read", async () => {
    window.murmur = { getAppInfo: vi.fn().mockRejectedValue(new Error("nope")) };
    render(<App />);
    await waitFor(() => expect(window.murmur.getAppInfo).toHaveBeenCalled());
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeTruthy();
    expect(screen.queryByTestId("app-version")).toBeNull();
  });
});
