// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportPanel } from "./ExportPanel";
import { createMockApi } from "./test-api";

let api: ReturnType<typeof createMockApi>;
beforeEach(() => {
  api = createMockApi();
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

describe("export (NT-18)", () => {
  it("says the audio is not included and that links need the team server", () => {
    render(<ExportPanel meetingId="m-1" onClose={() => undefined} />);
    expect(screen.getByText(/The audio is not included/)).toBeTruthy();
    expect(screen.getByText(/needs the team server/)).toBeTruthy();
  });

  it("exports the summary, transcript and tasks by default, not the notes", async () => {
    api.meetingExport = vi
      .fn()
      .mockResolvedValue({ ok: true, path: "/Users/me/Documents/2026-11-21 Sync.html" });
    render(<ExportPanel meetingId="m-1" onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose where to save the file" }));
    await waitFor(() =>
      expect(api.meetingExport).toHaveBeenCalledWith("m-1", {
        summary: true,
        transcript: true,
        tasks: true,
        notes: false,
      }),
    );
    expect(
      await screen.findByText("Saved to /Users/me/Documents/2026-11-21 Sync.html"),
    ).toBeTruthy();
  });

  it("leaves out what is switched off, and will not export nothing", async () => {
    render(<ExportPanel meetingId="m-1" onClose={() => undefined} />);
    for (const label of ["Summary", "Transcript", "Tasks"])
      fireEvent.click(screen.getByRole("switch", { name: label }));
    expect(screen.getByRole("button", { name: "Choose where to save the file" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(screen.getByRole("switch", { name: "My notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose where to save the file" }));
    await waitFor(() =>
      expect(api.meetingExport).toHaveBeenCalledWith("m-1", {
        summary: false,
        transcript: false,
        tasks: false,
        notes: true,
      }),
    );
  });

  it("says nothing when the save dialog is cancelled, and why a save failed", async () => {
    render(<ExportPanel meetingId="m-1" onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose where to save the file" }));
    await waitFor(() => expect(api.meetingExport).toHaveBeenCalled());
    expect(screen.queryByText(/Saved to/)).toBeNull();
    api.meetingExport = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "The file could not be saved there." });
    fireEvent.click(screen.getByRole("button", { name: "Choose where to save the file" }));
    expect(await screen.findByText("The file could not be saved there.")).toBeTruthy();
  });
});
