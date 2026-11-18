// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportDeleteSection } from "./ExportDeleteSection";
import { createMockApi } from "./test-api";

beforeEach(() => {
  window.murmur = createMockApi();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("export and delete (HB-46, HB-47)", () => {
  it("exports every text category by default, audio only when ticked", async () => {
    const user = userEvent.setup();
    render(<ExportDeleteSection />);
    expect(screen.getByRole("checkbox", { name: "Kept recordings (audio files)" })).toHaveProperty(
      "checked",
      false,
    );
    await user.click(screen.getByRole("button", { name: "Export the chosen data" }));
    const call = vi.mocked(window.murmur.dataExport).mock.calls[0]![0];
    expect(call.categories).not.toContain("audio");
    expect(call.categories).toContain("notes");
    expect(await screen.findByText(/Exported 43 items to/)).toBeTruthy();
  });

  it("shows counts and sizes, and asks before deleting a category", async () => {
    const user = userEvent.setup();
    render(<ExportDeleteSection />);
    const list = await screen.findByRole("list", { name: "Data by category" });
    expect(list.textContent).toContain("Recordings: 2 · 2.0 MB");
    const [first] = within(list).getAllByRole("listitem");
    await user.click(within(first!).getByRole("button", { name: /^Delete Dictations/ }));
    expect(window.murmur.dataDelete).not.toHaveBeenCalled();
    expect(within(first!).getByText(/this cannot be undone/)).toBeTruthy();
    await user.click(within(first!).getByRole("button", { name: /^Confirm deleting Dictations/ }));
    expect(window.murmur.dataDelete).toHaveBeenCalledWith("dictations");
    expect(await screen.findByText(/deleted 40 items/)).toBeTruthy();
  });

  it("resets everything after a confirmation, models only when ticked", async () => {
    const user = userEvent.setup();
    render(<ExportDeleteSection />);
    await user.click(screen.getByRole("button", { name: "Delete all data and reset" }));
    expect(window.murmur.dataReset).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm deleting all data" }));
    expect(window.murmur.dataReset).toHaveBeenCalledWith({ includeModels: false });
  });

  it("offers to retry files that could not be removed", async () => {
    window.murmur = createMockApi({
      dataCounts: vi.fn().mockResolvedValue({ categories: [], failedFiles: 2 }),
    });
    const user = userEvent.setup();
    render(<ExportDeleteSection />);
    await user.click(await screen.findByRole("button", { name: "Try removing the files again" }));
    expect(window.murmur.dataRetryFailed).toHaveBeenCalled();
  });
});
