import { describe, expect, it } from "vitest";
import { openDatabase } from "../../db/database";
import { createMeetingsStore } from "../meetings-store";
import { createSpeakersStore } from "../speakers-store";
import { createTranscriptStore } from "../transcript-store";
import { IMPORT_FORMAT_TEXT, type ParsedTranscript } from "./formats";
import { MAX_IMPORT_BYTES, createTranscriptImport, titleFromFileName } from "./transcript-import";

const ZOOM_VTT = `WEBVTT

1
00:00:05.690 --> 00:00:09.570
Dana Lee: Okay, let's start. The goal today is the launch date.

2
00:00:10.100 --> 00:00:14.200
Sam Ortiz: QA found three bugs last week.

3
00:01:02.000 --> 00:01:05.500
Dana Lee: Thursday the 27th works.

4
00:01:10.000 --> 00:01:12.000
Priya Rao (room): Agreed.
`;
const bytes = (text: string) => new TextEncoder().encode(text);

function setup(over: { owner?: string; folder?: string | null } = {}) {
  const db = openDatabase(":memory:");
  const meetings = createMeetingsStore(db);
  const transcripts = createTranscriptStore(db);
  let n = 0;
  const speakers = createSpeakersStore(db, { now: () => 1 });
  const importer = createTranscriptImport(db, {
    speakers,
    newId: () => `id-${++n}`,
    now: () => 1_000_000,
    meetingsRoot: "/profile/meetings",
    ownerName: () => over.owner ?? "",
    folderId: () => over.folder ?? null,
  });
  const file = (name: string, text: string, modifiedAt = Date.UTC(2026, 10, 22)) => ({
    name,
    bytes: bytes(text),
    modifiedAt,
  });
  const preview = (name: string, text: string, modifiedAt?: number) => {
    const result = importer.prepare(file(name, text, modifiedAt));
    if (!result.ok) throw new Error(result.message);
    return result.preview;
  };
  return { db, meetings, transcripts, speakers, importer, file, preview };
}

