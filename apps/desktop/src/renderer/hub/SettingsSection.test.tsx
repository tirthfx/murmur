// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSection } from "./SettingsSection";
import type { SettingsPageId } from "./settings-pages";
import { createMockApi, SAMPLE_SETTINGS } from "./test-api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(
  overrides: Parameters<typeof createMockApi>[0] = {},
  page: SettingsPageId = "shortcuts",
) {
  const api = createMockApi(overrides);
  vi.stubGlobal("murmur", api);
  window.murmur = api;
  render(<SettingsSection page={page} onRunSetup={() => {}} />);
  return api;
}

describe("Settings section", () => {
  it("shows the shortcuts by name", async () => {
    mount();
    expect(await screen.findByTestId("hold-label")).toBeTruthy();
    expect(screen.getByText("Push to talk")).toBeTruthy();
    expect(screen.getByText("Hands-free")).toBeTruthy();
  });

  it("records a new shortcut from the keyboard and pauses dictation meanwhile", async () => {
    const api = mount();
    await screen.findByTestId("hold-label");
    await userEvent.click(screen.getByRole("button", { name: "Change the Hands-free shortcut" }));
    await waitFor(() => expect(api.captureShortcut).toHaveBeenCalledWith(true));
    fireEvent.keyDown(window, { code: "KeyD", ctrlKey: true, altKey: true });
    await waitFor(() =>
      expect(api.setShortcut).toHaveBeenCalledWith("handsFree", {
        code: "KeyD",
        modifiers: ["option", "control"],
      }),
    );
    expect(api.captureShortcut).toHaveBeenLastCalledWith(false);
  });

  it("shows why a shortcut was refused", async () => {
    mount({
      setShortcut: vi
        .fn()
        .mockResolvedValue({ ok: false, message: "Command+Space is used by macOS for Spotlight." }),
    });
    await screen.findByTestId("hold-label");
    await userEvent.click(screen.getByRole("button", { name: "Change the Push to talk shortcut" }));
    fireEvent.keyDown(window, { code: "Space", metaKey: true });
    expect(await screen.findByText("Command+Space is used by macOS for Spotlight.")).toBeTruthy();
  });

  it("offers the double tap back once hands-free has its own shortcut", async () => {
    const withChord = {
      ...SAMPLE_SETTINGS,
      settings: {
        ...SAMPLE_SETTINGS.settings,
        handsFreeShortcut: { type: "key" as const, keyCode: 2, modifiers: ["control" as const] },
      },
      shortcutLabels: { ...SAMPLE_SETTINGS.shortcutLabels, handsFree: "Control+D" },
    };
    const api = mount({ getSettings: vi.fn().mockResolvedValue(withChord) });
    await userEvent.click(
      await screen.findByRole("button", { name: "Use a double tap for hands-free" }),
    );
    expect(api.setShortcut).toHaveBeenCalledWith("handsFree", null);
  });

  it("shows the Rewrite shortcut and turns it off", async () => {
    const withRewrite = {
      ...SAMPLE_SETTINGS,
      settings: {
        ...SAMPLE_SETTINGS.settings,
        rewriteShortcut: {
          type: "key" as const,
          keyCode: 15,
          modifiers: ["control" as const, "option" as const],
        },
      },
      shortcutLabels: { ...SAMPLE_SETTINGS.shortcutLabels, rewrite: "Control+Option+R" },
    };
    const api = mount({ getSettings: vi.fn().mockResolvedValue(withRewrite) });
    await userEvent.click(
      await screen.findByRole("button", { name: "Turn off the Rewrite shortcut" }),
    );
    expect(api.setShortcut).toHaveBeenCalledWith("rewrite", null);
  });

  it("records an extra mouse button, ignores left and right, and pauses dictation meanwhile", async () => {
    const user = userEvent.setup();
    const api = mount();
    await screen.findByTestId("hold-label");
    expect(screen.getByTestId("Push to talk (mouse)-mouse").textContent).toBe("Not set");
    await user.click(
      screen.getByRole("button", { name: "Set the Push to talk (mouse) mouse button" }),
    );
    expect(api.captureShortcut).toHaveBeenCalledWith(true);
    fireEvent.mouseDown(window, { button: 2 });
    expect(api.updateSettings).not.toHaveBeenCalled();
    fireEvent.mouseDown(window, { button: 3 });
    expect(api.updateSettings).toHaveBeenCalledWith({
      mouseButtons: { hold: 3, handsFree: null, pressEnter: null, copyLast: null },
    });
    expect(api.captureShortcut).toHaveBeenLastCalledWith(false);
  });

  it("explains when settings cannot be read", async () => {
    mount({ getSettings: vi.fn().mockRejectedValue(new Error("x")) });
    expect(await screen.findByText("Settings could not be read.")).toBeTruthy();
  });

  it("offers to put a changed setting back, and says when it saved (HB-12)", async () => {
    const view = structuredClone(SAMPLE_SETTINGS);
    view.changed = ["muteWhileDictating"];
    const resetSettings = vi.fn().mockResolvedValue({ ...view, changed: [] });
    window.murmur = createMockApi({
      getSettings: vi.fn().mockResolvedValue(view),
      resetSettings,
    });
    render(<SettingsSection page="system" onRunSetup={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Put mute back to the default" }));
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(resetSettings).toHaveBeenCalledWith(["muteWhileDictating"]);
    expect(screen.queryByRole("button", { name: "Put mute back to the default" })).toBeNull();
  });

  it("turns a sound off and mute while dictating on", async () => {
    const api = mount({}, "system");
    await userEvent.click(await screen.findByRole("switch", { name: "Done sound" }));
    expect(api.updateSettings).toHaveBeenCalledWith({
      sounds: {
        start: true,
        lock: true,
        success: false,
        error: true,
        cancel: false,
        milestone: true,
        set: "subtle",
      },
    });
    await userEvent.click(screen.getByRole("switch", { name: "Mute other audio while dictating" }));
    expect(api.updateSettings).toHaveBeenCalledWith({ muteWhileDictating: true });
  });

  it("sets the recording notice and the meeting detection switches (NT-25, NT-01)", async () => {
    const api = mount({}, "system");
    expect(await screen.findByText("Meeting detection")).toBeTruthy();
    await userEvent.click(screen.getByRole("switch", { name: "Detect meetings" }));
    expect(api.updateSettings).toHaveBeenCalledWith({
      notetaker: expect.objectContaining({
        detect: expect.objectContaining({ enabled: false }),
      }),
    });
    await userEvent.click(screen.getByRole("switch", { name: "Google Meet" }));
    expect(api.updateSettings).toHaveBeenLastCalledWith({
      notetaker: expect.objectContaining({
        detect: expect.objectContaining({
          apps: { zoom: true, meet: false, teams: true },
        }),
      }),
    });
    await userEvent.click(
      screen.getByRole("switch", { name: "Record detected meetings without asking" }),
    );
    expect(api.updateSettings).toHaveBeenLastCalledWith({
      notetaker: expect.objectContaining({
        detect: expect.objectContaining({ autoRecord: true }),
      }),
    });
    expect(screen.getByText("Recording notice")).toBeTruthy();
  });

  it("sets how long meeting audio and transcripts are kept, and says what is due (NT-22)", async () => {
    const api = mount(
      { meetingRetentionDue: vi.fn().mockResolvedValue({ audio: 2, transcripts: 1 }) },
      "system",
    );
    expect(await screen.findByText("Meeting recordings and transcripts")).toBeTruthy();
    expect(
      await screen.findByText(
        "In the next 24 hours: 2 recordings and 1 transcript will be deleted.",
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("combobox", { name: "Keep the audio" }));
    await userEvent.click(await screen.findByRole("option", { name: "Delete after processing" }));
    expect(api.updateSettings).toHaveBeenLastCalledWith({
      notetaker: expect.objectContaining({
        retention: expect.objectContaining({ audio: "processing", transcript: "forever" }),
      }),
    });
    await userEvent.click(screen.getByRole("combobox", { name: "Keep the transcript" }));
    await userEvent.click(await screen.findByRole("option", { name: "90 days" }));
    expect(api.updateSettings).toHaveBeenLastCalledWith({
      notetaker: expect.objectContaining({
        retention: expect.objectContaining({ transcript: "90d" }),
      }),
    });
    await userEvent.click(
      screen.getByRole("switch", { name: "Delete the summaries with the transcript" }),
    );
    expect(api.updateSettings).toHaveBeenLastCalledWith({
      notetaker: expect.objectContaining({
        retention: expect.objectContaining({ removeSummaryWithTranscript: true }),
      }),
    });
  });

  it("sets how imported transcripts are handled (NT-21)", async () => {
    const api = mount({}, "system");
    expect(await screen.findByText("Importing transcripts")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("switch", { name: "Write a summary for an imported meeting" }),
    );
    expect(api.updateSettings).toHaveBeenLastCalledWith({
      notetaker: expect.objectContaining({
        import: expect.objectContaining({ regenerateSummary: false }),
      }),
    });
  });

  it("sets dictated lines and the recap window (NT-19, NT-13)", async () => {
    const api = mount({}, "system");
    expect(await screen.findByText("Dictating and catching up during a meeting")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("switch", { name: "Leave dictated lines out of the transcript" }),
    );
    expect(api.updateSettings).toHaveBeenLastCalledWith({
      notetaker: expect.objectContaining({ dictation: { excludeFromTranscript: false } }),
    });
    await userEvent.click(screen.getByRole("combobox", { name: "“What did I miss?” looks back" }));
    await userEvent.click(await screen.findByRole("option", { name: "15 minutes" }));
    expect(api.updateSettings).toHaveBeenLastCalledWith({
      notetaker: expect.objectContaining({ recap: { windowMinutes: 15 } }),
    });
  });

  it("says when nothing is due", async () => {
    mount({}, "system");
    expect(await screen.findByText("Nothing is due in the next 24 hours.")).toBeTruthy();
  });
});
