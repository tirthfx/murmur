import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { createMeetingsStore } from "./meetings-store";
import { channelSpeakerId, createSpeakersStore } from "./speakers-store";
import { createSpeakerClip } from "./speaker-clip";
import { createTranscriptStore } from "./transcript-store";

function setup() {
  const db = openDatabase(":memory:");
  const meetings = createMeetingsStore(db);
  const transcripts = createTranscriptStore(db);
  let clock = 1_000;
  const speakers = createSpeakersStore(db, { now: () => ++clock });
  meetings.create({ id: "m-1", title: "Sync", startedAt: 1, source: "ad_hoc", folder: "/m/m-1" });
  meetings.finish("m-1", 60_000, 60_000, "queued");
  const chunk = (channel: "mic" | "system", seq: number, startMs: number) =>
    meetings.addChunk({
      meetingId: "m-1",
      channel,
      seq,
      path: `/m/m-1/${channel}-${seq}.m4a`,
      sha256: "a".repeat(64),
      bytes: 10,
      startMs,
      durationMs: 30_000,
    });
  const say = (channel: "mic" | "system", seq: number, texts: [number, number, string][]) =>
    transcripts.addChunkSegments(
      {
        meetingId: "m-1",
        channel,
        seq,
        path: `/m/m-1/${channel}-${seq}.m4a`,
        sha256: "a".repeat(64),
        bytes: 10,
        startMs: (seq - 1) * 30_000,
        durationMs: 30_000,
      },
      texts.map(([startMs, endMs, text]) => ({ channel, startMs, endMs, text, language: "en" })),
      5,
    );
  return { db, meetings, transcripts, speakers, chunk, say };
}

describe("speakers (NT-07)", () => {
  it("gives every line a speaker and every speaker a first name", () => {
    const t = setup();
    t.chunk("mic", 1, 0);
    t.chunk("system", 1, 0);
    t.say("mic", 1, [[1_000, 4_000, "Hello everyone."]]);
    t.say("system", 1, [
      [5_000, 12_000, "Hi, thanks for joining."],
      [13_000, 15_000, "Shall we start?"],
    ]);
    expect(t.transcripts.segments("m-1").map((s) => s.speakerId)).toEqual([
      channelSpeakerId("m-1", "mic"),
      channelSpeakerId("m-1", "system"),
      channelSpeakerId("m-1", "system"),
    ]);
    expect(t.speakers.list("m-1")).toEqual([
      {
        id: "m-1:mic",
        channel: "mic",
        name: "You",
        defaultName: "You",
        segments: 1,
        talkMs: 3_000,
      },
      {
        id: "m-1:system",
        channel: "system",
        name: "Remote",
        defaultName: "Remote",
        segments: 2,
        talkMs: 9_000,
      },
    ]);
  });

  it("lists only the channels a meeting recorded, and none for a meeting that is gone", () => {
    const t = setup();
    t.meetings.create({
      id: "m-2",
      title: "Mic only",
      startedAt: 2,
      source: "ad_hoc",
      folder: "/m/m-2",
    });
    t.meetings.setChannels("m-2", ["mic"]);
    expect(t.speakers.list("m-2").map((s) => s.id)).toEqual(["m-2:mic"]);
    t.meetings.setChannels("m-2", ["mic", "system"]);
    expect(t.speakers.list("m-2").map((s) => s.id)).toEqual(["m-2:mic", "m-2:system"]);
    expect(t.speakers.list("nope")).toEqual([]);
  });

  it("leaves dictated lines out of the counts", () => {
    const t = setup();
    t.chunk("mic", 1, 0);
    t.say("mic", 1, [[0, 2_000, "Spoken"]]);
    t.db
      .prepare(
        `INSERT INTO meeting_segments (id, meeting_id, channel, start_ms, end_ms, text, is_dictated, is_final, created_at)
         VALUES ('d1', 'm-1', 'mic', 5000, 9000, 'Dictated', 1, 1, 1)`,
      )
      .run();
    expect(t.speakers.list("m-1").find((s) => s.channel === "mic")).toMatchObject({
      segments: 1,
      talkMs: 2_000,
    });
  });

  it("renames a speaker for the whole meeting, lines before and after", () => {
    const t = setup();
    t.chunk("system", 1, 0);
    t.say("system", 1, [
      [1_000, 3_000, "First line."],
      [4_000, 6_000, "Second line."],
    ]);
    const result = t.speakers.rename("m-1", "m-1:system", "  Dana   Lee ");
    expect(result).toMatchObject({ ok: true });
    expect(t.speakers.list("m-1").find((s) => s.channel === "system")).toMatchObject({
      id: "m-1:system",
      name: "Dana Lee",
      segments: 2,
      defaultName: "Remote",
    });
    // Lines transcribed after the rename are Dana's too.
    t.chunk("system", 2, 30_000);
    t.say("system", 2, [[31_000, 33_000, "Third line."]]);
    const speaker = t.speakers.list("m-1").find((s) => s.channel === "system")!;
    expect(speaker).toMatchObject({ name: "Dana Lee", segments: 3 });
    expect(new Set(t.transcripts.segments("m-1").map((s) => s.speakerId))).toEqual(
      new Set([speaker.id]),
    );
    // The name is kept in one row, and the meeting's other speaker is untouched.
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meeting_speakers").get()).toEqual({ n: 1 });
    expect(t.speakers.list("m-1").find((s) => s.channel === "mic")?.name ?? "You").toBe("You");
  });

  it("renames again, and an empty name gives the first name back", () => {
    const t = setup();
    t.chunk("mic", 1, 0);
    t.say("mic", 1, [[0, 1_000, "Hi"]]);
    t.speakers.rename("m-1", "m-1:mic", "Priya (in room)");
    t.speakers.rename("m-1", "m-1:mic", "Priya");
    expect(t.speakers.list("m-1").find((s) => s.channel === "mic")!.name).toBe("Priya");
    t.speakers.rename("m-1", "m-1:mic", "   ");
    expect(t.speakers.list("m-1").find((s) => s.channel === "mic")!.name).toBe("You");
  });

  it.each([
    ["a speaker that is not in the meeting", "m-1:nobody", "Sam", /not in this meeting/],
    ["a speaker of another meeting", "m-2:mic", "Sam", /not in this meeting/],
    ["a name that is too long", "m-1:mic", "x".repeat(61), /up to 60/],
  ])("refuses %s", (_label, id, name, message) => {
    const t = setup();
    t.chunk("mic", 1, 0);
    t.say("mic", 1, [[0, 1_000, "Hi"]]);
    const result = t.speakers.rename("m-1", id, name);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).toMatch(message);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meeting_speakers").get()).toEqual({ n: 0 });
  });

  it("will not give two speakers one name", () => {
    const t = setup();
    t.chunk("mic", 1, 0);
    t.chunk("system", 1, 0);
    t.say("mic", 1, [[0, 1_000, "Hi"]]);
    t.say("system", 1, [[2_000, 3_000, "Hello"]]);
    expect(t.speakers.rename("m-1", "m-1:system", "you")).toMatchObject({ ok: false });
    t.speakers.rename("m-1", "m-1:mic", "Sam");
    expect(t.speakers.rename("m-1", "m-1:system", "SAM")).toMatchObject({ ok: false });
    expect(t.speakers.rename("m-1", "m-1:system", "Remote")).toMatchObject({ ok: true });
  });

  it("forgets the names with the meeting", () => {
    const t = setup();
    t.chunk("mic", 1, 0);
    t.say("mic", 1, [[0, 1_000, "Hi"]]);
    t.speakers.rename("m-1", "m-1:mic", "Sam");
    t.meetings.remove("m-1");
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meeting_speakers").get()).toEqual({ n: 0 });
  });
});

