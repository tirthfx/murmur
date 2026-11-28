// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptureLevel } from "@murmur/shared";
import { RecordingLevels } from "./RecordingLevels";
import { createMockApi } from "./test-api";

afterEach(cleanup);

describe("the recording's level meters (NT-04)", () => {
  it("shows a meter for each channel and moves the one that was heard", () => {
    let push: (level: CaptureLevel) => void = () => undefined;
    window.murmur = createMockApi({
      onMeetingLevel: vi.fn((handler: (level: CaptureLevel) => void) => {
        push = handler;
        return () => undefined;
      }),
    });
    render(<RecordingLevels channels={["mic", "system"]} />);
    const mic = screen.getByRole("meter", { name: "Your microphone level" });
    const system = screen.getByRole("meter", { name: "The Mac's sound level" });
    expect(mic.getAttribute("aria-valuenow")).toBe("0");

    act(() => push({ meetingId: "m1", channel: "mic", rmsDb: -30 }));
    expect(mic.getAttribute("aria-valuenow")).toBe("50");
    expect(system.getAttribute("aria-valuenow")).toBe("0");
  });
});
