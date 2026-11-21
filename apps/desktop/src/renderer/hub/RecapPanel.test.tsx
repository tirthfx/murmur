// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingDetail, MeetingRecap } from "@murmur/shared";
import { RecapPanel } from "./RecapPanel";
import { createMockApi } from "./test-api";

const recap = (over: Partial<MeetingRecap> = {}): MeetingRecap => ({
  id: "r1",
  meetingId: "m-1",
  windowStartMs: 600_000,
  windowEndMs: 1_200_000,
  markdown:
    "- Dana moved the launch to Thursday [10:00](seg:s1)\n- Sam said two bugs are left [12:05]",
  createdAt: Date.UTC(2026, 10, 21, 10, 20),
  ...over,
});

const detail = (
  over: {
    status?: string;
    recaps?: MeetingRecap[];
    recapStatus?: MeetingDetail["recapStatus"];
  } = {},
): MeetingDetail =>
  ({
    meeting: { id: "m-1", status: over.status ?? "recording" },
    recaps: over.recaps ?? [],
    recapStatus: over.recapStatus ?? { state: "idle" },
  }) as unknown as MeetingDetail;

let api: ReturnType<typeof createMockApi>;
const open = vi.fn();
beforeEach(() => {
  api = createMockApi();
  open.mockClear();
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

describe("What did I miss? (NT-13)", () => {
  it("asks for a recap during a recording", async () => {
    api.meetingRecap = vi.fn().mockResolvedValue({ ok: true, recap: recap() });
    render(<RecapPanel detail={detail()} onOpenSegment={open} />);
    expect(screen.getByText(/Ask for a recap of the last few minutes/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "What did I miss?" }));
    await waitFor(() => expect(api.meetingRecap).toHaveBeenCalledWith("m-1"));
  });

  it("lists the recaps, newest first, with the time they cover and a link on each bullet", () => {
    render(
      <RecapPanel
        detail={detail({
          recaps: [recap({ id: "r2", windowStartMs: 1_200_000, windowEndMs: 1_800_000 }), recap()],
        })}
        onOpenSegment={open}
      />,
    );
    const list = within(screen.getByRole("list", { name: "Recaps" }));
    expect(list.getAllByText(/of the meeting, written at/)).toHaveLength(2);
    expect(list.getAllByText(/20:00 to 30:00/)).toHaveLength(1);
    fireEvent.click(list.getAllByRole("button", { name: "Open the transcript at 10:00" })[0]!);
    expect(open).toHaveBeenCalledWith("s1");
    // A time with no line to link to is plain text.
    expect(list.getAllByText(/Sam said two bugs are left/).length).toBeGreaterThan(0);
  });

  it("shows that it is working, and disables the button meanwhile", () => {
    render(
      <RecapPanel detail={detail({ recapStatus: { state: "running" } })} onOpenSegment={open} />,
    );
    expect(screen.getByText("Writing the recap…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "What did I miss?" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("says why there is no recap, in plain words", async () => {
    api.meetingRecap = vi.fn().mockResolvedValue({
      ok: false,
      message: "Nothing new has been said since the last summary.",
    });
    render(<RecapPanel detail={detail()} onOpenSegment={open} />);
    fireEvent.click(screen.getByRole("button", { name: "What did I miss?" }));
    expect(
      await screen.findByText("Nothing new has been said since the last summary."),
    ).toBeTruthy();
  });

  it("shows a failure the model had", () => {
    render(
      <RecapPanel
        detail={detail({
          recapStatus: { state: "failed", message: "The recap could not be written. Try again." },
        })}
        onOpenSegment={open}
      />,
    );
    expect(screen.getByText("The recap could not be written. Try again.")).toBeTruthy();
  });

  it("keeps the recaps after the meeting, without the button, and shows nothing for a finished meeting with none", () => {
    const { container } = render(
      <RecapPanel detail={detail({ status: "ready", recaps: [recap()] })} onOpenSegment={open} />,
    );
    expect(screen.queryByRole("button", { name: "What did I miss?" })).toBeNull();
    expect(screen.getByText(/Dana moved the launch to Thursday/)).toBeTruthy();
    cleanup();
    const empty = render(<RecapPanel detail={detail({ status: "ready" })} onOpenSegment={open} />);
    expect(empty.container.textContent).toBe("");
    expect(container).toBeTruthy();
  });
});
