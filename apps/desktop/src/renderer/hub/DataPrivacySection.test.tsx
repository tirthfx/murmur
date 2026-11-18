// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataPrivacySection } from "./DataPrivacySection";
import { createMockApi, SAMPLE_SETTINGS } from "./test-api";

beforeEach(() => {
  window.murmur = createMockApi();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(change: (settings: typeof SAMPLE_SETTINGS.settings) => void = () => {}) {
  const settings = structuredClone(SAMPLE_SETTINGS.settings);
  change(settings);
  const update = vi.fn();
  render(<DataPrivacySection settings={settings} update={update} />);
  return update;
}

describe("Data and Privacy (HB-21, HB-48 to HB-52)", () => {
  it("says nothing leaves this Mac, with the model download exception", () => {
    mount();
    expect(screen.getByText("Nothing leaves this Mac.")).toBeTruthy();
    expect(screen.getByText(/model download that you start/)).toBeTruthy();
  });

  it("shows the preset the switches match, and Custom after one changes", () => {
    mount();
    expect(screen.getByTestId("privacy-preset").textContent).toContain("Balanced");
    cleanup();
    mount((settings) => {
      settings.learnCorrections = false;
    });
    expect(screen.getByTestId("privacy-preset").textContent).toContain("Custom");
  });

  it("applies the Minimal preset to every switch", async () => {
    const update = mount();
    await userEvent.click(screen.getByRole("radio", { name: "Minimal" }));
    expect(update).toHaveBeenCalledWith({
      privacy: { storeHistory: true, audio: "never", historyDays: 7, strictLocal: false },
      contextAwareness: true,
      learnCorrections: false,
      voiceProfile: expect.objectContaining({ enabled: false }),
    });
  });

  it("turns Store history off and sets text retention", async () => {
    const update = mount();
    await userEvent.click(screen.getByRole("switch", { name: "Keep dictations in History" }));
    expect(update).toHaveBeenCalledWith({
      privacy: expect.objectContaining({ storeHistory: false }),
    });
    await userEvent.click(screen.getByRole("radio", { name: "30 days" }));
    expect(update).toHaveBeenCalledWith({ privacy: expect.objectContaining({ historyDays: 30 }) });
  });

  it("shows storage and the last retention run, and runs it now", async () => {
    mount();
    expect((await screen.findByRole("list", { name: "Storage by part" })).textContent).toContain(
      "Database: 2.0 MB",
    );
    expect((await screen.findByTestId("retention-status")).textContent).toContain(
      "Removed 3 recordings",
    );
    await userEvent.click(screen.getByRole("button", { name: "Run the retention rules now" }));
    expect(window.murmur.retentionRun).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Show the data folder in Finder" }));
    expect(window.murmur.storageOpen).toHaveBeenCalled();
  });

  it("asks before turning strict local mode on, and turns learning off with it", async () => {
    const update = mount();
    await userEvent.click(screen.getByRole("button", { name: "Turn strict local mode on" }));
    expect(update).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm turning strict local mode on" }),
    );
    expect(update).toHaveBeenCalledWith({
      privacy: expect.objectContaining({ strictLocal: true, audio: "never" }),
      learnCorrections: false,
      voiceProfile: expect.objectContaining({ enabled: false }),
    });
  });

  it("asks before turning strict local mode off, and says no download happens while on", async () => {
    const update = mount((settings) => {
      settings.privacy = { ...settings.privacy, strictLocal: true };
    });
    expect(screen.getByText(/not even to download a model/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Turn strict local mode off" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm turning strict local mode off" }),
    );
    expect(update).toHaveBeenCalledWith({
      privacy: expect.objectContaining({ strictLocal: false }),
    });
  });
});