describe("importing a transcript (NT-21)", () => {
  it("shows what is in a Zoom transcript before anything is made", () => {
    const t = setup();
    const preview = t.preview("GMT20261121-100000_Recording.transcript.vtt", ZOOM_VTT);
    expect(preview).toMatchObject({
      format: "vtt",
      formatName: IMPORT_FORMAT_TEXT.vtt,
      title: "Recording transcript",
      startedAt: Date.UTC(2026, 10, 21, 10, 0, 0),
      durationMs: 72_000,
      lines: 4,
      timesEstimated: false,
      duplicate: null,
    });
    expect(preview.speakers).toEqual(["Dana Lee", "Sam Ortiz", "Priya Rao (room)"]);
    // Nothing was created by looking.
    expect(t.meetings.list()).toEqual([]);
  });

  it("imports it with speakers and times, as a meeting with no audio", () => {
    const t = setup();
    const preview = t.preview("Roadmap.vtt", ZOOM_VTT, Date.UTC(2026, 10, 21, 10));
    const result = t.importer.confirm({
      token: preview.token,
      title: "Roadmap review",
      startedAt: preview.startedAt,
    });
    if (!result.ok) throw new Error(result.message);
    const meeting = t.meetings.get(result.meetingId)!;
    expect(meeting).toMatchObject({
      title: "Roadmap review",
      source: "imported",
      status: "ready",
      startedAt: Date.UTC(2026, 10, 21, 10),
      endedAt: Date.UTC(2026, 10, 21, 10) + 72_000,
      durationMs: 72_000,
      audioDeletedAt: null,
      folderId: null,
    });
    expect(t.meetings.chunks(result.meetingId)).toEqual([]);
    const lines = t.transcripts.segments(result.meetingId);
    expect(lines.map((s) => [s.startMs, s.endMs, s.text.slice(0, 12)])).toEqual([
      [5_690, 9_570, "Okay, let's "],
      [10_100, 14_200, "QA found thr"],
      [62_000, 65_500, "Thursday the"],
      [70_000, 72_000, "Agreed."],
    ]);
    // Every line has a speaker, and the names come from the file.
    const names = new Map(t.speakers.list(result.meetingId).map((s) => [s.id, s.name]));
    expect(lines.map((s) => names.get(s.speakerId!))).toEqual([
      "Dana Lee",
      "Sam Ortiz",
      "Dana Lee",
      "Priya Rao (room)",
    ]);
    expect(t.speakers.list(result.meetingId).map((s) => [s.name, s.segments])).toEqual([
      ["Remote", 0],
      ["Dana Lee", 2],
      ["Sam Ortiz", 1],
      ["Priya Rao (room)", 1],
    ]);
    // The meeting knows where its own files would be.
    expect(t.db.prepare("SELECT folder FROM meetings WHERE id = ?").get(result.meetingId)).toEqual({
      folder: `/profile/meetings/${result.meetingId}`,
    });
  });

  it("puts the owner's lines on the microphone, under the owner's name", () => {
    const t = setup({ owner: "Dana Lee" });
    const preview = t.preview("a.vtt", ZOOM_VTT);
    const result = t.importer.confirm({
      token: preview.token,
      title: "x",
      startedAt: preview.startedAt,
    });
    if (!result.ok) throw new Error(result.message);
    const lines = t.transcripts.segments(result.meetingId);
    expect(lines.map((s) => s.channel)).toEqual(["mic", "system", "mic", "system"]);
    const list = t.speakers.list(result.meetingId);
    expect(list.find((s) => s.channel === "mic")).toMatchObject({ name: "Dana Lee", segments: 2 });
    expect(list.map((s) => s.name)).toContain("Sam Ortiz");
    expect(t.meetings.get(result.meetingId)?.channels).toEqual(["mic", "system"]);
  });

  it("goes to the folder chosen for imports", () => {
    const t = setup({ folder: null });
    const folderId = t.db
      .prepare(
        "INSERT INTO folders (id, name, created_at, updated_at) VALUES ('f1', 'Calls', 1, 1)",
      )
      .run();
    expect(folderId.changes).toBe(1);
    const inFolder = setup();
    inFolder.db
      .prepare(
        "INSERT INTO folders (id, name, created_at, updated_at) VALUES ('f1', 'Calls', 1, 1)",
      )
      .run();
    const importer = createTranscriptImport(inFolder.db, {
      speakers: inFolder.speakers,
      newId: (() => {
        let n = 0;
        return () => `x-${++n}`;
      })(),
      now: () => 1,
      meetingsRoot: "/r",
      ownerName: () => "",
      folderId: () => "f1",
    });
    const prepared = importer.prepare(inFolder.file("a.vtt", ZOOM_VTT));
    if (!prepared.ok) throw new Error("no preview");
    const done = importer.confirm({ token: prepared.preview.token, title: "x", startedAt: 5 });
    if (!done.ok) throw new Error(done.message);
    expect(inFolder.meetings.get(done.meetingId)?.folderId).toBe("f1");
  });

  it("reports a duplicate when the same file is imported again, and creates no second meeting", () => {
    const t = setup();
    const first = t.preview("a.vtt", ZOOM_VTT);
    const done = t.importer.confirm({
      token: first.token,
      title: "Roadmap review",
      startedAt: first.startedAt,
    });
    if (!done.ok) throw new Error(done.message);
    const again = t.preview("renamed copy.vtt", ZOOM_VTT);
    expect(again.duplicate).toEqual({
      meetingId: done.meetingId,
      title: "Roadmap review",
      reason: "same-file",
    });
    const refused = t.importer.confirm({
      token: again.token,
      title: "Another title",
      startedAt: again.startedAt + 3_600_000,
    });
    expect(refused).toMatchObject({
      ok: false,
      message: expect.stringContaining("already imported as “Roadmap review”"),
    });
    expect(t.meetings.list()).toHaveLength(1);
  });

  it("reports a meeting with the same title that started within two minutes", () => {
    const t = setup();
    t.meetings.create({
      id: "mine",
      title: "Design sync",
      startedAt: new Date(2026, 10, 21, 10, 0).getTime(),
      source: "recorded",
      folder: "/m",
    });
    const text = "Dana: hello there\nSam: hi\n";
    const near = t.preview("Design sync 2026-11-21 10.01.txt", text);
    expect(near.duplicate).toEqual({
      meetingId: "mine",
      title: "Design sync",
      reason: "same-title",
    });
    const far = t.preview("Design sync 2026-11-22 10.00.txt", text);
    expect(far.duplicate).toBeNull();
    const other = t.preview("Budget 2026-11-21 10.00.txt", text);
    expect(other.duplicate).toBeNull();
  });

  it("can be told a different title and date, which are kept", () => {
    const t = setup();
    const preview = t.preview("a.txt", "Dana: hello\nSam: hi there\n", Date.UTC(2026, 0, 1));
    expect(preview.timesEstimated).toBe(true);
    const done = t.importer.confirm({
      token: preview.token,
      title: "Kickoff",
      startedAt: Date.UTC(2026, 5, 6, 9),
    });
    if (!done.ok) throw new Error(done.message);
    expect(t.meetings.get(done.meetingId)).toMatchObject({
      title: "Kickoff",
      startedAt: Date.UTC(2026, 5, 6, 9),
    });
  });

  it("makes nothing from a file that is not a transcript, and lists the formats", () => {
    const t = setup();
    for (const [name, text] of [
      ["notes.txt", "Just a paragraph of notes."],
      ["bad.vtt", "WEBVTT\n\nno cues"],
      ["bad.json", '{"nothing": true}'],
      ["empty.vtt", ""],
    ] as const) {
      const result = t.importer.prepare(t.file(name, text));
      expect(result).toMatchObject({ ok: false });
      if (!result.ok)
        for (const format of Object.values(IMPORT_FORMAT_TEXT))
          expect(result.message).toContain(format);
    }
    expect(
      t.importer.prepare({ name: "x.bin", bytes: new Uint8Array([0, 1, 2, 3]), modifiedAt: 1 }),
    ).toMatchObject({ ok: false });
    expect(
      t.importer.prepare({
        name: "huge.vtt",
        bytes: new Uint8Array(MAX_IMPORT_BYTES + 1),
        modifiedAt: 1,
      }),
    ).toMatchObject({ ok: false });
    expect(t.meetings.list()).toEqual([]);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meeting_segments").get()).toEqual({ n: 0 });
  });

  it("leaves no half-made meeting when writing fails", () => {
    const t = setup();
    const preview = t.preview("a.vtt", ZOOM_VTT);
    t.db.exec(
      "CREATE TRIGGER boom BEFORE INSERT ON meeting_segments WHEN new.text LIKE '%Agreed%' BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    const result = t.importer.confirm({
      token: preview.token,
      title: "x",
      startedAt: preview.startedAt,
    });
    expect(result).toMatchObject({ ok: false });
    expect(t.meetings.list()).toEqual([]);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meeting_segments").get()).toEqual({ n: 0 });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meeting_speakers").get()).toEqual({ n: 0 });
  });

  it("forgets a preview that was discarded, used or left too long", () => {
    let clock = 1_000_000;
    const t = setup();
    const importer = createTranscriptImport(t.db, {
      speakers: t.speakers,
      newId: (() => {
        let n = 0;
        return () => `y-${++n}`;
      })(),
      now: () => clock,
      meetingsRoot: "/r",
      ownerName: () => "",
      folderId: () => null,
    });
    const prepare = () => {
      const result = importer.prepare(t.file("a.vtt", ZOOM_VTT));
      if (!result.ok) throw new Error("no preview");
      return result.preview;
    };
    const first = prepare();
    importer.discard(first.token);
    expect(importer.confirm({ token: first.token, title: "x", startedAt: 1 })).toMatchObject({
      ok: false,
    });
    const second = prepare();
    expect(importer.confirm({ token: second.token, title: "x", startedAt: 1 })).toMatchObject({
      ok: true,
    });
    expect(importer.confirm({ token: second.token, title: "x", startedAt: 1 })).toMatchObject({
      ok: false,
    });
    const third = importer.prepare(t.file("b.vtt", ZOOM_VTT.replace("Okay", "Alright")));
    if (!third.ok) throw new Error("no preview");
    clock += 31 * 60_000;
    expect(
      importer.confirm({ token: third.preview.token, title: "x", startedAt: 1 }),
    ).toMatchObject({ ok: false });
  });

  it("makes a title from the file's name without its date and extension", () => {
    expect(titleFromFileName("GMT20261121-100000_Recording.transcript.vtt")).toBe(
      "Recording transcript",
    );
    expect(titleFromFileName("Design sync 2026-11-21 10.30.txt")).toBe("Design sync");
    expect(titleFromFileName("/Users/me/Downloads/Weekly_planning.srt")).toBe("Weekly planning");
    expect(titleFromFileName("2026-11-21.txt")).toBe("2026-11-21");
  });

  it("reads JSON with its own title and date", () => {
    const t = setup();
    const preview = t.preview(
      "export.json",
      JSON.stringify({
        title: "Board meeting",
        startedAt: "2026-03-05T14:00:00Z",
        segments: [{ start: 0, end: 3, speaker: "Kim", text: "Welcome." }],
      }),
    );
    expect(preview).toMatchObject({
      format: "json",
      title: "Board meeting",
      startedAt: Date.UTC(2026, 2, 5, 14),
    });
  });
});

