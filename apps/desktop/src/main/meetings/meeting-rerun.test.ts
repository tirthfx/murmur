import { describe, expect, it, vi } from "vitest";
import type { Transcript } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createCorrectionsStore } from "./corrections-store";
import { createMeetingJobs } from "./meeting-jobs";
import { createMeetingRerun } from "./meeting-rerun";
import { createMeetingsStore } from "./meetings-store";
import { createSpeakersStore } from "./speakers-store";
import { createTasksService } from "./tasks-service";
import { createTranscriptStore } from "./transcript-store";
import { createTranscriptVersions } from "./transcript-versions";

const DAY = 24 * 60 * 60 * 1000;

function setup(options: { present?: boolean } = {}) {
  const db = openDatabase(":memory:");
  const meetings = createMeetingsStore(db);
  const transcripts = createTranscriptStore(db);
  const versions = createTranscriptVersions(db);
  let clock = 1_000_000;
  const speakers = createSpeakersStore(db, { now: () => clock });
  const corrections = createCorrectionsStore(db, { now: () => clock, speakers });
  const tasks = createTasksService(db, { newId: () => `t${clock++}`, now: () => clock });
  const transcribe = vi.fn(
    async (_file: string, how: { languages: string[]; translate: boolean }): Promise<Transcript> =>
      ({
        text: "x",
        language: how.languages[0] ?? "en",
        segments: [
          {
            startMs: 0,
            endMs: 2_000,
            text: `heard in ${how.languages[0] ?? "auto"}`,
            confidence: 1,
          },
        ],
        decodeMs: 1,
        audioMs: 30_000,
      }) as Transcript,
  );
  const jobs = createMeetingJobs({
    db,
    meetings,
    transcripts,
    transcribe,
    speechReady: () => true,
    dictating: () => false,
    now: () => clock,
    wait: async () => undefined,
    onProgress: () => undefined,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
  });
  const changed: string[] = [];
  const rerun = createMeetingRerun({
    meetings,
    versions,
    jobs,
    keepDays: () => 30,
    audioPresent: () => options.present ?? true,
    now: () => clock,
    onChange: (id) => changed.push(id),
  });
  meetings.create({ id: "m-1", title: "Sync", startedAt: 1, source: "ad_hoc", folder: "/m/m-1" });
  for (const channel of ["mic", "system"] as const)
    meetings.addChunk({
      meetingId: "m-1",
      channel,
      seq: 1,
      path: `/m/m-1/${channel}-1.m4a`,
      sha256: "a".repeat(64),
      bytes: 10,
      startMs: 0,
      durationMs: 30_000,
    });
  meetings.setChannels("m-1", ["mic", "system"]);
  meetings.finish("m-1", 30_000, 30_000, "queued");
  jobs.enqueue("m-1", "transcribe");
  const transcribeNow = async () => {
    jobs.kick();
    await jobs.idle();
  };
  return {
    db,
    meetings,
    transcripts,
    versions,
    corrections,
    tasks,
    jobs,
    rerun,
    transcribe,
    transcribeNow,
    changed,
    tick: (ms: number) => (clock += ms),
    now: () => clock,
  };
}

const texts = (t: ReturnType<typeof setup>) => t.transcripts.segments("m-1").map((s) => s.text);