describe("speaker samples (NT-08)", () => {
  const read = (path: string) =>
    path.endsWith("missing.m4a") ? null : new Uint8Array([1, 2, 3, 4]);

  function withAudio() {
    const t = setup();
    t.chunk("system", 1, 0);
    t.chunk("system", 2, 30_000);
    t.say("system", 1, [
      [2_000, 4_000, "short"],
      [10_000, 19_000, "the longest line of the meeting"],
    ]);
    t.say("system", 2, [[40_000, 42_000, "later"]]);
    const clip = createSpeakerClip(t.db, { speakers: t.speakers, read });
    return { ...t, clip };
  }

  it("picks the longest line and plays at most 8 seconds of it", () => {
    const t = withAudio();
    expect(t.speakers.sample("m-1", "m-1:system")).toMatchObject({
      startMs: 10_000,
      endMs: 19_000,
    });
    const result = t.clip("m-1", "m-1:system");
    expect(result).toMatchObject({ ok: true, offsetSec: 10, playSec: 8 });
    if (result.ok) expect(result.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("plays a short line for at least 3 seconds, but never past the end of its chunk", () => {
    const t = setup();
    t.chunk("mic", 1, 0);
    t.say("mic", 1, [[28_500, 29_000, "Quick."]]);
    const clip = createSpeakerClip(t.db, { speakers: t.speakers, read });
    const result = clip("m-1", "m-1:mic");
    expect(result).toMatchObject({ ok: true, offsetSec: 28.5 });
    if (result.ok) expect(result.playSec).toBeCloseTo(1.5, 5);
  });

  it("takes the offset from the chunk the line is in", () => {
    const t = setup();
    t.chunk("system", 1, 0);
    t.chunk("system", 2, 30_000);
    t.say("system", 2, [[40_000, 44_000, "Only line."]]);
    const clip = createSpeakerClip(t.db, { speakers: t.speakers, read });
    expect(clip("m-1", "m-1:system")).toMatchObject({ ok: true, offsetSec: 10, playSec: 4 });
  });

  it("is not available once the audio is deleted", () => {
    const t = withAudio();
    t.db.prepare("UPDATE meetings SET audio_deleted_at = 99 WHERE id = 'm-1'").run();
    expect(t.clip("m-1", "m-1:system")).toEqual({ ok: false, reason: "audio-deleted" });
  });

  it("says why there is nothing to play", () => {
    const t = withAudio();
    expect(t.clip("m-1", "m-1:mic")).toEqual({ ok: false, reason: "no-speech" });
    expect(t.clip("nope", "nope:mic")).toEqual({ ok: false, reason: "no-audio" });
    const missing = createSpeakerClip(t.db, { speakers: t.speakers, read: () => null });
    expect(missing("m-1", "m-1:system")).toEqual({ ok: false, reason: "no-audio" });
    const huge = createSpeakerClip(t.db, {
      speakers: t.speakers,
      read: () => new Uint8Array(9 * 1024 * 1024),
    });
    expect(huge("m-1", "m-1:system")).toEqual({ ok: false, reason: "no-audio" });
    const empty = createSpeakerClip(t.db, { speakers: t.speakers, read: () => new Uint8Array(0) });
    expect(empty("m-1", "m-1:system")).toEqual({ ok: false, reason: "no-audio" });
  });
});