describe("importing a meeting a connector fetched (CN-09, CN-10)", () => {
  const transcript = (over: Partial<ParsedTranscript> = {}): ParsedTranscript => ({
    format: "vtt",
    title: null,
    startedAt: null,
    timesEstimated: false,
    segments: [
      { startMs: 0, endMs: 3000, speaker: "Dana Lee", text: "Let's start." },
      { startMs: 4000, endMs: 6000, speaker: "Sam Ortiz", text: "Okay." },
    ],
    ...over,
  });
  const remote = (t: ReturnType<typeof setup>, over: Record<string, unknown> = {}) => {
    const result = t.importer.prepareRemote({
      name: "Zoom: Launch sync",
      transcript: transcript(),
      title: "Launch sync",
      startedAt: Date.UTC(2026, 10, 21, 10),
      externalRef: "zoom:abc==",
      ...over,
    });
    if (!result.ok) throw new Error(result.message);
    return result.preview;
  };

  it("describes it like a file, with no duplicate for a new recording", () => {
    const t = setup();
    expect(remote(t)).toMatchObject({
      fileName: "Zoom: Launch sync",
      title: "Launch sync",
      lines: 2,
      durationMs: 6000,
      speakers: ["Dana Lee", "Sam Ortiz"],
      duplicate: null,
    });
  });

  it("makes one meeting with the service's id, its speakers and lines, and no audio", () => {
    const t = setup();
    const preview = remote(t);
    const result = t.importer.confirm({
      token: preview.token,
      title: preview.title,
      startedAt: preview.startedAt,
    });
    expect(result.ok).toBe(true);
    const row = t.db.prepare("SELECT source, status, external_ref FROM meetings").get() as {
      source: string;
      status: string;
      external_ref: string;
    };
    expect(row).toEqual({ source: "imported", status: "ready", external_ref: "zoom:abc==" });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meeting_segments").get()).toEqual({ n: 2 });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meeting_audio_chunks").get()).toEqual({ n: 0 });
    expect(t.importer.isImported("zoom:abc==")).toBe(true);
    expect(t.importer.isImported("zoom:other")).toBe(false);
  });

  it("does not import the same recording twice, and says so in the preview and at confirm", () => {
    const t = setup();
    const first = remote(t);
    expect(
      t.importer.confirm({ token: first.token, title: first.title, startedAt: first.startedAt }).ok,
    ).toBe(true);
    const again = remote(t, { title: "Renamed", startedAt: Date.UTC(2026, 10, 30) });
    expect(again.duplicate).toMatchObject({ reason: "same-recording", title: "Launch sync" });
    const blocked = t.importer.confirm({
      token: again.token,
      title: again.title,
      startedAt: again.startedAt,
    });
    expect(blocked).toEqual({
      ok: false,
      message: "This meeting is already imported as “Launch sync”.",
    });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meetings").get()).toEqual({ n: 1 });
  });

  it("also flags a meeting with the same title at the same time, which can be imported anyway", () => {
    const t = setup();
    const file = t.preview("Launch sync.vtt", ZOOM_VTT, Date.UTC(2026, 10, 21, 10));
    t.importer.confirm({
      token: file.token,
      title: "Launch sync",
      startedAt: Date.UTC(2026, 10, 21, 10),
    });
    expect(remote(t).duplicate).toMatchObject({ reason: "same-title" });
  });

  it("keeps the service's own summary as a summary labelled as imported", () => {
    const t = setup();
    const preview = remote(t, { summary: "## Overview\n- They agreed on Thursday" });
    t.importer.confirm({
      token: preview.token,
      title: preview.title,
      startedAt: preview.startedAt,
    });
    const rows = t.db
      .prepare(
        "SELECT version, skill_id, skill_name, model_id, quick, markdown FROM meeting_summaries",
      )
      .all();
    expect(rows).toEqual([
      {
        version: 1,
        skill_id: "fireflies",
        skill_name: "Fireflies summary (imported)",
        model_id: "fireflies",
        quick: 0,
        markdown: "## Overview\n- They agreed on Thursday",
      },
    ]);
  });

  it("makes no summary when the service sent none, and nothing at all when the transcript is empty", () => {
    const t = setup();
    const preview = remote(t, { summary: "  " });
    t.importer.confirm({
      token: preview.token,
      title: preview.title,
      startedAt: preview.startedAt,
    });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meeting_summaries").get()).toEqual({ n: 0 });
    const empty = t.importer.prepareRemote({
      name: "x",
      transcript: transcript({ segments: [] }),
      title: "Empty",
      startedAt: 1,
      externalRef: "zoom:empty",
    });
    expect(empty).toEqual({ ok: false, message: "That meeting has no transcript to import." });
  });

  it("rolls back everything when the summary cannot be written", () => {
    const t = setup();
    const preview = remote(t, { summary: "text" });
    t.db.exec("DROP TABLE meeting_summaries");
    const result = t.importer.confirm({
      token: preview.token,
      title: preview.title,
      startedAt: preview.startedAt,
    });
    expect(result.ok).toBe(false);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meetings").get()).toEqual({ n: 0 });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meeting_segments").get()).toEqual({ n: 0 });
  });
});
