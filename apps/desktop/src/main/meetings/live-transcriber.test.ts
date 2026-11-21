import { describe, expect, it, vi } from "vitest";
import type { LiveTranscript, RecordingState } from "@murmur/shared";
import { createTestLogger } from "../helper/fakes";
import { createLiveTranscriber } from "./live-transcriber";

function result(channel: "mic" | "system", seq: number, text: string): LiveTranscript {
  return {
    text,
    language: "en",
    segments: [{ startMs: 500, endMs: 2500, text: ` ${text} `, confidence: 0.9 }],
    decodeMs: 5,
    audioMs: 3000,
    channel,
    seq,
    startMs: (seq - 1) * 30_000,
  };
}

function setup(how?: { languages: string[]; translate: boolean }) {
  let state: RecordingState = {
    status: "recording",
    meetingId: "m",
    title: "t",
    startedAt: 0,
    channels: ["mic", "system"],
    warnings: [],
  };
  let rounds = 0;
  const finals = new Set<string>();
  const flags = { dictating: false, enabled: true };
  const transcribeLive = vi.fn(async (input: { channel: "mic" | "system" }) =>
    result(input.channel, 2, input.channel === "mic" ? "Hello" : "[Music]"),
  );
  const partials: string[] = [];
  const live = createLiveTranscriber({
    transcribeLive,
    state: () => state,
    dictating: () => flags.dictating,
    enabled: () => flags.enabled,
    ...(how ? { options: () => how } : {}),
    isFinal: (_, channel, seq) => finals.has(`${channel}:${seq}`),
    wait: async () => {
      // Each pause is one round; stop after two.
      if (++rounds >= 2) state = { status: "idle" };
    },
    onPartial: (partial) =>
      partials.push(`${partial.channel}:${partial.seq}:${partial.segments.length}`),
    logger: createTestLogger(),
  });
  return { live, transcribeLive, partials, finals, flags };
}

describe("live transcriber", () => {
  it("decodes each channel's open chunk in turn and places it on the timeline", async () => {
    const t = setup();
    t.live.start("m", ["mic", "system"]);
    t.live.start("m", ["mic", "system"]);
    await Promise.resolve();
    await t.live.done();
    expect(t.transcribeLive).toHaveBeenCalledTimes(4);
    expect(t.partials).toEqual(["mic:2:1", "system:2:0", "mic:2:1", "system:2:0"]);
    // Once the recording ends, nothing grey is left.
    expect(t.live.partials("m")).toEqual([]);
  });

  it("shows the latest partial until its chunk is final", async () => {
    const t = setup();
    const shown: ReturnType<typeof t.live.partials>[] = [];
    t.transcribeLive.mockImplementation(async (input) => result(input.channel, 2, "Hello"));
    const original = t.live.partials;
    t.live.start("m", ["mic"]);
    await Promise.resolve();
    await Promise.resolve();
    shown.push(original("m"));
    t.finals.add("mic:2");
    shown.push(original("m"));
    await t.live.done();
    expect(shown[0]).toEqual([
      {
        meetingId: "m",
        channel: "mic",
        seq: 2,
        segments: [{ startMs: 30_500, endMs: 32_500, text: "Hello" }],
      },
    ]);
    expect(shown[1]).toEqual([]);
  });

  it("skips while a dictation runs or live text is off", async () => {
    const t = setup();
    t.flags.dictating = true;
    t.live.start("m", ["mic", "system"]);
    await t.live.done();
    expect(t.transcribeLive).not.toHaveBeenCalled();
  });

  it("decodes in the meeting's language, and translates when asked (NT-20)", async () => {
    const t = setup({ languages: ["es"], translate: true });
    t.live.start("m", ["mic"]);
    await t.live.done();
    expect(t.transcribeLive).toHaveBeenCalledWith({
      meetingId: "m",
      channel: "mic",
      languages: ["es"],
      translate: true,
    });
  });

  it("leaves the language out when it is detected and nothing is translated", async () => {
    const t = setup({ languages: [], translate: false });
    t.live.start("m", ["mic"]);
    await t.live.done();
    expect(t.transcribeLive).toHaveBeenCalledWith({ meetingId: "m", channel: "mic" });
  });
});
