// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScratchpadApp } from "./ScratchpadApp";
import { createMockApi } from "./test-api";

beforeEach(() => {
  window.murmur = createMockApi();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openFirst() {
  const user = userEvent.setup();
  render(<ScratchpadApp />);
  const list = await screen.findByRole("list", { name: "All notes" });
  await user.click(within(list).getAllByRole("button")[0]!);
  await screen.findByTestId("note-editor");
  return user;
}

describe("Scratchpad window", () => {
  it("lists notes and opens one in a tab", async () => {
    await openFirst();
    expect(window.murmur.noteGet).toHaveBeenCalledWith("n2");
    expect(screen.getByRole("tab", { name: "Groceries" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByTestId("note-editor").textContent).toBe("milk, eggs");
  });

  it("searches after a short pause", async () => {
    const user = userEvent.setup();
    render(<ScratchpadApp />);
    await screen.findByRole("list", { name: "All notes" });
    await user.type(screen.getByRole("textbox", { name: "Search notes" }), "milk");
    await waitFor(() => expect(window.murmur.notesList).toHaveBeenLastCalledWith("milk"));
  });

  it("highlights matching words", async () => {
    window.murmur = createMockApi({
      notesList: vi.fn().mockResolvedValue([
        {
          id: "n9",
          title: "Trip",
          preview: [
            { text: "the ", hit: false },
            { text: "zebra", hit: true },
          ],
          updatedAt: 1,
          pinned: false,
        },
      ]),
    });
    render(<ScratchpadApp />);
    const list = await screen.findByRole("list", { name: "All notes" });
    expect(list.querySelector("mark")?.textContent).toBe("zebra");
  });

  it("saves two seconds after typing stops", async () => {
    await openFirst();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const editor = screen.getByTestId("note-editor");
    editor.innerHTML = "<p>milk, eggs, bread</p>";
    fireEvent.input(editor);
    expect(window.murmur.noteSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("save-state").textContent).toBe("Not saved yet");
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    await waitFor(() =>
      expect(window.murmur.noteSave).toHaveBeenCalledWith(
        expect.objectContaining({ id: "n2", title: "Groceries" }),
      ),
    );
    await waitFor(() => expect(screen.getByTestId("save-state").textContent).toBe("Saved"));
  });

  it("saves what is left when the window closes", async () => {
    await openFirst();
    const editor = screen.getByTestId("note-editor");
    editor.innerHTML = "<p>last words</p>";
    fireEvent.input(editor);
    window.dispatchEvent(new Event("pagehide"));
    await waitFor(() => expect(window.murmur.noteSave).toHaveBeenCalled());
  });

  it("makes a new note from the last dictation", async () => {
    const user = userEvent.setup();
    render(<ScratchpadApp />);
    await screen.findByRole("list", { name: "All notes" });
    await user.click(screen.getByRole("button", { name: "New note from the last dictation" }));
    expect(window.murmur.noteCreate).toHaveBeenCalledWith({ fromLastDictation: true });
    await waitFor(() => expect(window.murmur.noteGet).toHaveBeenCalledWith("n3"));
  });

  it("explains when there is no dictation to start from", async () => {
    window.murmur = createMockApi({
      noteCreate: vi.fn().mockResolvedValue({ ok: false, message: "No dictation yet." }),
    });
    const user = userEvent.setup();
    render(<ScratchpadApp />);
    await user.click(
      await screen.findByRole("button", { name: "New note from the last dictation" }),
    );
    expect(await screen.findByText("No dictation yet.")).toBeTruthy();
  });

  it("asks before deleting a note", async () => {
    const user = await openFirst();
    await user.click(screen.getByRole("button", { name: "Delete this note" }));
    expect(window.murmur.noteDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm deleting this note" }));
    expect(window.murmur.noteDelete).toHaveBeenCalledWith("n2");
  });

  it("keeps at most eight tabs", async () => {
    let n = 0;
    window.murmur = createMockApi({
      notesList: vi.fn().mockResolvedValue(
        Array.from({ length: 10 }, (_, index) => ({
          id: `t${index}`,
          title: `Note ${index}`,
          preview: [],
          updatedAt: index,
          pinned: false,
        })),
      ),
      noteGet: vi.fn((id: string) =>
        Promise.resolve({
          id,
          title: `Note ${id.slice(1)}`,
          body: { blocks: [] },
          plain: "",
          createdAt: ++n,
          updatedAt: n,
          pinned: false,
        }),
      ),
    });
    const user = userEvent.setup();
    render(<ScratchpadApp />);
    const list = await screen.findByRole("list", { name: "All notes" });
    for (const button of within(list).getAllByRole("button")) await user.click(button);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(8));
  });

  it("saves a version with a label, compares and restores one", async () => {
    const user = await openFirst();
    await user.click(screen.getByRole("button", { name: "Show versions" }));
    const list = await screen.findByRole("list", { name: "Saved versions" });
    expect(list.textContent).toContain("Before trip");

    await user.type(screen.getByRole("textbox", { name: "Version label (optional)" }), "Plan");
    await user.click(screen.getByRole("button", { name: "Save a version now" }));
    expect(window.murmur.noteVersionSave).toHaveBeenCalledWith({
      noteId: "n2",
      label: "Plan",
      reason: "manual",
    });

    const [first] = within(list).getAllByRole("listitem");
    await user.click(within(first!).getByRole("button", { name: /^Compare/ }));
    const changes = await screen.findByLabelText("Changes since this version");
    expect(changes.querySelector("ins")?.textContent).toContain("eggs");

    await user.click(within(first!).getByRole("button", { name: /^Restore/ }));
    expect(window.murmur.noteVersionRestore).toHaveBeenCalledWith("v2");
    await waitFor(() => expect(screen.getByTestId("note-editor").textContent).toBe("milk, bread"));
  });

  it("keeps a version when a note is closed", async () => {
    const user = await openFirst();
    await user.click(screen.getByRole("button", { name: "Close Groceries" }));
    await waitFor(() =>
      expect(window.murmur.noteVersionSave).toHaveBeenCalledWith({
        noteId: "n2",
        label: null,
        reason: "close",
      }),
    );
  });

  it("pins a note, and shows why a pin is refused", async () => {
    const user = await openFirst();
    await user.click(screen.getByRole("button", { name: "Pin this note" }));
    expect(window.murmur.notePin).toHaveBeenCalledWith("n2", true);
    expect(await screen.findByRole("button", { name: "Unpin this note" })).toBeTruthy();

    window.murmur.notePin = vi.fn().mockResolvedValue({ ok: false, message: "At most 20." });
    await user.click(screen.getByRole("button", { name: "Unpin this note" }));
    expect(await screen.findByText("At most 20.")).toBeTruthy();
  });

  it("moves a pinned note", async () => {
    window.murmur = createMockApi({
      notesList: vi.fn().mockResolvedValue([
        { id: "p1", title: "One", preview: [], updatedAt: 1, pinned: true },
        { id: "p2", title: "Two", preview: [], updatedAt: 2, pinned: true },
      ]),
    });
    const user = userEvent.setup();
    render(<ScratchpadApp />);
    await user.click(await screen.findByRole("button", { name: "Move Two up" }));
    expect(window.murmur.notePinMove).toHaveBeenCalledWith("p2", -1);
  });
});
