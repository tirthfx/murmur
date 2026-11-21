// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LivePartial, MeetingDetail, MeetingListItem } from "@murmur/shared";
import { NotetakerPage, statusText } from "./NotetakerPage";
import { createMockApi } from "./test-api";

const meeting: MeetingListItem = {
  id: "m-1",
  title: "Design sync",
  startedAt: Date.UTC(2026, 10, 21, 10, 0),
  endedAt: Date.UTC(2026, 10, 21, 10, 30),
  source: "ad_hoc",
  status: "ready",
  channels: ["mic", "system"],
  warnings: ["system_permission"],
  durationMs: 30 * 60_000,
  audioDeletedAt: null,
  progress: { chunks: 4, done: 4 },
};

function detail(overrides: Partial<MeetingDetail> = {}): MeetingDetail {
  return {
    meeting,
    progress: meeting.progress,
    segments: [
      {
        id: "s1",
        meetingId: "m-1",
        channel: "mic",
        startMs: 2_000,
        endMs: 4_000,
        text: "Shall we start?",
        language: "en",
        speakerId: null,
        isDictated: false,
        isFinal: true,
      },
      {
        id: "s2",
        meetingId: "m-1",
        channel: "system",
        startMs: 65_000,
        endMs: 68_000,
        text: "Yes, the roadmap first.",
        language: "en",
        speakerId: null,
        isDictated: false,
        isFinal: true,
      },
      {
        id: "s3",
        meetingId: "m-1",
        channel: "mic",
        startMs: 70_000,
        endMs: 71_000,
        text: "Dictated into another app.",
        language: "en",
        speakerId: null,
        isDictated: true,
        isFinal: true,
      },
    ],
    live: [],
    notes: "Agenda",
    notesUpdatedAt: 1,
    docs: [],
    ...overrides,
  };
}

let live: (partial: LivePartial) => void = () => {};
let changed: (id: string | null) => void = () => {};

beforeEach(() => {
  window.localStorage.clear();
  window.murmur = createMockApi({
    meetingsList: vi.fn().mockResolvedValue([meeting]),
    meetingDetail: vi.fn().mockResolvedValue(detail()),
    onMeetingLive: vi.fn((handler) => {
      live = handler;
      return () => {};
    }),
    onMeetingsChanged: vi.fn((handler) => {
      changed = handler;
      return () => {};
    }),
  });
});

afterEach(cleanup);

async function openMeeting() {
  render(<NotetakerPage />);
  const item = await screen.findByRole("button", { name: /Design sync/ });
  await act(async () => item.click());
  await waitFor(() => expect(screen.getByRole("region", { name: "Meeting" })).toBeTruthy());
}

describe("Notetaker page", () => {
  it("says what each status means", () => {
    expect(statusText({ ...meeting, status: "queued" })).toBe("Waiting for the speech model");
    expect(statusText({ ...meeting, status: "processing", progress: { chunks: 8, done: 3 } })).toBe(
      "Transcribing: 3 of 8 parts",
    );
  });

  it("opens a meeting with six tabs and the transcript, without dictated lines", async () => {
    await openMeeting();
    expect(screen.getAllByRole("tab")).toHaveLength(6);
    for (const name of ["My notes", "Summary", "Transcript", "Tasks", "Brief", "Docs"]) {
      expect(screen.getByRole("tab", { name })).toBeTruthy();
    }
    const transcript = screen.getByLabelText("Transcript", { selector: "div.hub-transcript" });
    const lines = [...transcript.querySelectorAll("p")].map((line) => line.textContent);
    expect(lines).toEqual(["0:02YouShall we start?", "1:05RemoteYes, the roadmap first."]);
  });

  it("shows grey live text and drops it when the chunk is final", async () => {
    window.murmur.meetingDetail = vi
      .fn()
      .mockResolvedValue(detail({ meeting: { ...meeting, status: "recording" } }));
    await openMeeting();
    await act(async () => screen.getByRole("tab", { name: "Transcript" }).click());
    act(() =>
      live({
        meetingId: "m-1",
        channel: "system",
        seq: 3,
        segments: [{ startMs: 90_000, endMs: 92_000, text: "Next item" }],
      }),
    );
    const partial = document.querySelector(".hub-transcript-partial");
    expect(partial?.textContent).toBe("1:30RemoteNext item");
    act(() => live({ meetingId: "m-1", channel: "system", seq: 4, segments: [] }));
    expect(document.querySelector(".hub-transcript-partial")).toBeNull();
  });

  it("explains a missing Screen Recording grant and opens its settings", async () => {
    await openMeeting();
    expect(screen.getByText(/Only your microphone was recorded/)).toBeTruthy();
    await act(async () =>
      screen.getByRole("button", { name: "Open Screen Recording settings" }).click(),
    );
    expect(window.murmur.openPermissionSettings).toHaveBeenCalledWith("screenRecording");
  });

  it("saves notes when the box is left, and renames the meeting", async () => {
    await openMeeting();
    await act(async () => screen.getByRole("tab", { name: "My notes" }).click());
    const box = screen.getByLabelText("My notes", { selector: "textarea" });
    fireEvent.change(box, { target: { value: "Agenda\n- roadmap" } });
    await act(async () => fireEvent.blur(box));
    expect(window.murmur.meetingNotesSave).toHaveBeenCalledWith("m-1", "Agenda\n- roadmap");
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Roadmap sync" } });
    await act(async () => fireEvent.blur(title));
    expect(window.murmur.meetingRename).toHaveBeenCalledWith("m-1", "Roadmap sync");
  });

  it("adds a link on the Docs tab", async () => {
    window.murmur.meetingDocAddLink = vi.fn().mockResolvedValue({
      ok: true,
      doc: {
        id: "d",
        meetingId: "m-1",
        kind: "link",
        title: "x",
        url: "https://x",
        bytes: null,
        addedAt: 1,
      },
    });
    await openMeeting();
    await act(async () => screen.getByRole("tab", { name: "Docs" }).click());
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "https://example.com" } });
    await act(async () => screen.getByRole("button", { name: "Add the link" }).click());
    expect(window.murmur.meetingDocAddLink).toHaveBeenCalledWith("m-1", "https://example.com", "");
  });

  it("starts a recording and opens it, then stops it", async () => {
    render(<NotetakerPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Record a meeting" })).toBeTruthy(),
    );
    window.murmur.meetingRecording = vi.fn().mockResolvedValue({
      status: "recording",
      meetingId: "m-1",
      title: "Design sync",
      startedAt: Date.now() - 5_000,
      channels: ["mic"],
      warnings: [],
    });
    await act(async () => screen.getByRole("button", { name: "Record a meeting" }).click());
    expect(window.murmur.meetingStart).toHaveBeenCalled();
    const recording = screen.getByRole("region", { name: "Recording" });
    expect(within(recording).getByText(/Recording “Design sync”/)).toBeTruthy();
    await act(async () => screen.getByRole("button", { name: "Stop recording" }).click());
    expect(window.murmur.meetingStop).toHaveBeenCalled();
    // Main reports changes; the list is read again.
    await act(async () => changed(null));
    expect(window.murmur.meetingsList).toHaveBeenCalledTimes(4);
  });
});
