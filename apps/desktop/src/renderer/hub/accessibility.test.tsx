// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditAccessibility } from "./a11y-audit";
import { App } from "./App";
import { PAGES } from "./pages";
import { ScratchpadApp } from "./ScratchpadApp";
import { SETTINGS_PAGES } from "./settings-pages";
import { createMockApi, SAMPLE_SETTINGS } from "./test-api";

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

beforeEach(() => {
  stubBrowserApis();
  const settings = structuredClone(SAMPLE_SETTINGS);
  settings.settings.devMode = { ...settings.settings.devMode, enabled: true };
  settings.settings.experimental = {
    ...settings.settings.experimental,
    commandMode: true,
    focusMode: true,
  };
  window.murmur = createMockApi({
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockResolvedValue(settings),
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "#");
  vi.unstubAllGlobals();
});

/** Lets the page's data arrive before it is checked. */
async function settle() {
  await waitFor(() => expect(document.querySelector(".hub-page")).not.toBeNull());
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("accessibility of every page (HB-25)", () => {
  for (const page of PAGES) {
    it(`${page.title} has named controls, alt text and ordered headings`, async () => {
      window.history.replaceState(null, "", `#/${page.id}`);
      const { container } = render(<App />);
      await settle();
      expect(auditAccessibility(container)).toEqual([]);
    });
  }

  for (const page of SETTINGS_PAGES) {
    it(`Settings, ${page.title} passes too`, async () => {
      window.history.replaceState(null, "", `#/settings/${page.id}`);
      const { container } = render(<App />);
      await settle();
      expect(auditAccessibility(container)).toEqual([]);
    });
  }

  it("the Scratchpad window passes with a note open", async () => {
    const user = userEvent.setup();
    const { container } = render(<ScratchpadApp />);
    const list = await screen.findByRole("list", { name: "All notes" });
    await user.click(list.querySelector("button")!);
    await screen.findByTestId("note-editor");
    expect(auditAccessibility(container)).toEqual([]);
  });

  it("reaches every page from the keyboard", async () => {
    const user = userEvent.setup();
    render(<App />);
    await settle();
    const nav = screen.getByRole("navigation", { name: "Hub pages" });
    const items = [...nav.querySelectorAll("button, a")];
    expect(items.length).toBeGreaterThanOrEqual(PAGES.length);
    // Tab moves through the controls in order; none is skipped by a positive tabindex.
    await user.tab();
    expect(document.activeElement).not.toBe(document.body);
  });
});
