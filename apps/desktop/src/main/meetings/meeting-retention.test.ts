import { describe, expect, it, vi } from "vitest";
import type { AudioRetention, TranscriptRetention } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createFoldersStore } from "./folders-store";
import { createMeetingRetention, DELETE_BATCH } from "./meeting-retention";
import { createMeetingsStore } from "./meetings-store";
import { createSummariesStore } from "./summaries-store";
import { createTranscriptStore } from "./transcript-store";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 400 * DAY;

function setup(
  settings: {
    audio?: AudioRetention;
    transcript?: TranscriptRetention;
    removeSummaryWithTranscript?: boolean;
    summaryAuto?: boolean;
  } = {},
) {
  const db = openDatabase(":memory:");
  const meetings = createMeetingsStore(db);
  const transcripts = createTranscriptStore(db);
  const summaries = createSummariesStore(db);
  let n = 0;
  const folders = createFoldersStore(db, { now: () => NOW, newId: () => `f${++n}` });
  const removed: string[] = [];
  const state = {
    audio: "30d" as AudioRetention,
    transcript: "forever" as TranscriptRetention,
    removeSummaryWithTranscript: false,
    summaryAuto: true,
    ...settings,
  };
  const retention = createMeetingRetention(db, {
    settings: () => state,
    removeFile: (path) => void removed.push(path),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
  });
  /** A meeting that ended `daysAgo` days before NOW, with two audio chunks and `lines` lines. */
  const meeting = (
    id: string,
    daysAgo: number,
    over: { status?: string; folderId?: string | null; lines?: number } = {},
  ) => {
    const endedAt = NOW - daysAgo * DAY;
    meetings.create({
      id,
      title: id,
      startedAt: endedAt - 60_000,
      source: "ad_hoc",
      folder: `/m/${id}`,
      folderId: over.folderId ?? null,
    });
    for (const channel of ["mic", "system"] as const)
      meetings.addChunk({
        meetingId: id,
        channel,
        seq: 1,
        path: `/m/${id}/${channel}-1.m4a`,
        sha256: "a".repeat(64),
        bytes: 1,
        startMs: 0,
        durationMs: 30_000,
      });
    meetings.finish(id, endedAt, 60_000, (over.status ?? "ready") as never);
    const insert = db.prepare(
      `INSERT INTO meeting_segments (id, meeting_id, channel, start_ms, end_ms, text, is_dictated, is_final, created_at)
       VALUES (?, ?, 'mic', ?, ?, 'words', 0, 1, 1)`,
    );
    for (let i = 0; i < (over.lines ?? 3); i++)
      insert.run(`${id}:${i}`, id, i * 1000, i * 1000 + 500);
  };
  const summarise = (id: string, quick = false) =>
    summaries.add({
      id: `s-${id}-${quick}`,
      meetingId: id,
      skill: { id: "meeting-summary", name: "x" },
      modelId: "m",
      quick,
      markdown: "## A\n- b",
      at: 1,
    });
  const count = (table: string, id: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE meeting_id = ?`).get(id) as { n: number })
      .n;
  return {
    db,
    meetings,
    transcripts,
    summaries,
    folders,
    retention,
    removed,
    state,
    meeting,
    summarise,
    count,
  };
}

describe("audio retention (NT-22)", () => {
  it("removes the audio of an old meeting and marks it", () => {
    const t = setup();
    t.meeting("old", 40);
    t.meeting("new", 5);
    expect(t.retention.runAudio(NOW)).toBe(1);
    expect(t.removed.sort()).toEqual(["/m/old/mic-1.m4a", "/m/old/system-1.m4a"]);
    expect(t.meetings.get("old")?.audioDeletedAt).toBe(NOW);
    expect(t.meetings.get("new")?.audioDeletedAt).toBeNull();
    // The meeting, its transcript and its summary are all still there.
    expect(t.meetings.get("old")).toMatchObject({ title: "old", status: "ready" });
    expect(t.count("meeting_segments", "old")).toBe(3);
    // Nothing is deleted twice.
    expect(t.retention.runAudio(NOW + DAY)).toBe(0);
  });

  it.each([
    ["forever", 1000, false],
    ["7d", 6, false],
    ["7d", 7, true],
    ["30d", 29, false],
    ["30d", 31, true],
  ] as const)(
    "with %s, a meeting that ended %s days ago is deleted: %s",
    (period, days, expected) => {
      const t = setup({ audio: period });
      t.meeting("m", days);
      expect(t.retention.runAudio(NOW)).toBe(expected ? 1 : 0);
    },
  );

  it("skips meetings that are recording, waiting or being transcribed", () => {
    const t = setup({ audio: "7d" });
    t.meeting("rec", 100, { status: "recording" });
    t.meeting("queued", 100, { status: "queued" });
    t.meeting("busy", 100, { status: "processing" });
    t.meeting("failed", 100, { status: "failed" });
    expect(t.retention.runAudio(NOW)).toBe(1);
    expect(t.meetings.get("rec")?.audioDeletedAt).toBeNull();
    expect(t.meetings.get("queued")?.audioDeletedAt).toBeNull();
    expect(t.meetings.get("busy")?.audioDeletedAt).toBeNull();
    expect(t.removed.every((path) => path.startsWith("/m/failed/"))).toBe(true);
  });

  it("goes on when a file cannot be removed", () => {
    const t = setup({ audio: "7d" });
    const warn = vi.fn();
    const retention = createMeetingRetention(t.db, {
      settings: () => ({
        audio: "7d",
        transcript: "forever",
        removeSummaryWithTranscript: false,
        summaryAuto: true,
      }),
      removeFile: () => {
        throw new Error("busy");
      },
      logger: { info: vi.fn(), warn, error: vi.fn() } as never,
    });
    t.meeting("old", 40);
    expect(retention.runAudio(NOW)).toBe(1);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(t.meetings.get("old")?.audioDeletedAt).toBe(NOW);
  });
});

describe("delete after processing", () => {
  it("removes the audio once the final summary is written, and not before", () => {
    const t = setup({ audio: "processing" });
    t.meeting("m", 0);
    expect(t.retention.afterProcessing("m", NOW)).toBe(false);
    expect(t.retention.runAudio(NOW)).toBe(0);
    t.summarise("m", true); // a quick summary is not the final one
    expect(t.retention.afterProcessing("m", NOW)).toBe(false);
    t.summarise("m");
    expect(t.retention.afterProcessing("m", NOW)).toBe(true);
    expect(t.meetings.get("m")?.audioDeletedAt).toBe(NOW);
    expect(t.removed).toHaveLength(2);
    expect(t.retention.afterProcessing("m", NOW)).toBe(false);
  });

  it("is also done by the daily job for a meeting whose summary was written while it was off", () => {
    const t = setup({ audio: "processing" });
    t.meeting("m", 0);
    t.summarise("m");
    expect(t.retention.runAudio(NOW)).toBe(1);
  });

  it("with no automatic summary, the audio goes when nothing is left to write", () => {
    const t = setup({ audio: "processing", summaryAuto: false });
    t.meeting("m", 0);
    expect(t.retention.afterProcessing("m", NOW)).toBe(true);
    const waiting = setup({ audio: "processing", summaryAuto: false });
    waiting.meeting("w", 0);
    waiting.db
      .prepare(
        "INSERT INTO meeting_jobs (meeting_id, kind, status, created_at, updated_at) VALUES ('w', 'summarise', 'queued', 1, 1)",
      )
      .run();
    expect(waiting.retention.afterProcessing("w", NOW)).toBe(false);
  });

  it("does nothing for a meeting whose period is another", () => {
    const t = setup({ audio: "30d" });
    t.meeting("m", 0);
    t.summarise("m");
    expect(t.retention.afterProcessing("m", NOW)).toBe(false);
    expect(t.retention.afterProcessing("nope", NOW)).toBe(false);
  });
});

describe("transcript retention (NT-22)", () => {
  it("deletes an old transcript and what hangs on it, and keeps the meeting with a marker", () => {
    const t = setup({ transcript: "90d" });
    t.meeting("old", 100);
    t.meeting("new", 10);
    t.db
      .prepare(
        "INSERT INTO transcript_corrections (meeting_id, kind, before_json, after_ids_json, created_at) VALUES ('old', 'text', '[]', '[]', 1)",
      )
      .run();
    t.db
      .prepare(
        "INSERT INTO transcript_versions (meeting_id, version, translate, segments_json, corrections_json, line_count, created_at, expires_at) VALUES ('old', 1, 0, '[]', '[]', 0, 1, 2)",
      )
      .run();
    t.summarise("old");
    expect(t.retention.runTranscripts(NOW)).toBe(1);
    expect(t.count("meeting_segments", "old")).toBe(0);
    expect(t.count("transcript_corrections", "old")).toBe(0);
    expect(t.count("transcript_versions", "old")).toBe(0);
    expect(t.count("meeting_segments", "new")).toBe(3);
    // The row keeps its title, date and folder, and says when.
    expect(t.meetings.get("old")).toMatchObject({
      title: "old",
      transcriptDeletedAt: NOW,
      folderId: null,
    });
    // Summaries stay unless asked.
    expect(t.count("meeting_summaries", "old")).toBe(1);
    expect(t.retention.runTranscripts(NOW + DAY)).toBe(0);
  });

  it("removes the summaries with the transcript when that is chosen", () => {
    const t = setup({ transcript: "30d", removeSummaryWithTranscript: true });
    t.meeting("old", 40);
    t.summarise("old");
    t.retention.runTranscripts(NOW);
    expect(t.count("meeting_summaries", "old")).toBe(0);
  });

  it("deletes the lines in batches of 500", () => {
    const t = setup({ transcript: "30d" });
    t.meeting("big", 40, { lines: 1_250 });
    const exec = vi.spyOn(t.db, "exec");
    t.retention.runTranscripts(NOW);
    expect(t.count("meeting_segments", "big")).toBe(0);
    // Three transactions of lines (500, 500, 250) and one for the rest.
    expect(exec.mock.calls.filter(([sql]) => sql === "BEGIN IMMEDIATE")).toHaveLength(4);
    expect(DELETE_BATCH).toBe(500);
  });

  it("never touches a meeting that is recording, and keeps forever by default", () => {
    const t = setup({ transcript: "30d" });
    t.meeting("rec", 400, { status: "recording" });
    expect(t.retention.runTranscripts(NOW)).toBe(0);
    const keep = setup();
    keep.meeting("old", 400);
    expect(keep.retention.runTranscripts(NOW)).toBe(0);
  });

  it("is found by Ask no more once the index is built again", async () => {
    const t = setup({ transcript: "30d" });
    t.meeting("old", 40);
    expect(t.transcripts.segments("old")).toHaveLength(3);
    t.retention.runTranscripts(NOW);
    expect(t.transcripts.segments("old")).toEqual([]);
  });
});

describe("folder overrides", () => {
  it("uses a folder's own periods, and the Settings ones for the Inbox", () => {
    const t = setup({ audio: "30d", transcript: "forever" });
    const made = t.folders.create("Sensitive");
    if (!made.ok) throw new Error("no folder");
    t.folders.setRetention(made.id, { audio: "7d", transcript: "30d" });
    t.meeting("in-folder", 10, { folderId: made.id });
    t.meeting("inbox", 10);
    expect(t.retention.runAudio(NOW)).toBe(1);
    expect(t.meetings.get("in-folder")?.audioDeletedAt).toBe(NOW);
    expect(t.meetings.get("inbox")?.audioDeletedAt).toBeNull();
    t.meeting("late", 40, { folderId: made.id });
    // 30 days for the folder: the one 40 days old goes, the one 10 days old stays.
    expect(t.retention.runTranscripts(NOW)).toBe(1);
    expect(t.count("meeting_segments", "late")).toBe(0);
    expect(t.count("meeting_segments", "in-folder")).toBe(3);
    expect(t.count("meeting_segments", "inbox")).toBe(3);
  });

  it("lets a folder keep what Settings would delete", () => {
    const t = setup({ audio: "7d", transcript: "30d" });
    const made = t.folders.create("Keep");
    if (!made.ok) throw new Error("no folder");
    t.folders.setRetention(made.id, { audio: "forever", transcript: "forever" });
    t.meeting("kept", 200, { folderId: made.id });
    expect(t.retention.runAudio(NOW)).toBe(0);
    expect(t.retention.runTranscripts(NOW)).toBe(0);
    // Back to Settings with null.
    t.folders.setRetention(made.id, { audio: null, transcript: null });
    expect(t.retention.runAudio(NOW)).toBe(1);
  });
});

describe("what is due in the next 24 hours", () => {
  it("counts the meetings a run tomorrow would delete, not those already deleted", () => {
    const t = setup({ audio: "30d", transcript: "90d" });
    t.meeting("past", 45); // due now (audio)
    t.meeting("soon", 29.5); // due within a day (audio)
    t.meeting("later", 10);
    t.meeting("old", 100); // audio and transcript
    expect(t.retention.due(NOW)).toEqual({ audio: 3, transcripts: 1 });
    t.retention.runAudio(NOW);
    expect(t.retention.due(NOW)).toEqual({ audio: 1, transcripts: 1 });
    t.retention.runTranscripts(NOW);
    expect(t.retention.due(NOW)).toEqual({ audio: 1, transcripts: 0 });
  });
});
