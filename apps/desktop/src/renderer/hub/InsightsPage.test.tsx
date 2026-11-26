// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InsightsPage } from "./InsightsPage";

vi.mock("./progress-card", () => ({
  renderProgressCard: vi.fn(() => Promise.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))),
}));
import { createMockApi, SAMPLE_SETTINGS } from "./test-api";

beforeEach(() => {
  window.murmur = createMockApi();
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "#");
  vi.unstubAllGlobals();
});

describe("Insights page", () => {
  it("shows the usage cards, streaks and top apps for 30 days", async () => {
    render(<InsightsPage />);
    const words = await screen.findByRole("group", { name: "Words dictated" });
    expect(words.textContent).toContain("1,250");
    expect(window.murmur.insightsView).toHaveBeenCalledWith("30");
    expect(screen.getByRole("group", { name: "Words per minute" }).textContent).toContain("142");
    expect(screen.getByRole("group", { name: "Daily streak" }).textContent).toContain("3 days");
    expect(screen.getByRole("group", { name: "Weekly streak" }).textContent).toContain(
      "This week counts after 3 days.",
    );
    const apps = screen.getByRole("list", { name: "Top apps" });
    expect(within(apps).getAllByRole("listitem")).toHaveLength(3);
    expect(apps.textContent).toContain("Other");
  });

  it("changes the range for every card", async () => {
    const user = userEvent.setup();
    render(<InsightsPage />);
    await screen.findByRole("group", { name: "Words dictated" });
    await user.click(screen.getByRole("button", { name: "Last 7 days" }));
    expect(window.murmur.insightsView).toHaveBeenLastCalledWith("7");
  });

  it("explains an empty range", async () => {
    const empty = { ...(await createMockApi().insightsView("30")), empty: true, words: 0 };
    window.murmur = createMockApi({ insightsView: vi.fn().mockResolvedValue(empty) });
    render(<InsightsPage />);
    expect(await screen.findByText(/Nothing dictated in this range yet/)).toBeTruthy();
  });

  it("exports the range as CSV", async () => {
    const user = userEvent.setup();
    render(<InsightsPage />);
    await screen.findByRole("group", { name: "Words dictated" });
    await user.click(screen.getByRole("button", { name: "Export this range as CSV" }));
    expect(window.murmur.insightsExport).toHaveBeenCalledWith("30");
    expect(await screen.findByText("Saved 7 days as CSV.")).toBeTruthy();
  });

  it("shows the voice summary and phrases", async () => {
    const user = userEvent.setup();
    window.murmur = createMockApi({
      voiceProfileView: vi.fn().mockResolvedValue({
        ...(await createMockApi().voiceProfileView()),
        summary: "You write short sentences.",
        topPhrases: ["sounds good", "let me check"],
      }),
    });
    render(<InsightsPage />);
    await user.click(screen.getByRole("button", { name: "Your voice" }));
    expect(await screen.findByText("You write short sentences.")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Top phrases" }).textContent).toContain("sounds good");
    await user.click(screen.getByRole("button", { name: "Open My Voice" }));
    expect(window.location.hash).toBe("#/my-voice");
  });

  it("says how to turn the voice tab on when Voice Profile is off", async () => {
    const user = userEvent.setup();
    const settings = structuredClone(SAMPLE_SETTINGS);
    settings.settings.voiceProfile.enabled = false;
    window.murmur = createMockApi({ getSettings: vi.fn().mockResolvedValue(settings) });
    render(<InsightsPage />);
    await user.click(screen.getByRole("button", { name: "Your voice" }));
    expect(await screen.findByText(/Voice Profile is off/)).toBeTruthy();
  });

  it("says why there is no leaderboard without a team", async () => {
    const user = userEvent.setup();
    render(<InsightsPage />);
    await user.click(screen.getByRole("button", { name: "Leaderboard" }));
    expect(await screen.findByText("Sign in to a team to see its leaderboard.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists milestones, marks the new ones seen, and makes a progress card", async () => {
    const user = userEvent.setup();
    render(<InsightsPage />);
    const list = await screen.findByRole("list", { name: "Milestones reached" });
    expect(list.textContent).toContain("1,000 words · New");
    expect(screen.getByText("Still ahead: 30-day streak.")).toBeTruthy();
    expect(window.murmur.milestonesSeen).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save a progress card for 1,000 words" }));
    expect(window.murmur.progressCardSave).toHaveBeenCalled();
    expect(await screen.findByText("Progress card saved.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copy a progress card for 1,000 words" }));
    expect(window.murmur.progressCardCopy).toHaveBeenCalled();
  });
});
