import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { createCorrectionsStore } from "./corrections-store";
import { createMeetingsStore } from "./meetings-store";
import { createSpeakersStore } from "./speakers-store";
import { createTranscriptStore } from "./transcript-store";

function setup() {
  const db = openDatabase(":memory:");
  const meetings = createMeetingsStore(db);
  const transcripts = createTranscriptStore(db);
  let clock = 100;
  const speakers = createSpeakersStore(db, { now: () => ++clock });
  const corrections = createCorrectionsStore(db, { now: () => ++clock, speakers });
  meetings.create({ id: "m-1", title: "Sync", startedAt: 1, source: "ad_hoc", folder: "/m" });
  const insert = (
    id: string,
    channel: "mic" | "system",
    startMs: number,
    endMs: number,
    text: string,
    over: { dictated?: number; speaker?: string | null } = {},
  ) =>
    db
      .prepare(
        `INSERT INTO meeting_segments (id, meeting_id, channel, start_ms, end_ms, text, speaker_id, is_dictated, is_final, created_at)
         VALUES (?, 'm-1', ?, ?, ?, ?, ?, ?, 1, 1)`,
      )
      .run(id, channel, startMs, endMs, text, over.speaker ?? null, over.dictated ?? 0);
  insert("a", "system", 1_000, 5_000, "We should ship the new onboarding flow on Thursday.");
  insert("b", "system", 5_000, 8_000, "If the load test passes.");
  insert("c", "mic", 9_000, 11_000, "Agreed.");
  insert("d", "mic", 12_000, 13_000, "Dictated note.", { dictated: 1 });
  const text = (id: string) =>
    transcripts.segments("m-1").find((segment) => segment.id === id)?.text;
  const find = (id: string) => transcripts.segments("m-1").find((segment) => segment.id === id);
  return { db, meetings, transcripts, speakers, corrections, text, find, insert };
}

describe("edit a line's text (NT-24)", () => {
  it("changes the text, marks the line and keeps the original", () => {
    const t = setup();
    const result = t.corrections.apply("m-1", {
      kind: "text",
      segmentId: "a",
      text: "  We should ship the new onboarding flow on  Friday. ",
    });
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      before: "We should ship the new onboarding flow on Thursday.",
      after: "We should ship the new onboarding flow on Friday.",
    });
    expect(t.text("a")).toBe("We should ship the new onboarding flow on Friday.");
    expect(t.find("a")?.edited).toBe(true);
    expect(t.find("b")?.edited).toBe(false);
    expect(t.corrections.history("m-1", "a")).toEqual([
      {
        id: expect.any(Number),
        kind: "text",
        createdAt: expect.any(Number),
        original: "We should ship the new onboarding flow on Thursday.",
        canRevert: true,
      },
    ]);
  });

  it("does nothing for the same text, and refuses an empty or too long line and a missing or dictated one", () => {
    const t = setup();
    expect(
      t.corrections.apply("m-1", { kind: "text", segmentId: "c", text: "Agreed." }),
    ).toMatchObject({ ok: true, changed: false });
    expect(t.corrections.history("m-1", "c")).toEqual([]);
    expect(t.corrections.apply("m-1", { kind: "text", segmentId: "c", text: "   " })).toMatchObject(
      { ok: false },
    );
    expect(
      t.corrections.apply("m-1", { kind: "text", segmentId: "c", text: "x".repeat(4_001) }),
    ).toMatchObject({ ok: false });
    expect(
      t.corrections.apply("m-1", { kind: "text", segmentId: "nope", text: "x" }),
    ).toMatchObject({ ok: false });
    expect(t.corrections.apply("m-1", { kind: "text", segmentId: "d", text: "x" })).toMatchObject({
      ok: false,
    });
    expect(t.corrections.apply("m-2", { kind: "text", segmentId: "a", text: "x" })).toMatchObject({
      ok: false,
    });
    expect(t.text("c")).toBe("Agreed.");
  });

  it("restores the original on revert and removes the correction", () => {
    const t = setup();
    t.corrections.apply("m-1", { kind: "text", segmentId: "a", text: "Changed." });
    const [item] = t.corrections.history("m-1", "a");
    expect(t.corrections.revert("m-1", item!.id)).toEqual({ ok: true });
    expect(t.text("a")).toBe("We should ship the new onboarding flow on Thursday.");
    expect(t.find("a")?.edited).toBe(false);
    expect(t.corrections.history("m-1", "a")).toEqual([]);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM transcript_corrections").get()).toEqual({
      n: 0,
    });
    expect(t.corrections.revert("m-1", item!.id)).toMatchObject({ ok: false });
  });

  it("takes back changes one at a time, newest first", () => {
    const t = setup();
    t.corrections.apply("m-1", { kind: "text", segmentId: "a", text: "One." });
    t.corrections.apply("m-1", { kind: "text", segmentId: "a", text: "Two." });
    t.corrections.apply("m-1", { kind: "speaker", segmentId: "a", newName: "Priya" });
    const history = t.corrections.history("m-1", "a");
    expect(history.map((h) => [h.kind, h.canRevert])).toEqual([
      ["speaker", true],
      ["text", false],
      ["text", false],
    ]);
    expect(history[2]!.original).toBe("We should ship the new onboarding flow on Thursday.");
    // An older one cannot go first.
    expect(t.corrections.revert("m-1", history[1]!.id)).toMatchObject({
      ok: false,
      message: expect.stringContaining("later change"),
    });
    expect(t.text("a")).toBe("Two.");
    expect(t.corrections.revert("m-1", history[0]!.id)).toEqual({ ok: true });
    expect(t.corrections.revert("m-1", history[1]!.id)).toEqual({ ok: true });
    expect(t.text("a")).toBe("One.");
    expect(t.corrections.revert("m-1", history[2]!.id)).toEqual({ ok: true });
    expect(t.text("a")).toBe("We should ship the new onboarding flow on Thursday.");
    expect(t.find("a")).toMatchObject({ edited: false, speakerId: "m-1:system" });
  });
});

