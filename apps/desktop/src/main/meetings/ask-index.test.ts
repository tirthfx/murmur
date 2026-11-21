import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import {
  CHUNK_CHARS,
  stem,
  createAskIndex,
  ftsQuery,
  notesPieces,
  summaryPieces,
  taskPiece,
  transcriptPieces,
} from "./ask-index";
import { createMeetingsStore } from "./meetings-store";
import { createSummariesStore } from "./summaries-store";
import { createTasksService } from "./tasks-service";

function setup() {
  const db = openDatabase(":memory:");
  const meetings = createMeetingsStore(db);
  const index = createAskIndex(db, { now: () => 9_000 });
  const tasks = createTasksService(db, { newId: () => `t${Math.random()}`, now: () => 5 });
  const summaries = createSummariesStore(db);
  const meeting = (id: string, title: string, startedAt: number) =>
    meetings.create({ id, title, startedAt, source: "ad_hoc", folder: `/m/${id}` });
  let n = 0;
  const say = (
    meetingId: string,
    startMs: number,
    text: string,
    over: { channel?: "mic" | "system"; dictated?: boolean } = {},
  ) =>
    db
      .prepare(
        `INSERT INTO meeting_segments (id, meeting_id, channel, start_ms, end_ms, text, is_dictated, is_final, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      )
      .run(
        `${meetingId}:s${++n}`,
        meetingId,
        over.channel ?? "system",
        startMs,
        startMs + 1000,
        text,
        over.dictated ? 1 : 0,
      );
  const notes = (meetingId: string, body: string, at = 1) =>
    db
      .prepare(
        `INSERT INTO meeting_notes (meeting_id, body_md, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (meeting_id) DO UPDATE SET body_md = excluded.body_md, updated_at = excluded.updated_at`,
      )
      .run(meetingId, body, at);
  return { db, meetings, index, tasks, summaries, meeting, say, notes };
}

describe("ftsQuery", () => {
  it("keeps the words that carry meaning, with endings for longer ones", () => {
    expect(ftsQuery("What did we decide about the Frankfurt server?")).toBe(
      '"decide"* OR "frankfurt"* OR "server"*',
    );
    expect(ftsQuery("Who owns QA?")).toBe('"own"* OR "qa"');
  });
  it("gives nothing for a question of only small words", () => {
    expect(ftsQuery("What is it?")).toBeNull();
    expect(ftsQuery("")).toBeNull();
  });
  it("cannot be broken by quotes or operators", () => {
    expect(ftsQuery('budget" OR NEAR(x) -secret')).toBe('"budget"* OR "near"* OR "secret"*');
  });
});

describe("stem", () => {
  it.each([
    ["shipping", "ship"],
    ["ships", "ship"],
    ["shipped", "ship"],
    ["planning", "plan"],
    ["calling", "call"],
    ["passing", "pass"],
    ["boxes", "box"],
    ["process", "process"],
    ["string", "string"],
    ["bus", "bus"],
    ["decided", "decid"],
  ])("cuts %s to %s", (word, expected) => {
    expect(stem(word)).toBe(expected);
  });
});

describe("pieces", () => {
  const line = (i: number, text = "word ".repeat(20).trim()) => ({
    id: `s${i}`,
    startMs: i * 1000,
    channel: (i % 2 ? "mic" : "system") as "mic" | "system",
    text,
  });

  it("cuts a transcript into pieces of about 200 tokens, each starting with the last line before", () => {
    const pieces = transcriptPieces(Array.from({ length: 30 }, (_, i) => line(i)));
    expect(pieces.length).toBeGreaterThan(2);
    for (const piece of pieces) expect(piece.text.length).toBeLessThanOrEqual(CHUNK_CHARS + 130);
    // The second piece begins with the line the first ended with.
    const lastOfFirst = pieces[0]!.text.split("\n").at(-1);
    expect(pieces[1]!.text.split("\n")[0]).toBe(lastOfFirst);
    expect(pieces[0]).toMatchObject({ ref: "s0", startMs: 0 });
    expect(pieces[0]!.text.startsWith("Remote: word")).toBe(true);
    expect(
      pieces[1]!.text.split("\n")[0]!.startsWith("Owner: ") ||
        pieces[1]!.text.startsWith("Remote: "),
    ).toBe(true);
  });

  it("keeps a short transcript in one piece and does not make a piece of a carried line alone", () => {
    expect(transcriptPieces([line(1, "hi"), line(2, "there")])).toHaveLength(1);
    expect(transcriptPieces([])).toEqual([]);
    const pieces = transcriptPieces(Array.from({ length: 30 }, (_, i) => line(i)));
    const refs = pieces.map((p) => p.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("takes a line longer than the carry limit as the start of a fresh piece", () => {
    const pieces = transcriptPieces([line(0, "x".repeat(400)), line(1, "y".repeat(400))]);
    expect(pieces).toHaveLength(2);
    expect(pieces[1]!.text.startsWith("Owner: y")).toBe(true);
  });

  it("makes a piece of each section of a summary, without links or empty sections", () => {
    const pieces = summaryPieces(
      "sum-1",
      "## Decisions\n- Ship on Thursday [0:12](seg:m:1) [1:05](seg:m:2)\n- Keep the old flow (No source)\n\n## Risks\nNot discussed\n\n## Actions\n- **Rahul** runs the load test [2:00](seg:m:3)",
    );
    expect(pieces).toEqual([
      { ref: "sum-1", startMs: null, text: "Decisions\n- Ship on Thursday\n- Keep the old flow" },
      { ref: "sum-1", startMs: null, text: "Actions\n- Rahul runs the load test" },
    ]);
  });

  it("packs notes by paragraph and writes a task as one line", () => {
    expect(notesPieces("First point.\n\nSecond point.\n\n\n")).toEqual([
      { ref: null, startMs: null, text: "First point.\n\nSecond point." },
    ]);
    expect(notesPieces("   ")).toEqual([]);
    expect(
      taskPiece({
        id: "t1",
        title: "Send the budget",
        owner: null,
        ownerIsMe: true,
        dueOn: "2026-11-27",
      }),
    ).toEqual({
      ref: "t1",
      startMs: null,
      text: "Send the budget, owner: me, due 2026-11-27",
    });
  });
});

describe("index and search (NT-14)", () => {
  it("finds the segment that holds the answer, with its meeting and time", () => {
    const t = setup();
    t.meeting("m-1", "Launch review", 1_000);
    t.say("m-1", 5_000, "The Frankfurt server capacity is the main risk before launch.");
    t.say("m-1", 65_000, "We ship on Thursday if the load test passes.");
    t.meeting("m-2", "Budget call", 2_000);
    t.say("m-2", 3_000, "The budget for travel is already approved.");
    expect(t.index.sync()).toBe(2);
    const hits = t.index.search("when do we ship the launch?", {}, 5);
    expect(hits[0]).toMatchObject({
      meetingId: "m-1",
      meetingTitle: "Launch review",
      source: "transcript",
      startMs: 5_000,
    });
    expect(hits.every((hit) => hit.text.length > 0)).toBe(true);
    const budget = t.index.search("travel budget", {}, 5);
    expect(budget[0]).toMatchObject({ meetingId: "m-2" });
  });

  it("leaves other meetings out of a scope", () => {
    const t = setup();
    t.meeting("m-1", "One", 1_000);
    t.meeting("m-2", "Two", 2_000);
    t.say("m-1", 0, "The roadmap review is on Friday.");
    t.say("m-2", 0, "The roadmap review moved to Monday.");
    t.index.sync();
    const ids = (filter: Parameters<typeof t.index.search>[1]) =>
      t.index
        .search("roadmap review", filter, 10)
        .map((hit) => hit.meetingId)
        .sort();
    expect(ids({})).toEqual(["m-1", "m-2"]);
    expect(ids({ meetingIds: ["m-2"] })).toEqual(["m-2"]);
    expect(ids({ meetingIds: [] })).toEqual([]);
    expect(ids({ from: 1_500 })).toEqual(["m-2"]);
    expect(ids({ to: 1_500 })).toEqual(["m-1"]);
    expect(ids({ from: 1_500, to: 1_800 })).toEqual([]);
  });

  it("indexes summaries, notes and tasks with their source, and can leave notes out", () => {
    const t = setup();
    t.meeting("m-1", "Planning", 1_000);
    t.say("m-1", 0, "We talked about hiring.");
    t.summaries.add({
      id: "sum-1",
      meetingId: "m-1",
      skill: { id: "meeting-summary", name: "Meeting summary" },
      modelId: "x",
      quick: false,
      markdown: "## Decisions\n- Hire a designer in March [0:01](seg:m-1:s1)",
      at: 5,
    });
    t.notes("m-1", "Remember to ask about the designer budget.");
    t.tasks.addSuggested("m-1", [
      {
        title: "Post the designer job",
        owner: "Priya",
        ownerIsMe: false,
        dueOn: null,
        sourceSegmentId: null,
      },
    ]);
    t.index.sync();
    const sources = (filter = {}) =>
      t.index
        .search("designer", filter, 10)
        .map((hit) => hit.source)
        .sort();
    expect(sources()).toEqual(["notes", "summary", "task"]);
    expect(sources({ sources: ["transcript", "summary", "task"] })).toEqual(["summary", "task"]);
    expect(
      t.index.search("designer", {}, 10).find((hit) => hit.source === "summary"),
    ).toMatchObject({ ref: "sum-1" });
    expect(t.index.search("designer", {}, 10).find((hit) => hit.source === "task")?.text).toContain(
      "owner: Priya",
    );
  });

  it("leaves out dictated lines, quick summaries and archived tasks", () => {
    const t = setup();
    t.meeting("m-1", "One", 1_000);
    t.say("m-1", 0, "Secret dictated words about zebras.", { dictated: true });
    t.say("m-1", 1_000, "Plain talk about weather.");
    t.summaries.add({
      id: "q",
      meetingId: "m-1",
      skill: { id: "meeting-summary", name: "x" },
      modelId: "x",
      quick: true,
      markdown: "## Overview\n- Quick words about giraffes",
      at: 5,
    });
    t.tasks.addSuggested("m-1", [
      {
        title: "Feed the llamas",
        owner: null,
        ownerIsMe: false,
        dueOn: null,
        sourceSegmentId: null,
      },
    ]);
    t.tasks.act(t.tasks.list().tasks[0]!.id, "archive");
    t.index.sync();
    for (const word of ["zebras", "giraffes", "llamas"])
      expect(t.index.search(word, {}, 5)).toEqual([]);
    expect(t.index.search("weather", {}, 5)).toHaveLength(1);
  });

  it("indexes again only a meeting that changed", () => {
    const t = setup();
    t.meeting("m-1", "One", 1_000);
    t.meeting("m-2", "Two", 2_000);
    t.say("m-1", 0, "alpha topic");
    t.say("m-2", 0, "beta topic");
    expect(t.index.sync()).toBe(2);
    expect(t.index.sync()).toBe(0);
    t.say("m-1", 5_000, "gamma topic");
    expect(t.index.sync()).toBe(1);
    expect(t.index.search("gamma", {}, 5)).toHaveLength(1);
    t.notes("m-2", "delta note");
    expect(t.index.sync()).toBe(1);
    t.notes("m-2", "delta note edited", 2);
    expect(t.index.sync()).toBe(1);
    expect(t.index.search("edited", {}, 5)).toHaveLength(1);
    expect(t.index.search("delta", {}, 5)).toHaveLength(1);
    // Only the meetings in the filter are looked at.
    t.say("m-1", 9_000, "epsilon topic");
    expect(t.index.sync({ meetingIds: ["m-2"] })).toBe(0);
    expect(t.index.sync({ meetingIds: ["m-1"] })).toBe(1);
  });

  it("forgets a meeting that is deleted", () => {
    const t = setup();
    t.meeting("m-1", "One", 1_000);
    t.say("m-1", 0, "unique pineapple talk");
    t.index.sync();
    expect(t.index.search("pineapple", {}, 5)).toHaveLength(1);
    t.meetings.remove("m-1");
    expect(t.index.search("pineapple", {}, 5)).toEqual([]);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM ask_chunks").get()).toEqual({ n: 0 });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM ask_index").get()).toEqual({ n: 0 });
  });

  it("ranks the better match first and honours the limit", () => {
    const t = setup();
    t.meeting("m-1", "One", 1_000);
    t.say("m-1", 0, "Pricing was mentioned once.");
    t.say(
      "m-1",
      60_000,
      "Pricing, pricing tiers and the pricing page: pricing is the whole topic here.",
    );
    t.index.sync();
    const hits = t.index.search("pricing tiers", {}, 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toContain("pricing tiers");
  });
});
