// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamLeaderboard } from "./TeamLeaderboard";
import { createMockApi } from "./test-api";

afterEach(cleanup);

describe("team leaderboard (TM-26)", () => {
  it("lists ranks, marks the person and saves their choice", async () => {
    window.murmur = createMockApi();
    vi.mocked(window.murmur.teamLeaderboard).mockResolvedValue({
      ok: true,
      teamName: "Design",
      board: {
        enabled: true,
        metric: "words",
        period: "week",
        ranks: [
          { rank: 1, name: "Ada", value: null, isMe: false },
          { rank: 2, name: "Cy", value: 1200, isMe: true },
        ],
        total: 4000,
        hiddenCount: 1,
        me: { visible: true, value: 1200, rank: 2 },
      },
    });
    render(<TeamLeaderboard />);
    expect(await screen.findByText(/2\. Cy \(you\) · 1,200/)).toBeTruthy();
    expect(screen.getByText(/1 not listed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "List me on the leaderboard" }));
    await waitFor(() => expect(window.murmur.teamLeaderboardShow).toHaveBeenCalledWith(false));
  });

  it("says why there is none", async () => {
    window.murmur = createMockApi();
    render(<TeamLeaderboard />);
    expect(await screen.findByText(/Sign in to a team/)).toBeTruthy();
  });
});
