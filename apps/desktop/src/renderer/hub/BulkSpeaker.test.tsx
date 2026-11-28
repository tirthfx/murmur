// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeetingDetail } from "@murmur/shared";
import { BulkSpeaker } from "./BulkSpeaker";
import { createMockApi } from "./test-api";

afterEach(cleanup);

const detail = {
  meeting: { id: "m1" },
  speakers: [{ id: "m1:system", name: "Remote" }],
} as MeetingDetail;

describe("changing the speaker of several lines (NT-24)", () => {
  it("corrects each selected line and stops selecting", async () => {
    const meetingCorrect = vi.fn().mockResolvedValue({ ok: true });
    window.murmur = createMockApi({ meetingCorrect });
    const onSelect = vi.fn();
    render(<BulkSpeaker detail={detail} selected={new Set(["a", "b"])} onSelect={onSelect} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Give the selected lines to this speaker" }),
    );
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null));
    expect(meetingCorrect.mock.calls).toEqual([
      ["m1", { kind: "speaker", segmentId: "a", speakerId: "m1:system" }],
      ["m1", { kind: "speaker", segmentId: "b", speakerId: "m1:system" }],
    ]);
  });

  it("stops at the first refusal and says why", async () => {
    const meetingCorrect = vi.fn().mockResolvedValue({ ok: false, message: "That line is gone." });
    window.murmur = createMockApi({ meetingCorrect });
    const onSelect = vi.fn();
    render(<BulkSpeaker detail={detail} selected={new Set(["a", "b"])} onSelect={onSelect} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Give the selected lines to this speaker" }),
    );
    expect(await screen.findByText("That line is gone.")).toBeTruthy();
    expect(meetingCorrect).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("offers to start selecting", () => {
    const onSelect = vi.fn();
    render(<BulkSpeaker detail={detail} selected={null} onSelect={onSelect} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Select several lines to change their speaker" }),
    );
    expect(onSelect).toHaveBeenCalledWith(new Set());
  });
});
