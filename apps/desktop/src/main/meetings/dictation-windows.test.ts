import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { createDictationWindows } from "./dictation-windows";
import { createMeetingsStore } from "./meetings-store";
import { createTranscriptStore } from "./transcript-store";

function setup() {
  const db = openDatabase(":memory:");
  const meetings = createMeetingsStore(db);
  const transcripts = createTranscriptStore(db);
  const windows = createDictationWindows(db);
  meetings.create({ id: "m-1", title: "Sync", startedAt: 1, source: "ad_hoc", folder: "/m" });
  const chunk = (channel: "mic" | "system", seq: number) => ({
    meetingId: "m-1",
    channel,
    seq,
    path: `/m/${channel}-${seq}.m4a`,
    sha256: "a".repeat(64),
    bytes: 1,
    startMs: (seq - 1) * 30_000,
    durationMs: 30_000,
  });
  for (const channel of ["mic", "system"] as const)
    for (const seq of [1, 2]) meetings.addChunk(chunk(channel, seq));
  const write = (channel: "mic" | "system", seq: number, lines: [number, number, string][]) =>
    transcripts.addChunkSegments(
      chunk(channel, seq),
      lines.map(([startMs, endMs, text]) => ({ channel, startMs, endMs, text, language: "en" })),
      5,
    );
  const lines = () =>
    transcripts.segments("m-1").map((s) => [s.channel, s.text, s.isDictated] as const);
  return { db, meetings, transcripts, windows, write, lines };
}

describe("dictation during a meeting (NT-19)", () => {
  it("marks the microphone lines that overlap a dictation, and no others", () => {
    const t = setup();
    t.windows.open("m-1", 10_000);
    t.windows.close("m-1", 16_000);
    t.write("mic", 1, [
      [1_000, 4_000, "said to the others"],
      [10_500, 15_500, "dictated into an app"],
      [20_000, 24_000, "said to the others again"],
    ]);
    expect(t.lines()).toEqual([
      ["mic", "said to the others", false],
      ["mic", "dictated into an app", true],
      ["mic", "said to the others again", false],
    ]);
  });

  it("leaves remote speech that overlaps a dictation in the transcript", () => {
    const t = setup();
    t.windows.open("m-1", 10_000);
    t.windows.close("m-1", 16_000);
    t.write("system", 1, [[11_000, 14_000, "the others keep talking"]]);
    t.write("mic", 1, [[11_000, 14_000, "typed words"]]);
    expect(t.lines()).toEqual([
      ["mic", "typed words", true],
      ["system", "the others keep talking", false],
    ]);
  });

  it("allows a little slack at each end, but not more", () => {
    const t = setup();
    t.windows.open("m-1", 10_000);
    t.windows.close("m-1", 16_000);
    t.write("mic", 1, [
      [8_000, 9_000, "well before"],
      [9_200, 9_900, "just before"],
      [16_500, 17_500, "just after"],
      [17_000, 18_000, "well after"],
    ]);
    // 750 ms either side: the line that ends 800 ms before the dictation is not marked, the one 250 ms before is.
    expect(t.lines().map(([, text, dictated]) => [text, dictated])).toEqual([
      ["well before", false],
      ["just before", true],
      ["just after", true],
      ["well after", false],
    ]);
  });

  it("marks lines written before the dictation ended, once it ends", () => {
    const t = setup();
    t.windows.open("m-1", 10_000);
    // The chunk is written while the dictation is still going: an open window reaches to the end.
    t.write("mic", 1, [
      [2_000, 4_000, "before"],
      [11_000, 14_000, "during"],
    ]);
    expect(t.lines().map(([, , dictated]) => dictated)).toEqual([false, true]);
    t.windows.close("m-1", 12_000);
    expect(t.lines().map(([, , dictated]) => dictated)).toEqual([false, true]);
    // A later chunk is not marked by a window that has closed.
    t.write("mic", 2, [[31_000, 34_000, "later"]]);
    expect(t.lines().at(-1)).toEqual(["mic", "later", false]);
  });

  it("marks several dictations, in several chunks", () => {
    const t = setup();
    t.windows.open("m-1", 5_000);
    t.windows.close("m-1", 8_000);
    t.windows.open("m-1", 40_000);
    t.windows.close("m-1", 45_000);
    t.write("mic", 1, [
      [5_500, 7_500, "one"],
      [20_000, 22_000, "two"],
    ]);
    t.write("mic", 2, [
      [41_000, 44_000, "three"],
      [50_000, 52_000, "four"],
    ]);
    expect(t.lines().map(([, text, dictated]) => [text, dictated])).toEqual([
      ["one", true],
      ["two", false],
      ["three", true],
      ["four", false],
    ]);
  });

  it("keeps dictated lines out of the speakers' counts and the summary's lines", () => {
    const t = setup();
    t.windows.open("m-1", 10_000);
    t.windows.close("m-1", 16_000);
    t.write("mic", 1, [
      [1_000, 3_000, "spoken"],
      [11_000, 14_000, "dictated"],
    ]);
    const spoken = t.transcripts.segments("m-1").filter((s) => !s.isDictated);
    expect(spoken.map((s) => s.text)).toEqual(["spoken"]);
  });

  it("closes a dictation a crash left open, and forgets windows with the meeting", () => {
    const t = setup();
    t.windows.open("m-1", 10_000);
    expect(t.windows.closeLost()).toBe(1);
    expect(t.db.prepare("SELECT end_ms FROM meeting_dictations").get()).toEqual({
      end_ms: 130_000,
    });
    expect(t.windows.closeLost()).toBe(0);
    t.meetings.remove("m-1");
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meeting_dictations").get()).toEqual({ n: 0 });
  });

  it("does not close a window that is not open, and never ends before it starts", () => {
    const t = setup();
    t.windows.close("m-1", 5_000);
    t.windows.open("m-1", 20_000);
    t.windows.close("m-1", 10_000);
    expect(t.db.prepare("SELECT start_ms, end_ms FROM meeting_dictations").get()).toEqual({
      start_ms: 20_000,
      end_ms: 20_000,
    });
  });
});
