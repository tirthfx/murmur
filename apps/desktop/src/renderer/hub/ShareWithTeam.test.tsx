// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DictionaryEntry, Snippet, TeamView } from "@murmur/shared";
import { DictionaryPage } from "./DictionaryPage";
import { SnippetsPage } from "./SnippetsPage";
import { createMockApi, SAMPLE_TEAM_VIEW } from "./test-api";

afterEach(cleanup);

const SIGNED_IN: TeamView = {
  ...SAMPLE_TEAM_VIEW,
  enabled: true,
  state: "signed_in",
  user: { name: "Ada", email: "ada@example.com" },
  teams: [{ id: "t1", name: "Acme", myRole: "member" }],
};

const word: DictionaryEntry = {
  id: "d1",
  term: "Kubernetes",
  replacement: null,
  caseSensitive: false,
  source: "manual",
  starred: false,
  useCount: 0,
  kind: "term",
  hasClip: false,
  createdAt: 1,
  updatedAt: 1,
};

const snippet: Snippet = {
  id: "s1",
  trigger: "addr",
  format: "plain",
  plain: "1 Main St",
  rich: null,
  useCount: 0,
  createdAt: 1,
  updatedAt: 1,
};

describe("sharing an entry with the team", () => {
  it("is offered only while signed in to a team", async () => {
    window.murmur = createMockApi({ dictionaryList: vi.fn().mockResolvedValue([word]) });
    render(<DictionaryPage />);
    await screen.findByText("Kubernetes");
    expect(screen.queryByRole("button", { name: "Share Kubernetes with the team" })).toBeNull();
  });

  it("sends a dictionary entry and says it waits for a review", async () => {
    const teamPropose = vi
      .fn()
      .mockResolvedValue({ ok: true, status: "pending", teamName: "Acme" });
    window.murmur = createMockApi({
      dictionaryList: vi.fn().mockResolvedValue([word]),
      teamView: vi.fn().mockResolvedValue(SIGNED_IN),
      teamPropose,
    });
    render(<DictionaryPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Share Kubernetes with the team" }));
    await waitFor(() =>
      expect(teamPropose).toHaveBeenCalledWith({
        kind: "dictionary",
        term: "Kubernetes",
        replacement: null,
      }),
    );
    expect(await screen.findByText("Sent to Acme. It waits for a review.")).toBeTruthy();
  });

  it("says when it went live, and shows the server's reason when it was refused", async () => {
    const teamPropose = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: "live", teamName: "Acme" })
      .mockResolvedValueOnce({
        ok: false,
        message: "That is already in the shared list for this scope.",
      });
    window.murmur = createMockApi({
      snippetsList: vi.fn().mockResolvedValue([snippet]),
      teamView: vi.fn().mockResolvedValue(SIGNED_IN),
      teamPropose,
    });
    render(<SnippetsPage />);
    const button = await screen.findByRole("button", { name: "Share addr with the team" });
    fireEvent.click(button);
    expect(await screen.findByText("Shared with Acme.")).toBeTruthy();
    expect(teamPropose).toHaveBeenCalledWith({
      kind: "snippet",
      trigger: "addr",
      expansion: "1 Main St",
    });
    fireEvent.click(button);
    expect(
      await screen.findByText("That is already in the shared list for this scope."),
    ).toBeTruthy();
  });
});
