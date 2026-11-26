import { z } from "zod";
import {
  MCP_LIMITS,
  TASK_OWNER_FILTERS,
  TASK_STATUSES,
  type TaskFilter,
  readableMentions,
} from "@murmur/shared";
import type { AskIndex } from "../meetings/ask-index";
import type { FoldersStore } from "../meetings/folders-store";
import type { MeetingNotesStore } from "../meetings/meeting-notes-store";
import type { MeetingsStore } from "../meetings/meetings-store";
import type { SpeakersStore } from "../meetings/speakers-store";
import type { SummariesStore } from "../meetings/summaries-store";
import type { TasksService } from "../meetings/tasks-service";
import type { TranscriptStore } from "../meetings/transcript-store";
import { McpToolError, type McpTool } from "./mcp-server";

/**
 * The data the six read tools use (CN-11). Only meeting notes, summaries, transcripts, tasks and
 * folders: no audio, no connector accounts, no dictation history, no settings, no files.
 */
export interface McpData {
  meetings: Pick<MeetingsStore, "get">;
  transcript: Pick<TranscriptStore, "segments">;
  speakers: Pick<SpeakersStore, "list">;
  summaries: Pick<SummariesStore, "list">;
  tasks: Pick<TasksService, "list" | "addClientSuggestion">;
  folders: Pick<FoldersStore, "list" | "get" | "meetingIds">;
  notes: Pick<MeetingNotesStore, "notes" | "saveNotes">;
  ask: Pick<AskIndex, "sync" | "search" | "meetings">;
}

const DAY_MS = 86_400_000;
const SNIPPET_CHARS = 280;
const iso = (ms: number) => new Date(ms).toISOString();

/** About `SNIPPET_CHARS` of a passage, starting a little before the first word of the query found in it. */
export function excerpt(text: string, query: string): string {
  if (text.length <= SNIPPET_CHARS) return text;
  const lower = text.toLowerCase();
  const found = query
    .toLowerCase()
    .match(/[\p{L}\p{N}]{3,}/gu)
    ?.map((word) => lower.indexOf(word.slice(0, Math.max(3, word.length - 2))))
    .filter((at) => at >= 0);
  const first = found && found.length > 0 ? Math.min(...found) : 0;
  const start = Math.max(0, first - 80);
  const cut = text.slice(start, start + SNIPPET_CHARS);
  return `${start > 0 ? "…" : ""}${cut}${start + SNIPPET_CHARS < text.length ? "…" : ""}`;
}

/**
 * `2026-11-21` is that day on this Mac; anything else must be a full date and time. `end` makes a
 * plain date mean the end of that day, so `to: 2026-11-21` includes the 21st.
 */
export function parseWhen(value: string, end: boolean): number | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) {
    const start = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime();
    if (Number.isNaN(start)) return null;
    const check = new Date(start);
    if (check.getMonth() !== Number(day[2]) - 1) return null;
    return end ? start + DAY_MS : start;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
}

const when = z.string().min(1).max(40);
const meetingId = z.string().min(1).max(64);

function range(from: string | undefined, to: string | undefined) {
  const out: { from?: number; to?: number } = {};
  if (from !== undefined) {
    const at = parseWhen(from, false);
    if (at === null)
      throw new McpToolError("from must be a date like 2026-11-21 or a full date and time.");
    out.from = at;
  }
  if (to !== undefined) {
    const at = parseWhen(to, true);
    if (at === null)
      throw new McpToolError("to must be a date like 2026-11-21 or a full date and time.");
    out.to = at;
  }
  return out;
}

