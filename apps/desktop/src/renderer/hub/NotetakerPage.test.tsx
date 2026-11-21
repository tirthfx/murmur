// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LivePartial,
  MeetingDetail,
  MeetingListItem,
  AskThread,
  MeetingSummary,
  Task,
} from "@murmur/shared";
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
    summaries: [],
    summaryStatus: { state: "idle" },
    taskStatus: { state: "idle" },
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
    // Four tabs for the page (Meetings, Ask, My Tasks, Skills) and six for the meeting.
    expect(screen.getAllByRole("tab")).toHaveLength(10);
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

  describe("Summary tab (NT-09)", () => {
    const summary = (version: number, extra: Partial<MeetingSummary> = {}): MeetingSummary => ({
      id: `sum-${version}`,
      meetingId: "m-1",
      version,
      skillId: "meeting-summary",
      skillName: "Meeting summary",
      modelId: "model-1",
      quick: false,
      markdown:
        "## Overview\n- Start with the roadmap [1:05](seg:s2)\n- Nobody owns it (No source)\n\n## Decisions\nNot discussed",
      createdAt: Date.UTC(2026, 10, 21, 11, 0),
      feedback: null,
      ...extra,
    });

    async function openSummary(detailOverrides: Partial<MeetingDetail>) {
      window.murmur.meetingDetail = vi.fn().mockResolvedValue(detail(detailOverrides));
      await openMeeting();
      await act(async () => screen.getByRole("tab", { name: "Summary" }).click());
    }

    it("shows the newest summary with cited times, and a citation opens the transcript line", async () => {
      await openSummary({ summaries: [summary(1), summary(2, { skillName: "Decision record" })] });
      expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy();
      expect(screen.getByText(/Nobody owns it \(No source\)/)).toBeTruthy();
      expect(screen.getByText("Not discussed")).toBeTruthy();
      expect(screen.getAllByText(/Version 2: Decision record/).length).toBeGreaterThan(0);
      await act(async () =>
        screen.getByRole("button", { name: "Open the transcript at 1:05" }).click(),
      );
      expect(screen.getByRole("tab", { name: "Transcript", selected: true })).toBeTruthy();
      const line = document.querySelector('[data-segment-id="s2"]');
      expect(line?.getAttribute("data-highlight")).toBe("true");
    });

    it("writes a new version with the chosen Skill", async () => {
      await openSummary({ summaries: [summary(1)] });
      await act(async () => screen.getByRole("button", { name: "Write a new version" }).click());
      expect(window.murmur.meetingSummarize).toHaveBeenCalledWith("m-1", {});
    });

    it("says why a summary could not be written", async () => {
      window.murmur.meetingSummarize = vi
        .fn()
        .mockResolvedValue({ ok: false, message: "The language model is not downloaded." });
      await openSummary({});
      await act(async () => screen.getByRole("button", { name: "Write a summary" }).click());
      expect(screen.getByText("The language model is not downloaded.")).toBeTruthy();
    });

    it("labels a quick summary, and offers one only while recording", async () => {
      await openSummary({
        meeting: { ...meeting, status: "recording" },
        summaries: [summary(1, { quick: true })],
      });
      expect(screen.getByText("Quick")).toBeTruthy();
      await act(async () => screen.getByRole("button", { name: "Quick summary so far" }).click());
      expect(window.murmur.meetingSummarize).toHaveBeenCalledWith("m-1", { quick: true });
      cleanup();
      await openSummary({ summaries: [summary(1)] });
      expect(screen.queryByRole("button", { name: "Quick summary so far" })).toBeNull();
    });

    it("stores thumbs with a reason, and shows the state of a summary being written", async () => {
      await openSummary({
        summaries: [summary(1)],
        summaryStatus: { state: "running", done: 1, total: 4 },
      });
      expect(
        within(screen.getByRole("tabpanel", { name: "Summary" }))
          .getAllByRole("status")
          .map((node) => node.textContent)
          .join(" "),
      ).toContain("step 2 of 4");
      await act(async () => screen.getByRole("button", { name: "Poor summary" }).click());
      expect(window.murmur.meetingSummaryFeedback).toHaveBeenCalledWith("sum-1", {
        rating: "down",
        reason: null,
      });
      await act(async () => screen.getByRole("button", { name: "Too long" }).click());
      expect(window.murmur.meetingSummaryFeedback).toHaveBeenLastCalledWith("sum-1", {
        rating: "down",
        reason: "too_long",
      });
    });
  });

  describe("tasks (NT-26)", () => {
    const suggested: Task = {
      id: "t1",
      title: "Review the roadmap",
      notes: "",
      owner: null,
      ownerIsMe: true,
      dueOn: null,
      status: "suggested",
      source: "meeting",
      meetingId: "m-1",
      meetingTitle: "Design sync",
      sourceSegmentId: "s2",
      sourceState: "ok",
      position: 1,
      createdAt: 1,
      updatedAt: 1,
      completedAt: null,
    };

    it("lists a meeting's tasks on its Tasks tab", async () => {
      window.murmur.tasksList = vi.fn().mockResolvedValue({ tasks: [suggested], undo: null });
      await openMeeting();
      await act(async () => screen.getByRole("tab", { name: "Tasks" }).click());
      expect(await screen.findByText("Review the roadmap")).toBeTruthy();
      expect(window.murmur.tasksList).toHaveBeenCalledWith(
        expect.objectContaining({ meetingId: "m-1" }),
      );
      // The source opens the transcript at that line.
      await act(async () =>
        screen
          .getByRole("button", { name: /Open the transcript where “Review the roadmap”/ })
          .click(),
      );
      expect(screen.getByRole("tab", { name: "Transcript", selected: true })).toBeTruthy();
      expect(document.querySelector('[data-segment-id="s2"]')?.getAttribute("data-highlight")).toBe(
        "true",
      );
    });

    it("opens a task's meeting at the source line from My Tasks", async () => {
      window.murmur.tasksList = vi.fn().mockResolvedValue({ tasks: [suggested], undo: null });
      render(<NotetakerPage />);
      await act(async () => screen.getByRole("tab", { name: "My Tasks" }).click());
      expect(await screen.findByText("From Design sync")).toBeTruthy();
      await act(async () =>
        screen
          .getByRole("button", { name: /Open the transcript where “Review the roadmap”/ })
          .click(),
      );
      await waitFor(() => expect(screen.getByRole("region", { name: "Meeting" })).toBeTruthy());
      expect(screen.getByRole("tab", { name: "Meetings", selected: true })).toBeTruthy();
      await waitFor(() =>
        expect(
          document.querySelector('[data-segment-id="s2"]')?.getAttribute("data-highlight"),
        ).toBe("true"),
      );
    });
  });

  describe("ask (NT-14)", () => {
    const thread: AskThread = {
      id: "th1",
      title: "Roadmap?",
      scope: { kind: "all" },
      createdAt: 1,
      updatedAt: 2,
      messages: [
        {
          id: "a1",
          role: "assistant",
          text: "The roadmap comes first [1].",
          citations: [
            {
              n: 1,
              meetingId: "m-1",
              meetingTitle: "Design sync",
              gone: false,
              source: "transcript",
              ref: "s2",
              startMs: 65_000,
              excerpt: "Yes, the roadmap first.",
            },
          ],
          supported: true,
          closest: [],
          createdAt: 2,
        },
      ],
    };

    it("opens the meeting at the cited line from an answer", async () => {
      window.murmur.askSend = vi.fn().mockResolvedValue({ ok: true, thread });
      render(<NotetakerPage />);
      await act(async () => screen.getByRole("tab", { name: "Ask" }).click());
      fireEvent.change(await screen.findByLabelText("Your question"), {
        target: { value: "What comes first?" },
      });
      await act(async () => screen.getByRole("button", { name: "Ask" }).click());
      await act(async () =>
        (await screen.findByRole("button", { name: "Open Design sync · 1:05" })).click(),
      );
      await waitFor(() => expect(screen.getByRole("region", { name: "Meeting" })).toBeTruthy());
      expect(screen.getByRole("tab", { name: "Transcript", selected: true })).toBeTruthy();
      await waitFor(() =>
        expect(
          document.querySelector('[data-segment-id="s2"]')?.getAttribute("data-highlight"),
        ).toBe("true"),
      );
    });

    it("asks about one meeting from its page", async () => {
      window.murmur.askSend = vi.fn().mockResolvedValue({ ok: true, thread });
      await openMeeting();
      await act(async () => screen.getByRole("button", { name: "Ask about this meeting" }).click());
      expect(screen.getByRole("tab", { name: "Ask", selected: true })).toBeTruthy();
      fireEvent.change(await screen.findByLabelText("Your question"), {
        target: { value: "What comes first?" },
      });
      await act(async () => screen.getByRole("button", { name: "Ask" }).click());
      expect(window.murmur.askSend).toHaveBeenCalledWith({
        threadId: null,
        question: "What comes first?",
        scope: { kind: "meetings", ids: ["m-1"] },
      });
    });
  });
});
