// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryPage, rangeStart } from "./HistoryPage";
import { createMockApi } from "./test-api";

beforeEach(() => {
  window.murmur = createMockApi();
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "#");
  vi.unstubAllGlobals();
});

describe("rangeStart", () => {
  const now = new Date(2026, 10, 18, 15, 0);
  it("starts at local midnight", () => {
    expect(rangeStart("all", now)).toBeNull();
    expect(rangeStart("today", now)).toBe(new Date(2026, 10, 18).getTime());
    expect(rangeStart("7", now)).toBe(new Date(2026, 10, 12).getTime());
  });
});

describe("History page", () => {
  it("lists dictations with their app, status and text", async () => {
    render(<HistoryPage />);
    const list = await screen.findByRole("list", { name: "Dictations" });
    expect(within(list).getByText("So we go at three.")).toBeTruthy();
    expect(within(list).getByText(/Notes · Done · EN/)).toBeTruthy();
    expect(within(list).getByText(/Interrupted/)).toBeTruthy();
    expect(screen.getByTestId("history-count").textContent).toBe("2 dictations");
  });

  it("searches after typing stops", async () => {
    const user = userEvent.setup();
    render(<HistoryPage />);
    await screen.findByRole("list", { name: "Dictations" });
    await user.type(screen.getByRole("textbox", { name: "Search history" }), "three");
    await waitFor(() =>
      expect(window.murmur.historyPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ text: "three", archived: false, offset: 0 }),
      ),
    );
  });

  it("shows archived rows only with the switch", async () => {
    const user = userEvent.setup();
    render(<HistoryPage />);
    await screen.findByRole("list", { name: "Dictations" });
    await user.click(screen.getByRole("switch", { name: "Show archived only" }));
    await waitFor(() =>
      expect(window.murmur.historyPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ archived: true }),
      ),
    );
  });

  it("archives one row and asks before deleting it", async () => {
    const user = userEvent.setup();
    render(<HistoryPage />);
    const list = await screen.findByRole("list", { name: "Dictations" });
    const [first] = within(list).getAllByRole("listitem");
    await user.click(within(first!).getByRole("button", { name: "Archive" }));
    expect(window.murmur.historyArchive).toHaveBeenCalledWith(["h2"], true);

    await user.click(within(first!).getByRole("button", { name: "Delete this dictation" }));
    expect(window.murmur.historyDelete).not.toHaveBeenCalled();
    await user.click(
      within(first!).getByRole("button", { name: "Confirm deleting this dictation" }),
    );
    expect(window.murmur.historyDelete).toHaveBeenCalledWith(["h2"]);
  });

  it("deletes selected rows after confirming", async () => {
    const user = userEvent.setup();
    render(<HistoryPage />);
    const list = await screen.findByRole("list", { name: "Dictations" });
    for (const box of within(list).getAllByRole("checkbox")) await user.click(box);
    expect(screen.getByText("2 selected")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete the selected dictations" }));
    await user.click(screen.getByRole("button", { name: "Confirm deleting 2 dictations" }));
    expect(window.murmur.historyDelete).toHaveBeenCalledWith(["h2", "h1"]);
  });

  it("keeps feedback locally", async () => {
    const user = userEvent.setup();
    render(<HistoryPage />);
    const list = await screen.findByRole("list", { name: "Dictations" });
    const [first] = within(list).getAllByRole("listitem");
    await user.click(within(first!).getByRole("button", { name: "Poor result" }));
    expect(window.murmur.historyFeedback).toHaveBeenCalledWith({
      id: "h2",
      feedback: "bad",
      note: null,
    });
  });

  it("shows the changes from what was heard", async () => {
    const user = userEvent.setup();
    render(<HistoryPage />);
    const list = await screen.findByRole("list", { name: "Dictations" });
    const [first] = within(list).getAllByRole("listitem");
    await user.click(within(first!).getByRole("button", { name: "View changes" }));
    const changes = within(first!).getByLabelText("Changes from what was heard");
    expect(changes.querySelector("del")?.textContent).toContain("um");
  });

  it("copies the final and the raw text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    // userEvent installs its own clipboard; put the spy back after it.
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<HistoryPage />);
    const list = await screen.findByRole("list", { name: "Dictations" });
    const [first] = within(list).getAllByRole("listitem");
    await user.click(within(first!).getByRole("button", { name: "Copy the final text" }));
    await user.click(within(first!).getByRole("button", { name: "Copy the text as heard" }));
    expect(writeText).toHaveBeenNthCalledWith(1, "So we go at three.");
    expect(writeText).toHaveBeenNthCalledWith(2, "um so we go at three");
  });

  it("sends Instruct threads to the Instruct page", async () => {
    const user = userEvent.setup();
    render(<HistoryPage />);
    await user.click(screen.getByRole("button", { name: "Instruct" }));
    await user.click(screen.getByRole("button", { name: "Open the Instruct page" }));
    expect(window.location.hash).toBe("#/instruct");
  });

  it("explains an empty history", async () => {
    window.murmur = createMockApi({
      historyPage: vi.fn().mockResolvedValue({ rows: [], total: 0, apps: [], languages: [] }),
    });
    render(<HistoryPage />);
    expect(await screen.findByText(/No dictations yet/)).toBeTruthy();
  });
});

describe("History feedback note", () => {
  it("saves a note for a row with feedback", async () => {
    const page = structuredClone((await createMockApi().historyPage({})) as never) as {
      rows: { feedback: string | null }[];
    };
    page.rows[0]!.feedback = "bad";
    window.murmur = createMockApi({ historyPage: vi.fn().mockResolvedValue(page) });
    const user = userEvent.setup();
    render(<HistoryPage />);
    await user.type(
      await screen.findByRole("textbox", { name: "Note about this result" }),
      "names",
    );
    await user.click(screen.getByRole("button", { name: "Save the note" }));
    expect(window.murmur.historyFeedback).toHaveBeenCalledWith({
      id: "h2",
      feedback: "bad",
      note: "names",
    });
  });
});
