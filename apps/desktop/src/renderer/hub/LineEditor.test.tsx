// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingDetail, MeetingSegment, SegmentHistoryItem } from "@murmur/shared";
import { LineEditor } from "./LineEditor";
import { createMockApi } from "./test-api";

const segment: MeetingSegment = {
  id: "s1",
  meetingId: "m-1",
  channel: "system",
  startMs: 5_000,
  endMs: 9_000,
  text: "We ship on Thursday if the load test passes.",
  language: "en",
  speakerId: "m-1:system",
  isDictated: false,
  isFinal: true,
  edited: false,
};

const detail = {
  meeting: { id: "m-1", title: "Sync" },
  segments: [segment],
  speakers: [
    { id: "m-1:mic", channel: "mic", name: "You", defaultName: "You", segments: 1, talkMs: 1 },
    {
      id: "m-1:system",
      channel: "system",
      name: "Remote",
      defaultName: "Remote",
      segments: 1,
      talkMs: 1,
    },
  ],
} as unknown as MeetingDetail;

const item = (over: Partial<SegmentHistoryItem> = {}): SegmentHistoryItem => ({
  id: 7,
  kind: "text",
  createdAt: Date.UTC(2026, 10, 21, 10, 0),
  original: "We ship on Tuesday if the load test passes.",
  canRevert: true,
  ...over,
});

let api: ReturnType<typeof createMockApi>;
const close = vi.fn();

beforeEach(() => {
  api = createMockApi();
  close.mockClear();
  api.meetingCorrect = vi
    .fn()
    .mockResolvedValue({ ok: true, segmentId: "s1", changed: true, learned: null });
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

const open = (over: Partial<MeetingSegment> = {}) =>
  render(<LineEditor detail={detail} segment={{ ...segment, ...over }} onClose={close} />);

describe("line editor (NT-24)", () => {
  it("saves new words and closes", async () => {
    open();
    expect(screen.getByRole("button", { name: "Save this line" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Line"), {
      target: { value: "We ship on Friday if the load test passes." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save this line" }));
    await waitFor(() =>
      expect(api.meetingCorrect).toHaveBeenCalledWith("m-1", {
        kind: "text",
        segmentId: "s1",
        text: "We ship on Friday if the load test passes.",
      }),
    );
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it("splits at the cursor, but not while the words are unsaved", async () => {
    open();
    const box = screen.getByLabelText("Line") as HTMLTextAreaElement;
    box.focus();
    box.setSelectionRange(10, 10);
    fireEvent.click(screen.getByRole("button", { name: "Cut this line in two at the cursor" }));
    await waitFor(() =>
      expect(api.meetingCorrect).toHaveBeenCalledWith("m-1", {
        kind: "split",
        segmentId: "s1",
        offset: 10,
      }),
    );
    cleanup();
    open();
    fireEvent.change(screen.getByLabelText("Line"), { target: { value: "changed" } });
    expect(
      screen.getByRole("button", { name: "Cut this line in two at the cursor" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByText("Save the new words before splitting.")).toBeTruthy();
  });

  it("joins with the next line", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Join this line with the next one" }));
    await waitFor(() =>
      expect(api.meetingCorrect).toHaveBeenCalledWith("m-1", { kind: "merge", segmentId: "s1" }),
    );
  });

  it("shows why a correction was refused and stays open", async () => {
    api.meetingCorrect = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "There is no next line to join." });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Join this line with the next one" }));
    expect(await screen.findByText("There is no next line to join.")).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });

  it("gives the line to another speaker from the list", async () => {
    open();
    fireEvent.click(screen.getByRole("combobox", { name: "Speaker" }));
    fireEvent.click(await screen.findByRole("option", { name: "You" }));
    await waitFor(() =>
      expect(api.meetingCorrect).toHaveBeenCalledWith("m-1", {
        kind: "speaker",
        segmentId: "s1",
        speakerId: "m-1:mic",
      }),
    );
  });

  it("gives the line to a new speaker by name", async () => {
    open();
    fireEvent.click(screen.getByRole("combobox", { name: "Speaker" }));
    fireEvent.click(await screen.findByRole("option", { name: "New speaker…" }));
    const add = screen.getByRole("button", { name: "Give this line to the new speaker" });
    expect(add).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Name of the new speaker"), {
      target: { value: "Priya (in room)" },
    });
    fireEvent.click(add);
    await waitFor(() =>
      expect(api.meetingCorrect).toHaveBeenCalledWith("m-1", {
        kind: "speaker",
        segmentId: "s1",
        newName: "Priya (in room)",
      }),
    );
  });

  it("tells the owner what was offered to the Dictionary, and stays open to say it", async () => {
    api.meetingCorrect = vi.fn().mockResolvedValue({
      ok: true,
      segmentId: "s1",
      changed: true,
      learned: { spoken: "kube cuddle", written: "kubectl" },
    });
    open();
    fireEvent.change(screen.getByLabelText("Line"), { target: { value: "Use kubectl here." } });
    fireEvent.click(screen.getByRole("button", { name: "Save this line" }));
    expect(
      await screen.findByText(/“kube cuddle” → “kubectl” was added to your Dictionary/),
    ).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });

  it("lists the history, newest first, and takes back only what can be taken back", async () => {
    api.meetingSegmentHistory = vi
      .fn()
      .mockResolvedValue([
        item({ id: 9, kind: "speaker", original: "Remote" }),
        item({ id: 7, canRevert: false }),
      ]);
    api.meetingCorrectionRevert = vi.fn().mockResolvedValue({ ok: true });
    open({ edited: true });
    const history = within(await screen.findByRole("list", { name: "History of this line" }));
    const buttons = history.getAllByRole("button", { name: /Take back/ });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveProperty("disabled", false);
    expect(buttons[1]).toHaveProperty("disabled", true);
    expect(history.getByText(/Changed the speaker.*Before: Remote/)).toBeTruthy();
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(api.meetingCorrectionRevert).toHaveBeenCalledWith("m-1", 9));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it("says when a correction cannot be taken back", async () => {
    api.meetingSegmentHistory = vi.fn().mockResolvedValue([item()]);
    api.meetingCorrectionRevert = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "Take back the later change to this line first." });
    open({ edited: true });
    fireEvent.click(await screen.findByRole("button", { name: /Take back/ }));
    expect(await screen.findByText("Take back the later change to this line first.")).toBeTruthy();
  });

  it("shows no history for a line nobody has corrected", async () => {
    open();
    await waitFor(() => expect(api.meetingSegmentHistory).toHaveBeenCalledWith("m-1", "s1"));
    expect(screen.queryByRole("list", { name: "History of this line" })).toBeNull();
  });
});
