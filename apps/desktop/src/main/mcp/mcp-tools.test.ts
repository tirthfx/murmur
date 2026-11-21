import { describe, expect, it } from "vitest";
import { MCP_LIMITS } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createAskIndex } from "../meetings/ask-index";
import { createFoldersStore } from "../meetings/folders-store";
import { createMeetingsStore } from "../meetings/meetings-store";
import { createSpeakersStore } from "../meetings/speakers-store";
import { createSummariesStore } from "../meetings/summaries-store";
import { createTasksService } from "../meetings/tasks-service";
import { createTranscriptStore } from "../meetings/transcript-store";
import { createMcpServer } from "./mcp-server";
import { createMcpTools, excerpt, parseWhen } from "./mcp-tools";

const AUDIO_PATH =
  "/Users/me/Library/Application Support/Murmur/meetings/m-1/secret-audio-chunk.m4a";
const DAY = 86_400_000;
// 21 Nov 2026, local noon.
const NOV21 = new Date(2026, 10, 21, 12).getTime();

function setup() {
  const db = openDatabase(":memory:");
  let n = 0;
  const meetings = createMeetingsStore(db);
  const folders = createFoldersStore(db, { now: () => 1, newId: () => `f${++n}` });
  const speakers = createSpeakersStore(db, { now: () => 1 });
  const summaries = createSummariesStore(db);
  const tasks = createTasksService(db, { newId: () => `t${++n}`, now: () => 5 });
  const ask = createAskIndex(db, { now: () => 9_000 });
  const transcript = createTranscriptStore(db);

  const planning = folders.create("Planning");
  if (!planning.ok) throw new Error("folder");
  meetings.create({
    id: "m-1",
    title: "Launch sync",
    startedAt: NOV21,
    source: "ad_hoc",
    folder: "/m/m-1",
    folderId: planning.id,
  });
  meetings.create({
    id: "m-2",
    title: "Budget review",
    startedAt: NOV21 - 10 * DAY,
    source: "ad_hoc",
    folder: "/m/m-2",
  });
  meetings.addChunk({
    meetingId: "m-1",
    channel: "mic",
    seq: 0,
    path: AUDIO_PATH,
    sha256: "a".repeat(64),
    bytes: 10,
    startMs: 0,
    durationMs: 5_000,
  });
  meetings.finish("m-1", NOV21 + 3_600_000, 3_600_000, "ready");

  const say = (
    meetingId: string,
    id: string,
    channel: "mic" | "system",
    startMs: number,
    text: string,
  ) =>
    db
      .prepare(
        `INSERT INTO meeting_segments (id, meeting_id, channel, start_ms, end_ms, text, is_dictated, is_final, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1, 1)`,
      )
      .run(id, meetingId, channel, startMs, startMs + 4_000, text);
  say("m-1", "m-1:s1", "mic", 5_000, "The launch moves to Thursday.");
  say("m-1", "m-1:s2", "system", 65_000, "Can QA finish the Frankfurt checks by Wednesday?");
  say("m-1", "m-1:s3", "mic", 25 * 60_000, "Later we talked about hiring.");
  say("m-1", "m-1:s4", "system", 50 * 60_000, "And the budget for the offsite.");
  say("m-2", "m-2:s1", "system", 1_000, "The budget is approved for the quarter.");
  db.prepare(
    "INSERT INTO meeting_segments (id, meeting_id, channel, start_ms, end_ms, text, is_dictated, is_final, created_at) VALUES ('m-1:partial','m-1','mic',7000,8000,'half a thought',0,0,1)",
  ).run();

  summaries.add({
    id: "sum-1",
    meetingId: "m-1",
    skill: { id: "meeting-summary", name: "Meeting summary" },
    modelId: "model",
    quick: false,
    markdown: "## Decisions\n- First version",
    at: 10,
  });
  summaries.add({
    id: "sum-2",
    meetingId: "m-1",
    skill: { id: "meeting-summary", name: "Meeting summary" },
    modelId: "model",
    quick: false,
    markdown:
      "## Decisions\n- The launch moves to Thursday [00:05](seg:m-1:s1)\n## Actions\n- QA checks by Wednesday",
    at: 20,
  });
  speakers.rename("m-1", "m-1:system", "Sam");

  tasks.addSuggested("m-1", [
    {
      title: "Finish QA checks",
      owner: "Sam",
      ownerIsMe: false,
      dueOn: "2026-11-25",
      sourceSegmentId: "m-1:s2",
    },
    {
      title: "Tell the customer",
      owner: null,
      ownerIsMe: true,
      dueOn: null,
      sourceSegmentId: null,
    },
  ]);
  for (const task of tasks.list({ status: "all" }).tasks) tasks.act(task.id, "accept");
  db.prepare(
    "INSERT INTO meeting_notes (meeting_id, body_md, updated_at) VALUES ('m-1', 'Private thought about Frankfurt hotels', 1)",
  ).run();

  const data = { meetings, transcript, speakers, summaries, tasks, folders, ask };
  const server = createMcpServer({
    tools: createMcpTools(data),
    serverName: "murmur",
    serverVersion: "1",
  });
  const client = { id: "c", name: null };
  const call = async (name: string, args: unknown = {}) => {
    const reply = await server.handle(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
      client,
    );
    const result = reply?.result as { content: { text: string }[]; isError?: boolean };
    const text = result.content[0]!.text;
    return {
      text,
      isError: result.isError === true,
      data: result.isError ? null : JSON.parse(text),
    };
  };
  return { db, call, planningId: planning.id };
}

