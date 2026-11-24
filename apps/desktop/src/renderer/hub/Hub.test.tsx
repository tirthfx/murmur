// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_POLICY_VIEW, type PolicyView } from "@murmur/shared";
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

/** A busy CI machine can take longer than the default second to settle a render. */
const SLOW_CI = { timeout: 5000 };

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
      "Notetaker",
      "Connectors",
      "Extensions",
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
      "Team",
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

describe("Hub with a policy in force (TM-14, TM-21)", () => {
  beforeEach(() => {
    stubBrowserApis();
  });
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "#");
    vi.unstubAllGlobals();
  });

  const policyView = (patch: Partial<PolicyView>): PolicyView => ({
    ...EMPTY_POLICY_VIEW,
    ...patch,
  });

  it("does not list a page the organization has turned off", async () => {
    window.murmur = createMockApi({
      policyView: vi
        .fn()
        .mockResolvedValue(
          policyView({ active: true, featuresOff: ["scratchpad", "transforms", "connectors"] }),
        ),
    });
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Hub pages" }, SLOW_CI);
    await waitFor(() => expect(nav.textContent).not.toContain("Scratchpad"), SLOW_CI);
    expect(nav.textContent).not.toContain("Rewrites");
    expect(nav.textContent).not.toContain("Connectors");
    expect(nav.textContent).toContain("Notetaker");
    expect(nav.textContent).toContain("History");
  });

  it("says when the Mac is managed, and that updates are managed", async () => {
    window.murmur = createMockApi({
      policyView: vi.fn().mockResolvedValue(
        policyView({
          managed: true,
          active: true,
          updates: { policy: "off", managed: true, canCheck: false },
        }),
      ),
    });
    render(<App />);
    expect((await screen.findByTestId("managed-badge", undefined, SLOW_CI)).textContent).toBe(
      "Managed by your organization",
    );
    expect(screen.getByTestId("updates-managed").textContent).toBe(
      "Updates are managed by your organization",
    );
  });

  it("shows neither when nothing is managed", async () => {
    window.murmur = createMockApi();
    render(<App />);
    await screen.findByRole("navigation", { name: "Hub pages" }, SLOW_CI);
    expect(screen.queryByTestId("managed-badge")).toBeNull();
    expect(screen.queryByTestId("updates-managed")).toBeNull();
  });

  it("follows a policy change that arrives while the Hub is open", async () => {
    let push: (view: PolicyView) => void = () => undefined;
    window.murmur = createMockApi({
      onPolicyChanged: vi.fn((handler: (view: PolicyView) => void) => {
        push = handler;
        return () => undefined;
      }),
    });
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Hub pages" }, SLOW_CI);
    expect(nav.textContent).toContain("Scratchpad");
    push(policyView({ active: true, featuresOff: ["scratchpad"] }));
    await waitFor(() => expect(nav.textContent).not.toContain("Scratchpad"), SLOW_CI);
  });

  it("explains on the Notetaker page that recording is off, while meetings stay listed", async () => {
    window.history.replaceState(null, "", "#/notetaker");
    window.murmur = createMockApi({
      policyView: vi.fn().mockResolvedValue(
        policyView({
          active: true,
          featuresOff: ["notetaker"],
          adminContact: "it@acme.test",
        }),
      ),
    });
    render(<App />);
    const note = await screen.findByTestId("policy-off-notetaker", undefined, SLOW_CI);
    expect(note.textContent).toContain("Turned off by your organization");
    expect(note.textContent).toContain("it@acme.test");
  });
});
