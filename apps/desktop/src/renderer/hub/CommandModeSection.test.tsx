// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMMANDS, type SettingsView } from "@murmur/shared";
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
    experimental: { ...SAMPLE_SETTINGS.settings.experimental, commandMode: true },
    commandShortcut: { type: "key" as const, keyCode: 54, modifiers: [] },
  },
  shortcutLabels: { ...SAMPLE_SETTINGS.shortcutLabels, command: "Right Command" },
};

function mount(view: SettingsView = ON) {
  const api = createMockApi({
    getSettings: vi.fn().mockResolvedValue(view),
    updateSettings: vi.fn().mockResolvedValue(view),
  });
  vi.stubGlobal("murmur", api);
  window.murmur = api;
  render(<SettingsSection />);
  return api;
}

describe("Command Mode section", () => {
  it("is shown only while Command Mode is on", async () => {
    mount(SAMPLE_SETTINGS);
    await screen.findByTestId("hold-label");
    expect(screen.queryByText("Command Mode key")).toBeNull();
  });

  it("shows the key, the wake phrase and every command", async () => {
    mount();
    expect(await screen.findByText("Command Mode key")).toBeTruthy();
    expect(screen.getByTestId("command-label")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Commands" });
    expect(list.querySelectorAll("li")).toHaveLength(COMMANDS.length);
    expect(screen.getByRole("button", { name: "Turn off the Command Mode key" })).toBeTruthy();
  });

  it("saves a new wake phrase, and refuses one too short", async () => {
    const api = mount();
    const input = await screen.findByRole("textbox", { name: "Wake phrase" });
    await userEvent.clear(input);
    await userEvent.type(input, "x");
    await userEvent.click(screen.getByRole("button", { name: "Save the wake phrase" }));
    expect((await screen.findAllByText(/Use 2 to 40 letters/)).length).toBeGreaterThan(0);
    expect(api.updateSettings).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, "Okay Notes");
    await userEvent.click(screen.getByRole("button", { name: "Save the wake phrase" }));
    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({
        commandMode: { wakePhrase: "Okay Notes", wakePhraseEnabled: true },
      }),
    );
  });
});
