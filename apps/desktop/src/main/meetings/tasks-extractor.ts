import { isCalendarDate, TASK_LIMITS } from "@murmur/shared";
import {
  CHUNK_TOKENS,
  OVERLAP_TOKENS,
  SINGLE_PASS_TOKENS,
  chunkLines,
  clockSeconds,
  estimateTokens,
  resolve,
  transcriptLines,
  type SummarySegment,
} from "./summarizer";
import type { SuggestedTask } from "./tasks-service";

export interface ExtractorDeps {
  /** One call of the local model. May wait for a dictation; rejects when it cannot answer. */
  generate(request: { system: string; prompt: string; maxTokens: number }): Promise<string>;
}

export interface ExtractRequest {
  segments: SummarySegment[];
  /** When the meeting started: "by Friday" is worked out from it. */
  meetingStartedAt: number;
  max: number;
}

export type ExtractResult = { ok: true; tasks: SuggestedTask[] } | { ok: false; reason: string };

const MAX_TOKENS = 900;
/** Tasks asked for in one part: more would not fit the answer's room. */
const PER_PART = 8;
const PER_PART_BRIEF = 4;

const day = (at: number): string => {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${iso} (${date.toLocaleDateString("en-US", { weekday: "long" })})`;
};

function system(max: number, brief: boolean): string {
  const most = Math.min(max, brief ? PER_PART_BRIEF : PER_PART);
  return [
    "You find the tasks in part of a meeting. A task is something a person agreed to do or was asked to do, and they said yes. A question, an opinion or a decision on its own is not a task.",
    "Use only what is said. Never invent tasks, names or dates. Lines of the transcript are marked with the time they were said, like [12:34]. Owner lines are the person who owns these notes and Remote lines are everyone else.",
    'Reply with JSON only and no other text, in this shape: {"tasks":[{"title":"...","owner":"...","due":"...","time":"..."}]}.',
    '"title": a short action starting with a verb' +
      (brief ? ", at most 8 words" : "") +
      '. "owner": "me" only when the Owner speaker took it on, a name when a name was said, otherwise null. "due": the day as it was said, like "Wednesday", "the 27th", "tomorrow" or "Nov 27", otherwise null; do not work out dates yourself. "time": the time in square brackets of the line where it was agreed, like "12:34".',
    `If there are no tasks reply {"tasks":[]}. At most ${most} tasks. Write titles in the language of the transcript.`,
  ].join("\n");
}

interface Item {
  title: string;
  owner: string | null;
  due: string | null;
  time: string | null;
}

/** The JSON of an answer, with a code fence or a few words around it taken away. */
function parseAnswer(text: string): Item[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = (value as { tasks?: unknown } | null)?.tasks;
  if (!Array.isArray(list)) return null;
  const items: Item[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) return null;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.title !== "string" || entry.title.trim() === "") return null;
    const text = (field: unknown) => (typeof field === "string" ? field.trim() : null);
    items.push({
      title: entry.title.trim().replace(/\s+/g, " ").slice(0, TASK_LIMITS.title),
      owner: text(entry.owner),
      due: text(entry.due),
      time: text(entry.time),
    });
  }
  return items;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * The day a task is due, from the words the model copied ("Wednesday", "the 27th", "Nov 27",
 * "tomorrow"), worked out here from the meeting's date because a small model cannot count days.
 * A date already written YYYY-MM-DD is kept when it is not before the meeting. English only;
 * anything else gives null. A weekday is the next one after the meeting's day.
 */
export function resolveDue(phrase: string | null, startedAt: number): string | null {
  const text = phrase?.trim().toLowerCase() ?? "";
  if (text === "") return null;
  const start = new Date(startedAt);
  const today = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const exact = /^(\d{4}-\d{2}-\d{2})$/.exec(text)?.[1];
  if (exact) return isCalendarDate(exact) && exact >= iso(today) ? exact : null;
  const ahead = (days: number) =>
    iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));
  if (/\btoday\b/.test(text)) return iso(today);
  if (/\btomorrow\b/.test(text)) return ahead(1);
  // "in 3 days" is a length of time, not a day of the month.
  if (/\b\d+\s*(?:days?|weeks?|hours?|months?)\b/.test(text)) return null;
  // A day of the month, with or without its month: "the 27th", "Nov 27", "27 November".
  const month = MONTHS.findIndex((name) =>
    new RegExp(`\\b${name.slice(0, 3)}[a-z]*\\b`).test(text),
  );
  const dayOfMonth = /\b(\d{1,2})(?:st|nd|rd|th)?\b/.exec(text.replace(/\d{4}/g, ""))?.[1];
  if (dayOfMonth) {
    const day = Number(dayOfMonth);
    const attempts: [number, number][] =
      month >= 0
        ? [
            [today.getFullYear(), month],
            [today.getFullYear() + 1, month],
          ]
        : [0, 1, 2].map((n): [number, number] => [today.getFullYear(), today.getMonth() + n]);
    for (const [year, m] of attempts) {
      const candidate = new Date(year, m, day);
      if (candidate.getDate() !== day) continue; // that month has no such day
      if (iso(candidate) >= iso(today)) return iso(candidate);
    }
    return null;
  }
  const weekday = WEEKDAYS.findIndex((name) => new RegExp(`\\b${name}\\b`).test(text));
  if (weekday >= 0) {
    const gap = ((weekday - today.getDay() + 6) % 7) + 1; // 1 to 7 days later
    return ahead(gap);
  }
  return null;
}

const ME = new Set(["me", "i", "myself", "owner", "the owner", "you"]);
const NOBODY = new Set(["", "null", "none", "nobody", "unknown", "someone", "n/a", "remote"]);

function toTask(item: Item, segments: readonly SummarySegment[], startedAt: number): SuggestedTask {
  const owner = item.owner?.trim() ?? "";
  const key = owner.toLowerCase();
  const time = item.time ? /(\d{1,2}(?::\d{2}){1,2})/.exec(item.time)?.[1] : undefined;
  return {
    title: item.title,
    ownerIsMe: ME.has(key),
    owner: ME.has(key) || NOBODY.has(key) ? null : owner.slice(0, TASK_LIMITS.owner),
    dueOn: resolveDue(item.due, startedAt),
    sourceSegmentId: time ? (resolve(clockSeconds(time), segments)?.id ?? null) : null,
  };
}

const sameTask = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Suggests tasks from a meeting's transcript (NT-26). A long meeting is read in parts, as for a
 * summary. The model answers in JSON, which is checked; an answer that is not valid is asked for
 * once more, and if it is still not valid the meeting gets no tasks at all (`ok: false`).
 * Nothing here accepts a task.
 */
export async function extractTasks(
  deps: ExtractorDeps,
  request: ExtractRequest,
): Promise<ExtractResult> {
  const lines = transcriptLines(request.segments);
  const total = lines.join("\n");
  const parts =
    estimateTokens(total) <= SINGLE_PASS_TOKENS
      ? [lines]
      : chunkLines(lines, CHUNK_TOKENS, OVERLAP_TOKENS);
  const found: SuggestedTask[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const prompt = `Meeting date: ${day(request.meetingStartedAt)}\n\nTranscript:\n${part.join("\n")}`;
    let items: Item[] | null = null;
    // A second try asks for fewer, shorter tasks: the first answer may have run out of room.
    for (let attempt = 0; attempt < 2 && items === null; attempt++) {
      items = parseAnswer(
        await deps.generate({
          system: system(request.max, attempt > 0),
          prompt,
          maxTokens: MAX_TOKENS,
        }),
      );
    }
    if (items === null)
      return { ok: false, reason: "The model did not answer in valid JSON twice." };
    for (const item of items) {
      const key = sameTask(item.title);
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      found.push(toTask(item, request.segments, request.meetingStartedAt));
    }
  }
  return { ok: true, tasks: found.slice(0, request.max) };
}