describe("change a line's speaker (NT-24)", () => {
  it("gives a line to a new speaker, and lists them once they have lines", () => {
    const t = setup();
    const result = t.corrections.apply("m-1", {
      kind: "speaker",
      segmentId: "c",
      newName: "Priya (in room)",
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(t.find("c")).toMatchObject({ speakerId: "m-1:p1", edited: true });
    const list = t.speakers.list("m-1");
    expect(list.map((s) => [s.name, s.segments])).toEqual([
      ["You", 0],
      ["Remote", 2],
      ["Priya (in room)", 1],
    ]);
    // The speaker has a channel (where its lines are) and plays its own line.
    expect(list[2]).toMatchObject({ id: "m-1:p1", channel: "mic" });
    expect(t.speakers.sample("m-1", "m-1:p1")).toMatchObject({ segmentId: "c", channel: "mic" });
  });

  it("gives a line to an existing speaker, and does nothing when it is already theirs", () => {
    const t = setup();
    expect(
      t.corrections.apply("m-1", { kind: "speaker", segmentId: "c", speakerId: "m-1:system" }),
    ).toMatchObject({ ok: true, changed: true });
    expect(t.find("c")?.speakerId).toBe("m-1:system");
    expect(t.speakers.list("m-1").find((s) => s.id === "m-1:system")?.segments).toBe(3);
    expect(
      t.corrections.apply("m-1", { kind: "speaker", segmentId: "a", speakerId: "m-1:system" }),
    ).toMatchObject({ ok: true, changed: false });
    expect(
      t.corrections.apply("m-1", { kind: "speaker", segmentId: "a", speakerId: "m-1:nobody" }),
    ).toMatchObject({ ok: false });
    expect(t.corrections.apply("m-1", { kind: "speaker", segmentId: "a" })).toMatchObject({
      ok: false,
    });
    expect(
      t.corrections.apply("m-1", { kind: "speaker", segmentId: "a", newName: "  " }),
    ).toMatchObject({ ok: false });
  });

  it("refuses a name another speaker has, and adds nothing", () => {
    const t = setup();
    const result = t.corrections.apply("m-1", {
      kind: "speaker",
      segmentId: "c",
      newName: "remote",
    });
    expect(result).toMatchObject({ ok: false });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meeting_speakers").get()).toEqual({ n: 0 });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM transcript_corrections").get()).toEqual({
      n: 0,
    });
  });

  it("goes back to the earlier speaker on revert", () => {
    const t = setup();
    t.corrections.apply("m-1", { kind: "speaker", segmentId: "c", newName: "Priya" });
    const [item] = t.corrections.history("m-1", "c");
    expect(item).toMatchObject({ kind: "speaker", original: "You" });
    t.corrections.revert("m-1", item!.id);
    expect(t.find("c")).toMatchObject({ speakerId: "m-1:mic", edited: false });
    expect(t.speakers.list("m-1").map((s) => s.name)).toEqual(["You", "Remote"]);
  });

  it("numbers added speakers one after another", () => {
    const t = setup();
    t.corrections.apply("m-1", { kind: "speaker", segmentId: "c", newName: "Priya" });
    t.corrections.apply("m-1", { kind: "speaker", segmentId: "b", newName: "Sam" });
    expect(t.find("c")?.speakerId).toBe("m-1:p1");
    expect(t.find("b")?.speakerId).toBe("m-1:p2");
  });
});