describe("rerun from saved audio (NT-23)", () => {
  it("transcribes again in another language and keeps the old transcript restorable", async () => {
    const t = setup();
    await t.transcribeNow();
    expect(texts(t)).toEqual(["heard in auto", "heard in auto"]);
    expect(t.meetings.get("m-1")).toMatchObject({
      language: null,
      transcriptVersion: 1,
      status: "ready",
    });

    expect(t.rerun.rerun("m-1", { language: "es", translate: false })).toEqual({ ok: true });
    // The old transcript is saved at once, the new one is queued, not written in place.
    expect(t.meetings.get("m-1")).toMatchObject({
      language: "es",
      translate: false,
      transcriptVersion: 2,
    });
    expect(["queued", "processing"]).toContain(t.meetings.get("m-1")?.status);
    expect(texts(t)).toEqual([]);
    expect(t.versions.list("m-1", t.now())).toMatchObject([
      { version: 1, language: null, lines: 2, translate: false },
    ]);
    expect(t.changed).toEqual(["m-1"]);

    await t.transcribeNow();
    expect(t.transcribe).toHaveBeenLastCalledWith(expect.any(String), {
      languages: ["es"],
      translate: false,
    });
    expect(texts(t)).toEqual(["heard in es", "heard in es"]);
    expect(t.meetings.get("m-1")).toMatchObject({ status: "ready" });
    // Lines of the new transcript carry its version in their ids.
    expect(t.transcripts.segments("m-1").every((s) => s.id.endsWith("~2"))).toBe(true);
    expect(t.versions.list("m-1", t.now())).toHaveLength(1);
  });

  it("puts the old transcript back, and saves the one it replaces", async () => {
    const t = setup();
    await t.transcribeNow();
    const oldIds = t.transcripts.segments("m-1").map((s) => s.id);
    t.rerun.rerun("m-1", { language: "es", translate: true });
    await t.transcribeNow();
    const [saved] = t.versions.list("m-1", t.now());
    expect(t.rerun.restore("m-1", saved!.id)).toEqual({ ok: true });
    expect(texts(t)).toEqual(["heard in auto", "heard in auto"]);
    expect(t.transcripts.segments("m-1").map((s) => s.id)).toEqual(oldIds);
    expect(t.meetings.get("m-1")).toMatchObject({
      language: null,
      translate: false,
      transcriptVersion: 1,
    });
    // The Spanish transcript is now the saved one, with its settings.
    const list = t.versions.list("m-1", t.now());
    expect(list).toMatchObject([{ version: 2, language: "es", translate: true, lines: 2 }]);
    // And it can be put back too.
    t.rerun.restore("m-1", list[0]!.id);
    expect(texts(t)).toEqual(["heard in es", "heard in es"]);
    expect(t.meetings.get("m-1")).toMatchObject({
      language: "es",
      translate: true,
      transcriptVersion: 2,
    });
  });

  it("saves the corrections with the transcript and gives them back", async () => {
    const t = setup();
    await t.transcribeNow();
    const first = t.transcripts.segments("m-1")[0]!;
    t.corrections.apply("m-1", { kind: "text", segmentId: first.id, text: "A corrected line." });
    t.rerun.rerun("m-1", { language: "fr", translate: false });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM transcript_corrections").get()).toEqual({
      n: 0,
    });
    await t.transcribeNow();
    t.rerun.restore("m-1", t.versions.list("m-1", t.now())[0]!.id);
    expect(t.transcripts.segments("m-1").find((s) => s.id === first.id)).toMatchObject({
      text: "A corrected line.",
      edited: true,
    });
    // The correction can still be taken back.
    expect(t.corrections.history("m-1", first.id)).toHaveLength(1);
    expect(t.corrections.revert("m-1", t.corrections.history("m-1", first.id)[0]!.id)).toEqual({
      ok: true,
    });
    expect(t.transcripts.segments("m-1").find((s) => s.id === first.id)?.text).toBe(
      "heard in auto",
    );
  });

  it("leaves tasks marked done as they are, and the owner's notes and dictated lines", async () => {
    const t = setup();
    await t.transcribeNow();
    t.tasks.addSuggested("m-1", [
      {
        title: "Send the budget",
        owner: null,
        ownerIsMe: true,
        dueOn: null,
        sourceSegmentId: null,
      },
    ]);
    const id = t.tasks.list().tasks[0]!.id;
    t.tasks.act(id, "accept");
    t.tasks.act(id, "done");
    t.db
      .prepare(
        "INSERT INTO meeting_notes (meeting_id, body_md, updated_at) VALUES ('m-1', 'My notes', 1)",
      )
      .run();
    t.db
      .prepare(
        `INSERT INTO meeting_segments (id, meeting_id, channel, start_ms, end_ms, text, is_dictated, is_final, created_at)
         VALUES ('dict', 'm-1', 'mic', 5000, 6000, 'Dictated', 1, 1, 1)`,
      )
      .run();
    t.rerun.rerun("m-1", { language: "es", translate: false });
    await t.transcribeNow();
    expect(t.tasks.get(id)).toMatchObject({ status: "done" });
    // The tasks are looked for again later; a title the meeting has is skipped.
    expect(
      t.tasks.addSuggested("m-1", [
        {
          title: "send the budget!",
          owner: null,
          ownerIsMe: true,
          dueOn: null,
          sourceSegmentId: null,
        },
      ]),
    ).toBe(0);
    expect(t.db.prepare("SELECT body_md FROM meeting_notes").get()).toEqual({
      body_md: "My notes",
    });
    expect(t.transcripts.segments("m-1").some((s) => s.id === "dict")).toBe(true);
  });

  it("makes the transcription that follows ask for a new summary, once", async () => {
    const t = setup();
    await t.transcribeNow();
    expect(t.meetings.consumeRerun("m-1")).toBe(false);
    t.rerun.rerun("m-1", { language: "es", translate: false });
    expect(t.meetings.consumeRerun("m-1")).toBe(true);
    expect(t.meetings.consumeRerun("m-1")).toBe(false);
  });
});