export function createMcpTools(data: McpData): McpTool[] {
  const folderName = (id: string | null) =>
    id === null ? "Inbox" : (data.folders.get(id)?.name ?? "Inbox");

  const need = (id: string) => {
    const meeting = data.meetings.get(id);
    if (!meeting) throw new McpToolError(`There is no meeting ${id}.`);
    return meeting;
  };

  const searchMeetings: McpTool = {
    name: "search_meetings",
    title: "Search meetings",
    description:
      "Finds meetings. With a query, returns the meetings whose transcript or summary matches, each with the best matching passages (the id and time of the transcript line a passage starts at, and the words around the match; read the transcript from that time for the full lines); without one, lists meetings newest first. Narrow it by date range or folder.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for. Leave out to list meetings." },
        from: {
          type: "string",
          description: "Meetings from this date (2026-11-21) or date and time.",
        },
        to: { type: "string", description: "Meetings up to and including this date." },
        folder: { type: "string", description: 'A folder id or name, or "inbox".' },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MCP_LIMITS.searchMax,
          description: "How many meetings, at most 25. Default 10.",
        },
      },
      additionalProperties: false,
    },
    args: z.strictObject({
      query: z.string().max(300).optional(),
      from: when.optional(),
      to: when.optional(),
      folder: z.string().min(1).max(100).optional(),
      limit: z.number().int().min(1).max(MCP_LIMITS.searchMax).optional(),
    }),
    readOnly: true,
    run(args: { query?: string; from?: string; to?: string; folder?: string; limit?: number }) {
      const limit = args.limit ?? 10;
      const filter: { from?: number; to?: number; meetingIds?: string[] } = range(
        args.from,
        args.to,
      );
      if (args.folder !== undefined) {
        const wanted = args.folder.trim().toLowerCase();
        const folder =
          wanted === "inbox"
            ? null
            : data.folders
                .list()
                .find(
                  (candidate) =>
                    candidate.id === args.folder || candidate.name.toLowerCase() === wanted,
                );
        if (folder === undefined) throw new McpToolError(`There is no folder ${args.folder}.`);
        filter.meetingIds = data.folders.meetingIds(folder === null ? null : folder.id);
      }
      const query = args.query?.trim() ?? "";
      if (query === "") {
        return {
          meetings: data.ask
            .meetings(filter)
            .slice(0, limit)
            .map((meeting) => ({
              meetingId: meeting.id,
              title: meeting.title,
              startedAt: iso(meeting.startedAt),
            })),
        };
      }
      // Only what people said and what was summarised: not the owner's own notes or tasks.
      const scoped = { ...filter, sources: ["transcript", "summary"] as const };
      data.ask.sync(scoped);
      const hits = data.ask.search(query, scoped, limit * 6);
      const grouped = new Map<
        string,
        {
          meetingId: string;
          title: string;
          startedAt: string;
          matches: {
            source: string;
            segmentId: string | null;
            atMs: number | null;
            text: string;
          }[];
        }
      >();
      for (const hit of hits) {
        let entry = grouped.get(hit.meetingId);
        if (!entry) {
          if (grouped.size >= limit) continue;
          entry = {
            meetingId: hit.meetingId,
            title: hit.meetingTitle,
            startedAt: iso(hit.meetingStartedAt),
            matches: [],
          };
          grouped.set(hit.meetingId, entry);
        }
        if (entry.matches.length < 3)
          entry.matches.push({
            source: hit.source,
            segmentId: hit.source === "transcript" ? hit.ref : null,
            atMs: hit.startMs,
            text: excerpt(hit.text, query),
          });
      }
      return { meetings: [...grouped.values()] };
    },
  };

  const getMeeting: McpTool = {
    name: "get_meeting",
    title: "Get a meeting",
    description:
      "One meeting: its title, the people invited (names), when it was, how long, its folder, the speakers, and what is available to read.",
    inputSchema: {
      type: "object",
      properties: { meetingId: { type: "string" } },
      required: ["meetingId"],
      additionalProperties: false,
    },
    args: z.strictObject({ meetingId }),
    readOnly: true,
    run(args: { meetingId: string }) {
      const meeting = need(args.meetingId);
      return {
        meetingId: meeting.id,
        title: meeting.title,
        startedAt: iso(meeting.startedAt),
        endedAt: meeting.endedAt === null ? null : iso(meeting.endedAt),
        durationMs: meeting.durationMs,
        status: meeting.status,
        source: meeting.source,
        folder: folderName(meeting.folderId),
        language: meeting.language,
        speakers: data.speakers.list(meeting.id).map((speaker) => speaker.name),
        // Names of the people invited, for a meeting started from a calendar event; no emails.
        attendees: (meeting.attendees ?? []).map(
          (attendee) => attendee.name ?? attendee.email.split("@")[0],
        ),
        summaryVersions: data.summaries.list(meeting.id).length,
        transcriptAvailable: meeting.transcriptDeletedAt === null,
      };
    },
  };

  const getSummary: McpTool = {
    name: "get_summary",
    title: "Get a summary",
    description:
      "A meeting's summary as Markdown, with the section headings. Without a version, the newest. A time link like [12:34](seg:<id>) points at a transcript line.",
    inputSchema: {
      type: "object",
      properties: {
        meetingId: { type: "string" },
        version: {
          type: "integer",
          minimum: 1,
          description: "A version number. Default: the newest.",
        },
      },
      required: ["meetingId"],
      additionalProperties: false,
    },
    args: z.strictObject({ meetingId, version: z.number().int().min(1).optional() }),
    readOnly: true,
    run(args: { meetingId: string; version?: number }) {
      const meeting = need(args.meetingId);
      const all = data.summaries.list(meeting.id);
      if (all.length === 0) throw new McpToolError("That meeting has no summary yet.");
      const summary =
        args.version === undefined
          ? all[all.length - 1]!
          : all.find((candidate) => candidate.version === args.version);
      if (!summary)
        throw new McpToolError(
          `That meeting has versions ${all.map((candidate) => candidate.version).join(", ")}.`,
        );
      return {
        meetingId: meeting.id,
        version: summary.version,
        versions: all.map((candidate) => candidate.version),
        skill: summary.skillName,
        quick: summary.quick,
        createdAt: iso(summary.createdAt),
        sections: [...summary.markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]!.trim()),
        markdown: summary.markdown,
      };
    },
  };

  const getTranscript: McpTool = {
    name: "get_transcript",
    title: "Get a transcript",
    description:
      "The lines of a meeting with the speaker and time of each. At most 20 minutes a call: when there is more, nextStartMs says where to continue.",
    inputSchema: {
      type: "object",
      properties: {
        meetingId: { type: "string" },
        startMs: {
          type: "integer",
          minimum: 0,
          description: "From this time in the meeting. Default 0.",
        },
        endMs: {
          type: "integer",
          minimum: 1,
          description: "Up to this time. At most 20 minutes after the start.",
        },
      },
      required: ["meetingId"],
      additionalProperties: false,
    },
    args: z
      .strictObject({
        meetingId,
        startMs: z.number().int().min(0).optional(),
        endMs: z.number().int().min(1).optional(),
      })
      .refine((value) => value.endMs === undefined || value.endMs > (value.startMs ?? 0), {
        message: "endMs must be after startMs",
        path: ["endMs"],
      }),
    readOnly: true,
    run(args: { meetingId: string; startMs?: number; endMs?: number }) {
      const meeting = need(args.meetingId);
      if (meeting.transcriptDeletedAt !== null)
        throw new McpToolError("The transcript of that meeting was deleted.");
      const startMs = args.startMs ?? 0;
      const limit = startMs + MCP_LIMITS.transcriptMs;
      const endMs = Math.min(args.endMs ?? limit, limit);
      const names = new Map(
        data.speakers.list(meeting.id).map((speaker) => [speaker.id, speaker.name]),
      );
      const all = data.transcript
        .segments(meeting.id)
        .filter((segment) => segment.isFinal && segment.text.trim() !== "");
      const segments = all.filter(
        (segment) => segment.startMs >= startMs && segment.startMs < endMs,
      );
      const next = all.find((segment) => segment.startMs >= endMs);
      return {
        meetingId: meeting.id,
        startMs,
        endMs,
        durationMs: meeting.durationMs,
        segments: segments.map((segment) => ({
          id: segment.id,
          startMs: segment.startMs,
          endMs: segment.endMs,
          speaker:
            names.get(segment.speakerId ?? `${meeting.id}:${segment.channel}`) ??
            (segment.channel === "mic" ? "You" : "Remote"),
          text: segment.text,
        })),
        nextStartMs: next ? endMs : null,
      };
    },
  };

  const listTasks: McpTool = {
    name: "list_tasks",
    title: "List tasks",
    description:
      "Tasks from meetings and written by hand. Filter by status (default open), owner, due date range, or meeting.",
    inputSchema: {
      type: "object",
      properties: {
        status: { enum: [...TASK_STATUSES, "all"], description: "Default open." },
        owner: { enum: [...TASK_OWNER_FILTERS], description: "Default all." },
        from: { type: "string", description: "Due from this date." },
        to: { type: "string", description: "Due up to and including this date." },
        meetingId: { type: "string" },
      },
      additionalProperties: false,
    },
    args: z.strictObject({
      status: z.enum([...TASK_STATUSES, "all"]).optional(),
      owner: z.enum(TASK_OWNER_FILTERS).optional(),
      from: when.optional(),
      to: when.optional(),
      meetingId: meetingId.optional(),
    }),
    readOnly: true,
    run(args: {
      status?: TaskFilter["status"];
      owner?: TaskFilter["owner"];
      from?: string;
      to?: string;
      meetingId?: string;
    }) {
      const window = range(args.from, args.to);
      const filter: TaskFilter = {
        status: args.status ?? "open",
        owner: args.owner ?? "all",
        ...(args.meetingId ? { meetingId: args.meetingId } : {}),
      };
      const tasks = data.tasks.list(filter).tasks.filter((task) => {
        if (window.from === undefined && window.to === undefined) return true;
        if (task.dueOn === null) return false;
        const due = Date.parse(`${task.dueOn}T00:00:00`);
        return (
          (window.from === undefined || due >= window.from) &&
          (window.to === undefined || due < window.to)
        );
      });
      return {
        tasks: tasks.map((task) => ({
          id: task.id,
          title: readableMentions(task.title),
          notes: readableMentions(task.notes),
          status: task.status,
          owner: task.ownerIsMe ? "me" : task.owner,
          dueOn: task.dueOn,
          meetingId: task.meetingId,
          meetingTitle: task.meetingTitle,
        })),
      };
    },
  };

  const listFolders: McpTool = {
    name: "list_folders",
    title: "List folders",
    description:
      "The folders meetings are sorted into, with how many meetings each has. The Inbox holds meetings in no folder.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    args: z.strictObject({}),
    readOnly: true,
    run() {
      return {
        folders: data.folders.list().map((folder) => ({
          id: folder.id,
          name: folder.name,
          meetings: folder.meetings,
        })),
        inboxMeetings: data.folders.meetingIds(null).length,
      };
    },
  };

  const createTask: McpTool = {
    name: "create_task",
    title: "Suggest a task",
    description:
      "Adds a task for the owner to look at. It starts as a suggestion: the owner accepts or dismisses it in My Tasks, and it is never accepted by itself. Works only while the owner has turned it on in Murmur.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: 200 },
        notes: { type: "string", maxLength: 2000 },
        owner: {
          type: "string",
          maxLength: 80,
          description: "Who it is for, if someone was named.",
        },
        ownerIsMe: { type: "boolean", description: "True when it is for the owner." },
        dueOn: { type: "string", description: "The due day, 2026-11-25." },
        meetingId: { type: "string", description: "The meeting it came from, if any." },
      },
      required: ["title"],
      additionalProperties: false,
    },
    args: z.strictObject({
      title: z.string().min(1).max(200),
      notes: z.string().max(2000).optional(),
      owner: z.string().min(1).max(80).optional(),
      ownerIsMe: z.boolean().optional(),
      dueOn: z.string().max(10).optional(),
      meetingId: meetingId.optional(),
    }),
    readOnly: false,
    run(args: {
      title: string;
      notes?: string;
      owner?: string;
      ownerIsMe?: boolean;
      dueOn?: string;
      meetingId?: string;
    }) {
      const result = data.tasks.addClientSuggestion(
        {
          title: args.title,
          notes: args.notes ?? "",
          owner: args.owner ?? null,
          ownerIsMe: args.ownerIsMe ?? false,
          dueOn: args.dueOn ?? null,
        },
        args.meetingId ?? null,
      );
      if (!result.ok) throw new McpToolError(result.message);
      return {
        taskId: result.task.id,
        status: result.task.status,
        note: "The owner accepts or dismisses it in My Tasks.",
      };
    },
  };

  const addNote: McpTool = {
    name: "add_note",
    title: "Add to a meeting's notes",
    description:
      "Adds text at the end of the owner's own notes on a meeting. It never changes what is already there. Works only while the owner has turned it on in Murmur.",
    inputSchema: {
      type: "object",
      properties: {
        meetingId: { type: "string" },
        text: { type: "string", maxLength: 4000 },
      },
      required: ["meetingId", "text"],
      additionalProperties: false,
    },
    args: z.strictObject({ meetingId, text: z.string().trim().min(1).max(4000) }),
    readOnly: false,
    run(args: { meetingId: string; text: string }) {
      const meeting = need(args.meetingId);
      const current = data.notes.notes(meeting.id).body;
      const next =
        current.trim() === "" ? args.text : `${current.replace(/\s+$/, "")}\n\n${args.text}`;
      if (!data.notes.saveNotes(meeting.id, next))
        throw new McpToolError("The notes on that meeting are too long to add more.");
      return { meetingId: meeting.id, added: args.text.length, notesLength: next.length };
    },
  };

  return [
    searchMeetings,
    getMeeting,
    getSummary,
    getTranscript,
    listTasks,
    listFolders,
    createTask,
    addNote,
  ];
}
