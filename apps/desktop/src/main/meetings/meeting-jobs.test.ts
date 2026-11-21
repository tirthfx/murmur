import { describe, expect, it, vi } from "vitest";
import type { Transcript } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createTestLogger } from "../helper/fakes";
import { createMeetingJobs, MAX_ATTEMPTS } from "./meeting-jobs";
import { createMeetingsStore } from "./meetings-store";
import { createTranscriptStore } from "./transcript-store";

function transcript(text: string, startMs = 1000, endMs = 3000): Transcript {
  return {
    text,
    language: "en",
    segments: [{ startMs, endMs, text, confidence: 0.9 }],
    decodeMs: 10,
    audioMs: 30_000,
  } as Transcript;
}

function setup() {
  const db = openDatabase(":memory:");
  const meetings = createMeetingsStore(db);
  const transcripts = createTranscriptStore(db);
  const state = { ready: true, dictating: false };
  const transcribe = vi.fn(async (file: string) => transcript(`text of ${file.split("/").pop()}`));
  const progress: string[] = [];
  const jobs = createMeetingJobs({
    db,
    meetings,
    transcripts,
    transcribe,
    speechReady: () => state.ready,
    dictating: () => state.dictating,
    now: () => 5_000,
    wait: async () => {
      state.dictating = false;
    },
    onProgress: (id) => progress.push(id),
    logger: createTestLogger(),
  });
  const meeting = (id: string, chunks: number) => {
    meetings.create({ id, title: id, startedAt: 0, source: "ad_hoc", folder: `/m/${id}` });
    for (let seq = 1; seq <= chunks; seq++) {
      for (const channel of ["mic", "system"] as const) {
        meetings.addChunk({
          meetingId: id,
          channel,
          seq,
          path: `/m/${id}/${channel}-${seq}.m4a`,
          sha256: "a".repeat(64),
          bytes: 10,
          startMs: (seq - 1) * 30_000,
          durationMs: 30_000,
        });
      }
    }
    meetings.finish(id, 60_000, 60_000, "queued");
  };
  return { db, meetings, transcripts, jobs, transcribe, state, progress, meeting };
}

describe("meeting jobs", () => {
  it("transcribes each chunk in timeline order onto the meeting's timeline", async () => {
    const t = setup();
    t.meeting("a", 2);
    t.jobs.enqueue("a", "transcribe");
    t.jobs.kick();
    await t.jobs.idle();
    expect(t.transcribe.mock.calls.map((call) => call[0])).toEqual([
      "/m/a/mic-1.m4a",
      "/m/a/system-1.m4a",
      "/m/a/mic-2.m4a",
      "/m/a/system-2.m4a",
    ]);
    const segments = t.transcripts.segments("a");
    expect(segments.map((segment) => [segment.channel, segment.startMs, segment.text])).toEqual([
      ["mic", 1000, "text of mic-1.m4a"],
      ["system", 1000, "text of system-1.m4a"],
      ["mic", 31_000, "text of mic-2.m4a"],
      ["system", 31_000, "text of system-2.m4a"],
    ]);
    expect(segments.every((segment) => segment.isFinal && !segment.isDictated)).toBe(true);
    expect(t.meetings.get("a")!.status).toBe("ready");
    expect(t.transcripts.progress("a")).toEqual({ chunks: 4, done: 4 });
  });

  it("waits in the queue without a model, then runs with no action", async () => {
    const t = setup();
    t.meeting("a", 1);
    t.state.ready = false;
    t.jobs.enqueue("a", "transcribe");
    t.jobs.kick();
    await t.jobs.idle();
    expect(t.transcribe).not.toHaveBeenCalled();
    expect(t.meetings.get("a")!.status).toBe("queued");
    t.state.ready = true;
    t.jobs.kick();
    await t.jobs.idle();
    expect(t.meetings.get("a")!.status).toBe("ready");
  });

  it("pauses when the model goes away mid-job and carries on from the next chunk", async () => {
    const t = setup();
    t.meeting("a", 1);
    t.transcribe.mockResolvedValueOnce(transcript("first"));
    t.transcribe.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "MODEL_NOT_READY" }));
    t.jobs.enqueue("a", "transcribe");
    t.jobs.kick();
    await t.jobs.idle();
    expect(t.meetings.get("a")!.status).toBe("queued");
    expect(t.transcripts.progress("a")).toEqual({ chunks: 2, done: 1 });
    t.jobs.kick();
    await t.jobs.idle();
    expect(t.transcribe).toHaveBeenCalledTimes(3);
    expect(t.transcribe.mock.calls[2]![0]).toBe("/m/a/system-1.m4a");
    expect(t.meetings.get("a")!.status).toBe("ready");
  });

  it("lets a dictation go first", async () => {
    const t = setup();
    t.meeting("a", 1);
    t.state.dictating = true;
    t.jobs.enqueue("a", "transcribe");
    t.jobs.kick();
    await t.jobs.idle();
    // `wait` ended the dictation; then the chunks ran.
    expect(t.transcribe).toHaveBeenCalledTimes(2);
  });

  it("gives up after repeated failures and marks the meeting failed", async () => {
    const t = setup();
    t.meeting("a", 1);
    t.transcribe.mockRejectedValue(new Error("decoder broke"));
    t.jobs.enqueue("a", "transcribe");
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      t.jobs.kick();
      await t.jobs.idle();
    }
    expect(t.meetings.get("a")!.status).toBe("failed");
    const row = t.db.prepare("SELECT status, last_error FROM meeting_jobs").get();
    expect(row).toEqual({ status: "failed", last_error: "decoder broke" });
  });

  it("drops sound labels and empty text, and never writes a chunk twice", () => {
    const t = setup();
    t.meeting("a", 1);
    const chunk = t.transcripts.pendingChunks("a")[0]!;
    const segments = [
      { channel: "mic" as const, startMs: 0, endMs: 1, text: "[Music]", language: "en" },
      { channel: "mic" as const, startMs: 1, endMs: 2, text: "  ", language: "en" },
      { channel: "mic" as const, startMs: 2, endMs: 3, text: "Hello.", language: "en" },
    ];
    expect(t.transcripts.addChunkSegments(chunk, segments, 1)).toBe(1);
    expect(t.transcripts.addChunkSegments(chunk, segments, 1)).toBe(0);
    expect(t.transcripts.segments("a").map((segment) => segment.text)).toEqual(["Hello."]);
  });

  it("picks up after a crash: running jobs and meetings left without one", async () => {
    const t = setup();
    t.meeting("a", 1);
    t.meeting("b", 1);
    t.jobs.enqueue("a", "transcribe");
    t.db.prepare("UPDATE meeting_jobs SET status = 'running'").run();
    t.meetings.setStatus("a", "processing");
    expect(t.jobs.resume()).toBe(2);
    expect(t.meetings.get("a")!.status).toBe("queued");
    t.jobs.kick();
    await t.jobs.idle();
    expect(t.meetings.get("a")!.status).toBe("ready");
    expect(t.meetings.get("b")!.status).toBe("ready");
  });
});
