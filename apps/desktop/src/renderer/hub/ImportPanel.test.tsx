// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptImportPreview } from "@murmur/shared";
import { ImportPanel, readDate } from "./ImportPanel";
import { createMockApi } from "./test-api";

const preview = (over: Partial<TranscriptImportPreview> = {}): TranscriptImportPreview => ({
  token: "tok",
  fileName: "GMT20261121-100000_Recording.transcript.vtt",
  format: "vtt",
  formatName: "WebVTT (.vtt, also from Zoom)",
  title: "Recording transcript",
  startedAt: new Date(2026, 10, 21, 10, 0).getTime(),
  durationMs: 72_000,
  lines: 4,
  speakers: ["Dana Lee", "Sam Ortiz"],
  timesEstimated: false,
  duplicate: null,
  ...over,
});

let api: ReturnType<typeof createMockApi>;
const imported = vi.fn();
const closed = vi.fn();

beforeEach(() => {
  api = createMockApi();
  imported.mockClear();
  closed.mockClear();
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

const choose = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Choose a transcript file" }));
};
const open = () => render(<ImportPanel onImported={imported} onClose={closed} />);

describe("import a transcript (NT-21)", () => {
  it("describes the file before anything is made", async () => {
    api.meetingImportPreview = vi.fn().mockResolvedValue({ ok: true, preview: preview() });
    open();
    await choose();
    expect(
      await screen.findByText(/WebVTT \(.vtt, also from Zoom\)\. 1 meeting, 4 lines, 1:12\./),
    ).toBeTruthy();
    expect(screen.getByText("Speakers: Dana Lee, Sam Ortiz.")).toBeTruthy();
    expect(screen.getByLabelText("Title")).toHaveProperty("value", "Recording transcript");
    expect(screen.getByLabelText("Date and time")).toHaveProperty("value", "2026-11-21 10:00");
    expect(api.meetingImportConfirm).not.toHaveBeenCalled();
  });

  it("imports with the title and date as edited, then tells the page", async () => {
    api.meetingImportPreview = vi.fn().mockResolvedValue({ ok: true, preview: preview() });
    api.meetingImportConfirm = vi.fn().mockResolvedValue({ ok: true, meetingId: "m-9" });
    open();
    await choose();
    fireEvent.change(await screen.findByLabelText("Title"), {
      target: { value: "Roadmap review" },
    });
    fireEvent.change(screen.getByLabelText("Date and time"), {
      target: { value: "2026-11-20 15:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import this transcript" }));
    await waitFor(() =>
      expect(api.meetingImportConfirm).toHaveBeenCalledWith({
        token: "tok",
        title: "Roadmap review",
        startedAt: new Date(2026, 10, 20, 15, 30).getTime(),
      }),
    );
    await waitFor(() => expect(imported).toHaveBeenCalledWith("m-9"));
  });

  it("checks the date and title before sending", async () => {
    api.meetingImportPreview = vi.fn().mockResolvedValue({ ok: true, preview: preview() });
    open();
    await choose();
    fireEvent.change(await screen.findByLabelText("Date and time"), { target: { value: "soon" } });
    fireEvent.click(screen.getByRole("button", { name: "Import this transcript" }));
    expect(await screen.findByText("Write the date as YYYY-MM-DD HH:MM.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Date and time"), {
      target: { value: "2026-11-21 10:00" },
    });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Import this transcript" }));
    expect(await screen.findByText("Give the meeting a title.")).toBeTruthy();
    expect(api.meetingImportConfirm).not.toHaveBeenCalled();
  });

  it("reports a file that was imported before, and will not import it again", async () => {
    api.meetingImportPreview = vi.fn().mockResolvedValue({
      ok: true,
      preview: preview({
        duplicate: { meetingId: "m-1", title: "Roadmap review", reason: "same-file" },
      }),
    });
    open();
    await choose();
    expect(
      await screen.findByText("This file is already imported as “Roadmap review”."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import this transcript" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.queryByRole("button", { name: "Import it anyway" })).toBeNull();
  });

  it("warns about a meeting with the same title at the same time, and lets the owner import anyway", async () => {
    api.meetingImportPreview = vi.fn().mockResolvedValue({
      ok: true,
      preview: preview({
        duplicate: { meetingId: "m-1", title: "Design sync", reason: "same-title" },
      }),
    });
    api.meetingImportConfirm = vi.fn().mockResolvedValue({ ok: true, meetingId: "m-2" });
    open();
    await choose();
    expect(
      await screen.findByText(/A meeting called “Design sync” started at about the same time/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import this transcript" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Import it anyway" }));
    expect(screen.getByRole("button", { name: "Import this transcript" })).toHaveProperty(
      "disabled",
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "Import this transcript" }));
    await waitFor(() => expect(imported).toHaveBeenCalledWith("m-2"));
  });

  it("shows why a file cannot be read, and the formats, creating nothing", async () => {
    api.meetingImportPreview = vi.fn().mockResolvedValue({
      ok: false,
      message:
        "That file is not a transcript Murmur can read. Supported files: WebVTT (.vtt, also from Zoom); SubRip (.srt).",
    });
    open();
    await choose();
    expect(await screen.findByText(/not a transcript Murmur can read/)).toBeTruthy();
    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(api.meetingImportConfirm).not.toHaveBeenCalled();
  });

  it("says nothing when the file chooser is cancelled", async () => {
    open();
    await choose();
    await waitFor(() => expect(api.meetingImportPreview).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByLabelText("Title")).toBeNull();
  });

  it("says when the times are estimated, and shows an import that failed", async () => {
    api.meetingImportPreview = vi.fn().mockResolvedValue({
      ok: true,
      preview: preview({ timesEstimated: true, speakers: [] }),
    });
    api.meetingImportConfirm = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "The file could not be imported: boom" });
    open();
    await choose();
    expect(await screen.findByText(/no times. They are estimated/)).toBeTruthy();
    expect(screen.getByText("Speakers: none named in the file.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import this transcript" }));
    expect(await screen.findByText("The file could not be imported: boom")).toBeTruthy();
    expect(imported).not.toHaveBeenCalled();
  });

  it("lets go of a preview when the panel is closed or another file is chosen", async () => {
    api.meetingImportPreview = vi.fn().mockResolvedValue({ ok: true, preview: preview() });
    open();
    await choose();
    await screen.findByLabelText("Title");
    await choose();
    await waitFor(() => expect(api.meetingImportCancel).toHaveBeenCalledWith("tok"));
    fireEvent.click(screen.getByRole("button", { name: "Close the import panel" }));
    expect(closed).toHaveBeenCalled();
    expect(api.meetingImportCancel).toHaveBeenCalledTimes(2);
  });
});

describe("readDate", () => {
  it("reads a local date and time, and refuses what is not one", () => {
    expect(readDate("2026-11-21 10:30")).toBe(new Date(2026, 10, 21, 10, 30).getTime());
    expect(readDate("2026-11-21")).toBe(new Date(2026, 10, 21).getTime());
    expect(readDate("2026-02-31")).toBeNull();
    expect(readDate("21/11/2026")).toBeNull();
    expect(readDate("")).toBeNull();
  });
});
