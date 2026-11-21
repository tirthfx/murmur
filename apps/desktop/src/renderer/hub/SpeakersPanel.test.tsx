// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingDetail, MeetingSpeaker } from "@murmur/shared";
import { SpeakersPanel } from "./SpeakersPanel";
import { createMockApi } from "./test-api";

const speakers: MeetingSpeaker[] = [
  { id: "m-1:mic", channel: "mic", name: "You", defaultName: "You", segments: 3, talkMs: 65_000 },
  {
    id: "m-1:system",
    channel: "system",
    name: "Remote",
    defaultName: "Remote",
    segments: 1,
    talkMs: 9_000,
  },
];

const detail = (over: Partial<MeetingDetail["meeting"]> = {}, list = speakers): MeetingDetail =>
  ({
    meeting: {
      id: "m-1",
      title: "Sync",
      startedAt: 1,
      endedAt: 2,
      source: "ad_hoc",
      status: "ready",
      channels: ["mic", "system"],
      warnings: [],
      durationMs: 1000,
      audioDeletedAt: null,
      ...over,
    },
    speakers: list,
  }) as unknown as MeetingDetail;

let api: ReturnType<typeof createMockApi>;
const started: { offset: number; duration: number }[] = [];
let endPlayback: () => void = () => undefined;

beforeEach(() => {
  api = createMockApi();
  started.length = 0;
  // Web Audio, as far as the player uses it.
  class FakeContext {
    state = "running";
    destination = {};
    decodeAudioData = vi.fn().mockResolvedValue({ duration: 30 });
    resume = vi.fn().mockResolvedValue(undefined);
    createBufferSource() {
      const source = {
        buffer: null as unknown,
        onended: null as null | (() => void),
        connect: vi.fn(),
        stop: vi.fn(() => source.onended?.()),
        start: vi.fn((_when: number, offset: number, duration: number) => {
          started.push({ offset, duration });
          endPlayback = () => source.onended?.();
        }),
      };
      return source;
    }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeContext;
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(() => {
  cleanup();
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
});

describe("Speakers (NT-07, NT-08)", () => {
  it("lists each speaker with their lines and talk time", () => {
    render(<SpeakersPanel detail={detail()} />);
    expect(screen.getByRole("button", { name: "Play a sample of You" })).toBeTruthy();
    expect(screen.getByText("3 lines · 1:05 of talk")).toBeTruthy();
    expect(screen.getByText("1 line · 0:09 of talk")).toBeTruthy();
  });

  it("shows nothing when the meeting has no speakers", () => {
    const { container } = render(<SpeakersPanel detail={detail({}, [])} />);
    expect(container.textContent).toBe("");
  });

  it("renames a speaker for the whole meeting", async () => {
    api.meetingSpeakerRename = vi.fn().mockResolvedValue({ ok: true, speakers });
    render(<SpeakersPanel detail={detail()} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Remote" }));
    const input = screen.getByLabelText("Name for Remote");
    expect((input as HTMLInputElement).value).toBe("Remote");
    fireEvent.change(input, { target: { value: "Dana" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the name of Remote" }));
    await waitFor(() =>
      expect(api.meetingSpeakerRename).toHaveBeenCalledWith("m-1", "m-1:system", "Dana"),
    );
    await waitFor(() => expect(screen.queryByLabelText("Name for Remote")).toBeNull());
  });

  it("says why a name was refused and keeps the box open", async () => {
    api.meetingSpeakerRename = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "You is already a speaker in this meeting." });
    render(<SpeakersPanel detail={detail()} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Remote" }));
    fireEvent.change(screen.getByLabelText("Name for Remote"), { target: { value: "you" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the name of Remote" }));
    expect(await screen.findByText("You is already a speaker in this meeting.")).toBeTruthy();
    expect(screen.getByLabelText("Name for Remote")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel renaming" }));
    expect(screen.queryByLabelText("Name for Remote")).toBeNull();
  });

  it("plays a sample from the line's start, and stops it with a second click", async () => {
    api.meetingSpeakerClip = vi.fn().mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1, 2, 3]),
      offsetSec: 10,
      playSec: 8,
      segmentId: "s1",
    });
    render(<SpeakersPanel detail={detail()} />);
    await act(async () => screen.getByRole("button", { name: "Play a sample of Remote" }).click());
    expect(api.meetingSpeakerClip).toHaveBeenCalledWith("m-1", "m-1:system");
    await waitFor(() => expect(started).toEqual([{ offset: 10, duration: 8 }]));
    const stop = await screen.findByRole("button", { name: "Stop the sample of Remote" });
    await act(async () => stop.click());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Play a sample of Remote" })).toBeTruthy(),
    );
  });

  it("goes back to Play when the sample ends by itself", async () => {
    api.meetingSpeakerClip = vi.fn().mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1]),
      offsetSec: 0,
      playSec: 3,
      segmentId: "s1",
    });
    render(<SpeakersPanel detail={detail()} />);
    await act(async () => screen.getByRole("button", { name: "Play a sample of You" }).click());
    await screen.findByRole("button", { name: "Stop the sample of You" });
    await act(async () => endPlayback());
    expect(await screen.findByRole("button", { name: "Play a sample of You" })).toBeTruthy();
  });

  it("is disabled once the audio is deleted, with the reason", async () => {
    render(<SpeakersPanel detail={detail({ audioDeletedAt: 99 })} />);
    const play = screen.getByRole("button", {
      name: /Play a sample of You \(the audio was deleted\)/,
    });
    expect(play).toHaveProperty("disabled", true);
    expect(play.getAttribute("title")).toMatch(/audio of this meeting was deleted/);
    fireEvent.click(play);
    expect(api.meetingSpeakerClip).not.toHaveBeenCalled();
  });

  it.each([
    ["audio-deleted", /audio of this meeting was deleted/],
    ["no-speech", /no lines to play/],
    ["no-audio", /could not be found/],
  ] as const)("explains a clip that is %s", async (reason, text) => {
    api.meetingSpeakerClip = vi.fn().mockResolvedValue({ ok: false, reason });
    render(<SpeakersPanel detail={detail()} />);
    await act(async () => screen.getByRole("button", { name: "Play a sample of You" }).click());
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it("says so when the sample cannot be played", async () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = class {
      decodeAudioData = vi.fn().mockRejectedValue(new Error("bad data"));
      state = "running";
    };
    api.meetingSpeakerClip = vi.fn().mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1]),
      offsetSec: 0,
      playSec: 3,
      segmentId: "s1",
    });
    render(<SpeakersPanel detail={detail()} />);
    await act(async () => screen.getByRole("button", { name: "Play a sample of You" }).click());
    expect(await screen.findByText("The sample could not be played.")).toBeTruthy();
  });
});
