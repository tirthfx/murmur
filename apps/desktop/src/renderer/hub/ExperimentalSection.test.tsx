// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExperimentalSection, RING_SEARCH_SECONDS } from "./ExperimentalSection";
import { createMockApi } from "./test-api";

const off = {
  splitMessages: false,
  pauseMedia: false,
  headsetWear: false,
  ringMicrophone: false,
  bulkImport: false,
  phraseLearning: false,
  styleDetection: false,
  pronunciationClips: false,
  commandMode: false,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Experimental section", () => {
  it("turns an option on without touching the others", async () => {
    window.murmur = createMockApi();
    const onChange = vi.fn();
    render(<ExperimentalSection experimental={off} onChange={onChange} />);
    act(() => screen.getByRole("switch", { name: /Split into messages/ }).click());
    expect(onChange).toHaveBeenCalledWith({ ...off, splitMessages: true });
  });

  it("shows pause media as unavailable when the system will not say what is playing", async () => {
    window.murmur = createMockApi({
      getMediaPlayback: vi.fn().mockResolvedValue({ available: false, playing: null }),
    });
    render(<ExperimentalSection experimental={off} onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Not available on this Mac/)).toBeTruthy());
    expect(screen.getByRole("switch", { name: /Pause media/ }).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("keeps headset wear disabled with the reason", () => {
    window.murmur = createMockApi();
    render(<ExperimentalSection experimental={off} onChange={vi.fn()} />);
    const headset = screen.getByRole("switch", { name: /headset is put on/ });
    expect(headset.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(/does not support any yet/)).toBeTruthy();
  });

  it("shows the three experimental dictionary and style options, all off", () => {
    window.murmur = createMockApi();
    const onChange = vi.fn();
    render(<ExperimentalSection experimental={off} onChange={onChange} />);
    for (const name of [/Learn phrases/, /Detect the style/, /Pronunciation clips/]) {
      expect((screen.getByRole("switch", { name }) as HTMLInputElement).checked).toBe(false);
    }
    act(() => screen.getByRole("switch", { name: /Pronunciation clips/ }).click());
    expect(onChange).toHaveBeenCalledWith({ ...off, pronunciationClips: true });
  });

  it("keeps learning from sent mail disabled, explaining the mail connector", () => {
    window.murmur = createMockApi();
    render(<ExperimentalSection experimental={off} onChange={vi.fn()} />);
    const mail = screen.getByRole("switch", { name: /Learn from sent mail/ });
    expect(mail.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(/needs a mail connector/)).toBeTruthy();
  });

  it("hides the ring search until the ring is turned on, then searches for 30 seconds", () => {
    vi.useFakeTimers();
    window.murmur = createMockApi();
    const { rerender } = render(<ExperimentalSection experimental={off} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Search for ring" })).toBeNull();
    rerender(
      <ExperimentalSection experimental={{ ...off, ringMicrophone: true }} onChange={vi.fn()} />,
    );
    act(() => screen.getByRole("button", { name: "Search for ring" }).click());
    expect(screen.getByText(`Searching… ${RING_SEARCH_SECONDS} s`)).toBeTruthy();
    act(() => vi.advanceTimersByTime(RING_SEARCH_SECONDS * 1000));
    expect(screen.getByText(/No ring found/)).toBeTruthy();
  });
});