describe("the six read tools (CN-11)", () => {
  it("offers exactly the six read tools, all read-only", () => {
    const t = setup();
    expect(t).toBeTruthy();
    const names = createMcpTools({} as never).map((tool) => [tool.name, tool.readOnly]);
    expect(names).toEqual([
      ["search_meetings", true],
      ["get_meeting", true],
      ["get_summary", true],
      ["get_transcript", true],
      ["list_tasks", true],
      ["list_folders", true],
    ]);
  });

  describe("search_meetings", () => {
    it("finds meetings by what was said, with the line, its id and time", async () => {
      const t = setup();
      const { data } = await t.call("search_meetings", { query: "Frankfurt checks" });
      expect(data.meetings).toHaveLength(1);
      expect(data.meetings[0]).toMatchObject({ meetingId: "m-1", title: "Launch sync" });
      expect(data.meetings[0].matches[0]).toMatchObject({
        source: "transcript",
        // A match is a passage: where it starts, and the words around what was found.
        segmentId: "m-1:s1",
        atMs: 5_000,
      });
      expect(data.meetings[0].matches[0].text).toContain("Frankfurt");
    });

    it("never searches the owner's notes", async () => {
      const t = setup();
      const { data } = await t.call("search_meetings", { query: "hotels" });
      expect(data.meetings).toEqual([]);
    });

    it("lists meetings newest first without a query, and narrows by dates and folder", async () => {
      const t = setup();
      expect(
        (await t.call("search_meetings")).data.meetings.map(
          (m: { meetingId: string }) => m.meetingId,
        ),
      ).toEqual(["m-1", "m-2"]);
      expect(
        (
          await t.call("search_meetings", { from: "2026-11-20", to: "2026-11-21" })
        ).data.meetings.map((m: { meetingId: string }) => m.meetingId),
      ).toEqual(["m-1"]);
      expect(
        (await t.call("search_meetings", { to: "2026-11-15" })).data.meetings.map(
          (m: { meetingId: string }) => m.meetingId,
        ),
      ).toEqual(["m-2"]);
      for (const folder of ["Planning", "planning", t.planningId]) {
        expect(
          (await t.call("search_meetings", { folder })).data.meetings.map(
            (m: { meetingId: string }) => m.meetingId,
          ),
        ).toEqual(["m-1"]);
      }
      expect(
        (await t.call("search_meetings", { folder: "inbox" })).data.meetings.map(
          (m: { meetingId: string }) => m.meetingId,
        ),
      ).toEqual(["m-2"]);
      expect(
        (await t.call("search_meetings", { query: "budget", folder: "inbox" })).data.meetings.map(
          (m: { meetingId: string }) => m.meetingId,
        ),
      ).toEqual(["m-2"]);
    });

    it("keeps to the limit, and refuses a bad date, folder or limit", async () => {
      const t = setup();
      expect((await t.call("search_meetings", { limit: 1 })).data.meetings).toHaveLength(1);
      expect((await t.call("search_meetings", { limit: MCP_LIMITS.searchMax + 1 })).isError).toBe(
        true,
      );
      expect((await t.call("search_meetings", { from: "yesterday" })).text).toContain(
        "from must be a date",
      );
      expect((await t.call("search_meetings", { to: "2026-02-31" })).text).toContain(
        "to must be a date",
      );
      expect((await t.call("search_meetings", { folder: "Nope" })).text).toBe(
        "There is no folder Nope.",
      );
    });

    it("says nothing matched when the query has no words to look for", async () => {
      const t = setup();
      expect((await t.call("search_meetings", { query: "what is it" })).data.meetings).toEqual([]);
    });
  });

  describe("get_meeting", () => {
    it("gives the title, times, folder, speakers and what can be read", async () => {
      const t = setup();
      const { data } = await t.call("get_meeting", { meetingId: "m-1" });
      expect(data).toEqual({
        meetingId: "m-1",
        title: "Launch sync",
        startedAt: new Date(NOV21).toISOString(),
        endedAt: new Date(NOV21 + 3_600_000).toISOString(),
        durationMs: 3_600_000,
        status: "ready",
        source: "ad_hoc",
        folder: "Planning",
        language: null,
        speakers: ["You", "Sam"],
        summaryVersions: 2,
        transcriptAvailable: true,
      });
      expect((await t.call("get_meeting", { meetingId: "m-2" })).data.folder).toBe("Inbox");
      expect((await t.call("get_meeting", { meetingId: "nope" })).text).toBe(
        "There is no meeting nope.",
      );
    });
  });

  describe("get_summary", () => {
    it("gives the newest version with its sections, or the one asked for", async () => {
      const t = setup();
      const latest = (await t.call("get_summary", { meetingId: "m-1" })).data;
      expect(latest).toMatchObject({
        version: 2,
        versions: [1, 2],
        sections: ["Decisions", "Actions"],
        quick: false,
      });
      expect(latest.markdown).toContain("(seg:m-1:s1)");
      expect((await t.call("get_summary", { meetingId: "m-1", version: 1 })).data).toMatchObject({
        version: 1,
        markdown: "## Decisions\n- First version",
      });
      expect((await t.call("get_summary", { meetingId: "m-1", version: 9 })).text).toBe(
        "That meeting has versions 1, 2.",
      );
      expect((await t.call("get_summary", { meetingId: "m-2" })).text).toBe(
        "That meeting has no summary yet.",
      );
    });
  });

  describe("get_transcript", () => {
    it("gives final lines with the speaker's name and time", async () => {
      const t = setup();
      const { data } = await t.call("get_transcript", {
        meetingId: "m-1",
        startMs: 0,
        endMs: 120_000,
      });
      expect(data.segments).toEqual([
        {
          id: "m-1:s1",
          startMs: 5_000,
          endMs: 9_000,
          speaker: "You",
          text: "The launch moves to Thursday.",
        },
        {
          id: "m-1:s2",
          startMs: 65_000,
          endMs: 69_000,
          speaker: "Sam",
          text: "Can QA finish the Frankfurt checks by Wednesday?",
        },
      ]);
      // The unfinished line is not there.
      expect(JSON.stringify(data)).not.toContain("half a thought");
      expect(data.nextStartMs).toBe(120_000);
    });

    it("never returns more than 20 minutes in one call, and says where to go on", async () => {
      const t = setup();
      const first = (await t.call("get_transcript", { meetingId: "m-1" })).data;
      expect(first.startMs).toBe(0);
      expect(first.endMs).toBe(MCP_LIMITS.transcriptMs);
      expect(first.segments.map((s: { id: string }) => s.id)).toEqual(["m-1:s1", "m-1:s2"]);
      expect(first.nextStartMs).toBe(MCP_LIMITS.transcriptMs);
      // Asking for the whole meeting is cut to 20 minutes from the start.
      const wide = (
        await t.call("get_transcript", { meetingId: "m-1", startMs: 0, endMs: 3_000_000 })
      ).data;
      expect(wide.endMs - wide.startMs).toBe(MCP_LIMITS.transcriptMs);
      expect(
        wide.segments.every((s: { startMs: number }) => s.startMs < MCP_LIMITS.transcriptMs),
      ).toBe(true);
      // And the next call picks up from there.
      const second = (
        await t.call("get_transcript", { meetingId: "m-1", startMs: first.nextStartMs })
      ).data;
      expect(second.segments.map((s: { id: string }) => s.id)).toEqual(["m-1:s3"]);
      expect(second.nextStartMs).toBe(2 * MCP_LIMITS.transcriptMs);
      const last = (
        await t.call("get_transcript", { meetingId: "m-1", startMs: second.nextStartMs })
      ).data;
      expect(last.segments.map((s: { id: string }) => s.id)).toEqual(["m-1:s4"]);
      expect(last.nextStartMs).toBeNull();
    });

    it("refuses an end before the start, and says when retention deleted the transcript", async () => {
      const t = setup();
      expect(
        (await t.call("get_transcript", { meetingId: "m-1", startMs: 5_000, endMs: 4_000 }))
          .isError,
      ).toBe(true);
      t.db.prepare("UPDATE meetings SET transcript_deleted_at = 5 WHERE id = 'm-1'").run();
      expect((await t.call("get_transcript", { meetingId: "m-1" })).text).toBe(
        "The transcript of that meeting was deleted.",
      );
      expect((await t.call("get_meeting", { meetingId: "m-1" })).data.transcriptAvailable).toBe(
        false,
      );
    });
  });

  describe("list_tasks", () => {
    it("lists open tasks by default, with the owner and the meeting", async () => {
      const t = setup();
      const { data } = await t.call("list_tasks");
      expect(data.tasks).toEqual([
        {
          id: expect.any(String),
          title: "Finish QA checks",
          notes: "",
          status: "open",
          owner: "Sam",
          dueOn: "2026-11-25",
          meetingId: "m-1",
          meetingTitle: "Launch sync",
        },
        {
          id: expect.any(String),
          title: "Tell the customer",
          notes: "",
          status: "open",
          owner: "me",
          dueOn: null,
          meetingId: "m-1",
          meetingTitle: "Launch sync",
        },
      ]);
    });

    it("filters by status, owner, due dates and meeting", async () => {
      const t = setup();
      const titles = async (args: object) =>
        ((await t.call("list_tasks", args)).data.tasks as { title: string }[]).map(
          (task) => task.title,
        );
      expect(await titles({ status: "done" })).toEqual([]);
      expect(await titles({ owner: "me" })).toEqual(["Tell the customer"]);
      expect(await titles({ from: "2026-11-24", to: "2026-11-25" })).toEqual(["Finish QA checks"]);
      expect(await titles({ from: "2026-11-26" })).toEqual([]);
      expect(await titles({ meetingId: "m-2" })).toEqual([]);
      expect((await t.call("list_tasks", { status: "nonsense" })).isError).toBe(true);
    });
  });

  describe("list_folders", () => {
    it("lists folders with their meeting counts and the Inbox's", async () => {
      const t = setup();
      expect((await t.call("list_folders")).data).toEqual({
        folders: [{ id: t.planningId, name: "Planning", meetings: 1 }],
        inboxMeetings: 1,
      });
    });
  });

  describe("what is never returned", () => {
    it("no result carries an audio path, a chunk, a local folder, a token or a note", async () => {
      const t = setup();
      const results = [
        await t.call("search_meetings"),
        await t.call("search_meetings", { query: "launch" }),
        await t.call("get_meeting", { meetingId: "m-1" }),
        await t.call("get_summary", { meetingId: "m-1" }),
        await t.call("get_transcript", { meetingId: "m-1" }),
        await t.call("list_tasks", { status: "all" }),
        await t.call("list_folders"),
      ];
      const all = results.map((result) => result.text).join("\n");
      expect(all.length).toBeGreaterThan(500);
      for (const secret of [
        "secret-audio-chunk",
        ".m4a",
        "Application Support",
        "/Users/",
        "/m/m-1",
        "audio",
        "sha256",
        "hotels",
        "token",
        "Bearer",
      ])
        expect(all.toLowerCase()).not.toContain(secret.toLowerCase());
    });
  });
});

describe("search helpers", () => {
  it("cuts a long passage around the first word found, with ellipses", () => {
    const text = `${"filler ".repeat(100)}the Frankfurt servers are ready ${"more ".repeat(100)}`;
    const cut = excerpt(text, "Frankfurt servers");
    expect(cut).toContain("Frankfurt servers are ready");
    expect(cut.startsWith("…")).toBe(true);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThan(300);
    expect(excerpt("short", "anything")).toBe("short");
    expect(excerpt("a ".repeat(300), "zzz").startsWith("a")).toBe(true);
  });

  it("reads a plain date as that day here, and its end for a closing date", () => {
    const start = new Date(2026, 10, 21).getTime();
    expect(parseWhen("2026-11-21", false)).toBe(start);
    expect(parseWhen("2026-11-21", true)).toBe(start + DAY);
    expect(parseWhen("2026-11-21T10:00:00Z", true)).toBe(Date.parse("2026-11-21T10:00:00Z"));
    for (const bad of ["", "21 Nov", "2026-13-01", "2026-02-30", "2026-11-21 10:00"])
      expect(parseWhen(bad, false)).toBeNull();
  });
});
