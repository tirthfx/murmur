// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EXTENSIONS_SETTINGS,
  EXTENSION_ACTIONS,
  PLANNED_EXTENSIONS,
  type ExtensionsSettings,
  type ExtensionsView,
} from "@murmur/shared";
import { ExtensionsPage } from "./ExtensionsPage";
import { createMockApi } from "./test-api";

const view = (
  over: Partial<Record<string, ExtensionsView["actions"][number]["status"]>> = {},
): ExtensionsView => ({
  enabled: true,
  actions: EXTENSION_ACTIONS.map((action) => ({
    ...action,
    enabled: false,
    status: over[action.id] ?? {
      state: "off",
      reason: `Turn on “${action.name}” on the Extensions page.`,
      hidden: true,
    },
    accounts: action.id === "draft_email" ? ["me@gmail.test"] : [],
  })),
  planned: [...PLANNED_EXTENSIONS],
});

let api: ReturnType<typeof createMockApi>;

async function mount(settings: ExtensionsSettings = DEFAULT_EXTENSIONS_SETTINGS, v = view()) {
  const base = await api.getSettings();
  api.getSettings = vi
    .fn()
    .mockResolvedValue({ ...base, settings: { ...base.settings, extensions: settings } });
  api.extensionsView = vi.fn().mockResolvedValue(v);
  render(<ExtensionsPage />);
  return screen.findByRole("list", { name: "Extensions" });
}

beforeEach(() => {
  api = createMockApi();
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

describe("Extensions page (CN-12)", () => {
  it("lists the built-in actions, each off until turned on, with what it uses and that a click confirms it", async () => {
    const list = within(await mount());
    for (const action of EXTENSION_ACTIONS) {
      const row = within(list.getByRole("listitem", { name: action.name }));
      expect(row.getByText("Off")).toBeTruthy();
      expect(row.getByText(/You always click to confirm it\./)).toBeTruthy();
      expect(row.getByText(new RegExp(`It asks for: ${action.permission}`))).toBeTruthy();
      expect(
        (row.getByRole("switch", { name: `Allow “${action.name}”` }) as HTMLInputElement).checked,
      ).toBe(false);
    }
    expect(screen.getByText(/no code from anywhere else runs/)).toBeTruthy();
    expect(
      screen.getByText(/a model may suggest an action, but it can never run one/i),
    ).toBeTruthy();
  });

  it("turns one action on without touching the others, and the master switch off", async () => {
    await mount();
    fireEvent.click(screen.getByRole("switch", { name: "Allow “Draft email”" }));
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({
        extensions: { enabled: true, actions: { draft_email: true, create_event: false } },
      }),
    );
    fireEvent.click(screen.getByRole("switch", { name: "Turn on extensions" }));
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenLastCalledWith({
        extensions: { enabled: false, actions: { draft_email: false, create_event: false } },
      }),
    );
  });

  it("cannot turn an action on while extensions are off", async () => {
    await mount({ enabled: false, actions: { draft_email: false, create_event: false } });
    const toggle = screen.getByRole("switch", { name: "Allow “Draft email”" });
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
  });

  it("shows the state and the reason an action is not ready, and the accounts of one that is", async () => {
    const list = within(
      await mount(
        { enabled: true, actions: { draft_email: true, create_event: true } },
        view({
          draft_email: { state: "ready", reason: null, hidden: false },
          create_event: {
            state: "blocked",
            reason: "Its account needs to be connected again.",
            hidden: false,
          },
        }),
      ),
    );
    const draft = within(list.getByRole("listitem", { name: "Draft email" }));
    expect(draft.getByText("Ready")).toBeTruthy();
    expect(draft.getByText(/Uses me@gmail\.test/)).toBeTruthy();
    const event = within(list.getByRole("listitem", { name: "Create event" }));
    expect(event.getByText("Needs attention")).toBeTruthy();
    expect(event.getByText("Its account needs to be connected again.")).toBeTruthy();
  });

  it("lists what is not built yet", async () => {
    await mount();
    const planned = within(screen.getByRole("list", { name: "Actions not built yet" }));
    expect(planned.getByText(/Send to Slack/)).toBeTruthy();
  });
});