describe("split a line (NT-24)", () => {
  const TEXT = "We should ship the new onboarding flow on Thursday.";

  it("cuts the text and the time together, keeping both ends", () => {
    const t = setup();
    const offset = TEXT.indexOf("on Thursday");
    expect(t.corrections.apply("m-1", { kind: "split", segmentId: "a", offset })).toMatchObject({
      ok: true,
      changed: true,
    });
    const lines = t.transcripts
      .segments("m-1")
      .filter((s) => s.channel === "system" && s.id.startsWith("a"));
    expect(lines).toHaveLength(2);
    const [first, second] = lines as [(typeof lines)[0], (typeof lines)[0]];
    expect(first.text).toBe("We should ship the new onboarding flow");
    expect(second.text).toBe("on Thursday.");
    // Times: the first starts where the line did, the second ends where it did, and they meet.
    expect(first.startMs).toBe(1_000);
    expect(second.endMs).toBe(5_000);
    expect(first.endMs).toBe(second.startMs);
    expect(first.endMs).toBeGreaterThan(first.startMs);
    expect(second.endMs).toBeGreaterThan(second.startMs);
    // About the share of the text before the cut.
    expect(first.endMs).toBe(1_000 + Math.round(4_000 * (offset / TEXT.length)));
    expect(first.id).toBe("a");
    expect(second.id).toMatch(/^a\+\d+$/);
    expect(first.edited && second.edited).toBe(true);
    // In time order, so the transcript reads right.
    expect(t.transcripts.segments("m-1").map((s) => s.id)).toEqual(["a", second.id, "b", "c", "d"]);
  });

  it("puts the line back together on revert", () => {
    const t = setup();
    t.corrections.apply("m-1", { kind: "split", segmentId: "a", offset: 10 });
    const [item] = t.corrections.history("m-1", "a");
    expect(item).toMatchObject({ kind: "split", canRevert: true, original: TEXT });
    t.corrections.revert("m-1", item!.id);
    expect(t.transcripts.segments("m-1").map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
    expect(t.find("a")).toMatchObject({ text: TEXT, startMs: 1_000, endMs: 5_000, edited: false });
  });

  it("keeps both halves inside the line even for a cut at the very start or end", () => {
    const t = setup();
    t.insert("tiny", "mic", 20_000, 20_002, "hello world");
    t.corrections.apply("m-1", { kind: "split", segmentId: "tiny", offset: 1 });
    const halves = t.transcripts.segments("m-1").filter((s) => s.id.startsWith("tiny"));
    expect(halves.map((s) => [s.startMs, s.endMs])).toEqual([
      [20_000, 20_001],
      [20_001, 20_002],
    ]);
  });

  it("refuses a cut with nothing on one side, and a line too short to cut", () => {
    const t = setup();
    expect(
      t.corrections.apply("m-1", { kind: "split", segmentId: "c", offset: 100 }),
    ).toMatchObject({ ok: false });
    expect(t.corrections.apply("m-1", { kind: "split", segmentId: "c", offset: 1 })).toMatchObject({
      ok: true,
    });
    t.insert("flash", "mic", 30_000, 30_001, "a b");
    expect(
      t.corrections.apply("m-1", { kind: "split", segmentId: "flash", offset: 1 }),
    ).toMatchObject({ ok: false, message: expect.stringContaining("too short") });
    t.insert("spacey", "mic", 40_000, 44_000, "word   ");
    expect(
      t.corrections.apply("m-1", { kind: "split", segmentId: "spacey", offset: 4 }),
    ).toMatchObject({ ok: false });
  });

  it("can split the second half again, and revert in order", () => {
    const t = setup();
    t.corrections.apply("m-1", { kind: "split", segmentId: "a", offset: 20 });
    const second = t.transcripts.segments("m-1").find((s) => s.id.startsWith("a+"))!;
    t.corrections.apply("m-1", { kind: "split", segmentId: second.id, offset: 5 });
    expect(t.transcripts.segments("m-1").filter((s) => s.id.startsWith("a"))).toHaveLength(3);
    const firstSplit = t.corrections.history("m-1", "a")[0]!;
    expect(firstSplit.canRevert).toBe(false);
    expect(t.corrections.revert("m-1", firstSplit.id)).toMatchObject({ ok: false });
    const latest = t.corrections.history("m-1", second.id)[0]!;
    expect(t.corrections.revert("m-1", latest.id)).toEqual({ ok: true });
    expect(t.corrections.revert("m-1", t.corrections.history("m-1", "a")[0]!.id)).toEqual({
      ok: true,
    });
    expect(t.find("a")?.text).toBe(TEXT);
  });
});

describe("merge lines (NT-24)", () => {
  it("joins a line with the next of its channel, keeping the span and the original", () => {
    const t = setup();
    expect(t.corrections.apply("m-1", { kind: "merge", segmentId: "a" })).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(t.find("a")).toMatchObject({
      text: "We should ship the new onboarding flow on Thursday. If the load test passes.",
      startMs: 1_000,
      endMs: 8_000,
      edited: true,
    });
    expect(t.find("b")).toBeUndefined();
    expect(t.transcripts.segments("m-1").map((s) => s.id)).toEqual(["a", "c", "d"]);
    const [item] = t.corrections.history("m-1", "a");
    expect(item).toMatchObject({ kind: "merge", canRevert: true });
    expect(item!.original).toBe(
      "We should ship the new onboarding flow on Thursday. If the load test passes.".replace(
        / If the load test passes\.$/,
        "",
      ) + " If the load test passes.",
    );
  });

  it("brings both lines back on revert", () => {
    const t = setup();
    t.corrections.apply("m-1", { kind: "merge", segmentId: "a" });
    t.corrections.revert("m-1", t.corrections.history("m-1", "a")[0]!.id);
    expect(t.transcripts.segments("m-1").map((s) => [s.id, s.endMs, s.edited])).toEqual([
      ["a", 5_000, false],
      ["b", 8_000, false],
      ["c", 11_000, false],
      ["d", 13_000, false],
    ]);
  });

  it("refuses when there is no next line of the channel, or its speaker is another", () => {
    const t = setup();
    expect(t.corrections.apply("m-1", { kind: "merge", segmentId: "b" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("no next line"),
    });
    // The last line of the microphone has only a dictated line after it: not a line to join.
    expect(t.corrections.apply("m-1", { kind: "merge", segmentId: "c" })).toMatchObject({
      ok: false,
    });
    t.corrections.apply("m-1", { kind: "speaker", segmentId: "b", newName: "Dana" });
    expect(t.corrections.apply("m-1", { kind: "merge", segmentId: "a" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("another speaker"),
    });
  });
});

describe("corrections and their meeting", () => {
  it("are forgotten when the meeting is deleted", () => {
    const t = setup();
    t.corrections.apply("m-1", { kind: "text", segmentId: "a", text: "Changed." });
    t.meetings.remove("m-1");
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM transcript_corrections").get()).toEqual({
      n: 0,
    });
  });

  it("do not touch a rolled-back change", () => {
    const t = setup();
    // A merge whose second step fails leaves both lines as they were.
    t.db.exec(
      "CREATE TRIGGER boom BEFORE INSERT ON meeting_segments WHEN new.id = 'a' AND new.text LIKE '%load test%' BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    expect(() => t.corrections.apply("m-1", { kind: "merge", segmentId: "a" })).toThrow();
    expect(t.transcripts.segments("m-1").map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM transcript_corrections").get()).toEqual({
      n: 0,
    });
  });
});