describe("what blocks a rerun", () => {
  it("is blocked, with the reason, when the audio was deleted", async () => {
    const t = setup();
    await t.transcribeNow();
    t.db.prepare("UPDATE meetings SET audio_deleted_at = 5 WHERE id = 'm-1'").run();
    expect(t.rerun.blocked("m-1")).toMatch(/audio of this meeting was deleted/);
    expect(t.rerun.rerun("m-1", { language: "es", translate: false })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/deleted/),
    });
    // Nothing was replaced.
    expect(texts(t)).toEqual(["heard in auto", "heard in auto"]);
    expect(t.versions.list("m-1", t.now())).toEqual([]);
    expect(t.meetings.get("m-1")?.transcriptVersion).toBe(1);
  });

  it("is blocked when audio files are missing, while recording or transcribing, with no audio, and for no meeting", async () => {
    const missing = setup({ present: false });
    await missing.transcribeNow();
    expect(missing.rerun.blocked("m-1")).toMatch(/files .* missing/);

    const busy = setup();
    expect(busy.rerun.blocked("m-1")).toMatch(/being transcribed/);
    busy.db.prepare("UPDATE meetings SET status = 'recording' WHERE id = 'm-1'").run();
    expect(busy.rerun.blocked("m-1")).toMatch(/still recording/);

    const none = setup();
    none.db.prepare("DELETE FROM meeting_audio_chunks").run();
    none.db.prepare("UPDATE meetings SET status = 'ready' WHERE id = 'm-1'").run();
    expect(none.rerun.blocked("m-1")).toMatch(/no audio/);
    expect(none.rerun.blocked("nope")).toMatch(/gone/);
    expect(none.rerun.rerun("nope", { language: null, translate: false })).toMatchObject({
      ok: false,
    });
  });

  it("allows a rerun of a meeting whose transcription failed", async () => {
    const t = setup();
    await t.transcribeNow();
    t.db.prepare("UPDATE meetings SET status = 'failed' WHERE id = 'm-1'").run();
    expect(t.rerun.blocked("m-1")).toBeNull();
  });
});

describe("how long a version is kept", () => {
  it("deletes a version after the days it is kept, and refuses to restore it", async () => {
    const t = setup();
    await t.transcribeNow();
    t.rerun.rerun("m-1", { language: "es", translate: false });
    await t.transcribeNow();
    const [saved] = t.versions.list("m-1", t.now());
    expect(saved!.expiresAt - saved!.replacedAt).toBe(30 * DAY);
    t.tick(30 * DAY + 1);
    expect(t.rerun.restore("m-1", saved!.id)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/kept for a limited time/),
    });
    expect(t.versions.list("m-1", t.now())).toEqual([]);
    expect(t.versions.purge(t.now())).toBe(0);
  });

  it("purges every meeting's expired versions at once", async () => {
    const t = setup();
    await t.transcribeNow();
    t.rerun.rerun("m-1", { language: "es", translate: false });
    t.tick(31 * DAY);
    expect(t.versions.purge(t.now())).toBe(1);
  });

  it("forgets the versions with the meeting", async () => {
    const t = setup();
    await t.transcribeNow();
    t.rerun.rerun("m-1", { language: "es", translate: false });
    t.meetings.remove("m-1");
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM transcript_versions").get()).toEqual({ n: 0 });
  });

  it("saves nothing when there was no transcript to replace", async () => {
    const t = setup();
    t.db.prepare("UPDATE meetings SET status = 'ready' WHERE id = 'm-1'").run();
    t.rerun.rerun("m-1", { language: "es", translate: false });
    expect(t.versions.list("m-1", t.now())).toEqual([]);
  });
});

describe("language while recording", () => {
  it("changes how the rest of a recording is transcribed, not a finished meeting", () => {
    const t = setup();
    t.db.prepare("UPDATE meetings SET status = 'recording' WHERE id = 'm-1'").run();
    expect(t.rerun.setLanguage("m-1", { language: "de", translate: true })).toEqual({ ok: true });
    expect(t.meetings.get("m-1")).toMatchObject({ language: "de", translate: true });
    t.db.prepare("UPDATE meetings SET status = 'ready' WHERE id = 'm-1'").run();
    expect(t.rerun.setLanguage("m-1", { language: "fr", translate: false })).toMatchObject({
      ok: false,
    });
    expect(t.meetings.get("m-1")?.language).toBe("de");
    expect(t.rerun.setLanguage("nope", { language: null, translate: false })).toMatchObject({
      ok: false,
    });
  });

  it("is used for a chunk written after the change", async () => {
    const t = setup();
    t.db.prepare("UPDATE meetings SET status = 'recording' WHERE id = 'm-1'").run();
    t.meetings.setLanguage("m-1", "it", false);
    await t.transcribeNow();
    expect(t.transcribe).toHaveBeenCalledWith(expect.any(String), {
      languages: ["it"],
      translate: false,
    });
  });
});

describe("meetings start with the default language", () => {
  it("keeps a meeting's own language and translate setting", () => {
    const t = setup();
    t.meetings.create({
      id: "m-2",
      title: "Two",
      startedAt: 2,
      source: "ad_hoc",
      folder: "/m/m-2",
      language: "es",
      translate: true,
    });
    expect(t.meetings.get("m-2")).toMatchObject({
      language: "es",
      translate: true,
      transcriptVersion: 1,
    });
    expect(t.meetings.get("m-1")).toMatchObject({ language: null, translate: false });
  });

  it("finds the language most lines were heard in", async () => {
    const t = setup();
    await t.transcribeNow();
    expect(t.transcripts.detectedLanguage("m-1")).toBe("en");
    t.db.prepare("UPDATE meeting_segments SET language = 'es' WHERE channel = 'mic'").run();
    t.db.prepare("UPDATE meeting_segments SET language = 'es' WHERE channel = 'system'").run();
    expect(t.transcripts.detectedLanguage("m-1")).toBe("es");
    expect(t.transcripts.detectedLanguage("nope")).toBeNull();
  });
});
