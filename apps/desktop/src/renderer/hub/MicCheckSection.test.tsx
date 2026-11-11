// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIC_CHECK_SENTENCES } from "@murmur/shared";
import { MicCheckSection, meterPercent } from "./MicCheckSection";
import { createMockApi } from "./test-api";

afterEach(() => {
  cleanup();
});

describe("Microphone check", () => {
  it("maps levels onto the meter", () => {
    expect(meterPercent(null)).toBe(0);
    expect(meterPercent(-70)).toBe(0);
    expect(meterPercent(-30)).toBe(50);
    expect(meterPercent(3)).toBe(100);
  });

  it("shows the sentences and a live meter, then the advice", async () => {
    const user = userEvent.setup();
    let push: (rmsDb: number) => void = () => {};
    window.murmur = createMockApi({
      onMicCheckLevel: vi.fn((handler: (rmsDb: number) => void) => {
        push = handler;
        return () => {};
      }),
      micCheckStop: vi.fn().mockResolvedValue({
        deviceName: "Desk Mic",
        speechDb: -24,
        noiseDb: -40,
        advice: "noisy",
        adviceText: "Noisy room: a headset will give better results.",
      }),
    });
    render(<MicCheckSection />);
    await user.click(screen.getByRole("button", { name: "Start microphone check" }));
    expect(await screen.findByText("Listening on Desk Mic")).toBeTruthy();
    for (const sentence of MIC_CHECK_SENTENCES) expect(screen.getByText(sentence)).toBeTruthy();
    act(() => push(-30));
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("50");
    await user.click(screen.getByRole("button", { name: "Finish microphone check" }));
    await waitFor(() =>
      expect(screen.getByText("Noisy room: a headset will give better results.")).toBeTruthy(),
    );
    expect(screen.getByText("Voice -24 dB, background -40 dB, on Desk Mic.")).toBeTruthy();
  });

  it("explains why it could not start", async () => {
    const user = userEvent.setup();
    window.murmur = createMockApi({
      micCheckStart: vi
        .fn()
        .mockResolvedValue({ ok: false, message: "Microphone access is not granted." }),
    });
    render(<MicCheckSection />);
    await user.click(screen.getByRole("button", { name: "Start microphone check" }));
    expect(await screen.findByText("Microphone access is not granted.")).toBeTruthy();
  });
});
