import { randomUUID } from "node:crypto";
import type { InsightsDay } from "@murmur/shared";

/**
 * Counts for the team's usage dashboard (TM-09): how many words and dictations, by kind of app,
 * and meetings recorded. Only numbers leave the Mac, never text. What was sent is remembered, so
 * each sync adds just what is new, and a batch that was not acknowledged is sent again with the
 * same id, which the server counts once.
 */
export interface UsageEvent {
  day: string;
  metric: string;
  count: number;
  bucket?: string;
}

export interface UsageMeeting {
  id: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
}

/** An event with what to remember once it has been sent. */
interface Pending extends UsageEvent {
  /** The day's total for this metric and group once this event is counted. */
  total?: { key: string; value: number };
  /** The meeting this event counts. */
  meetingId?: string;
}

export interface UsageMemory {
  /** What has been sent for each day: totals by `metric|group`. */
  sent: Record<string, Record<string, number>>;
  /** Meetings that were reported. */
  meetings: string[];
  /** A batch waiting for the server's answer. */
  pending: { batchId: string; events: Pending[] } | null;
}

export const EMPTY_USAGE_MEMORY: UsageMemory = { sent: {}, meetings: [], pending: null };

/** The kinds of app the dashboard groups by. A name never leaves the Mac. */
export function appBucket(bundleId: string): string {
  const id = bundleId.toLowerCase();
  if (/mail|outlook|spark|superhuman|airmail/.test(id)) return "mail";
  if (/safari|chrome|firefox|edge|arc|brave|opera|vivaldi/.test(id)) return "browser";
  if (/slack|discord|messages|teams|whatsapp|telegram|signal|zoom/.test(id)) return "chat";
  if (/notion|pages|word|docs|keynote|powerpoint|excel|numbers/.test(id)) return "documents";
  if (
    /xcode|vscode|visual-?studio|jetbrains|intellij|sublime|cursor|terminal|iterm|warp|nova|zed/.test(
      id,
    )
  )
    return "code";
  if (/notes|bear|obsidian|drafts|craft|evernote|onenote|scratchpad/.test(id)) return "notes";
  return "other";
}

const MAX_DAYS = 35;
const dayOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Totals per `metric|group` for one day. */
function totalsOf(day: InsightsDay): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (key: string, n: number) => {
    if (n > 0) out[key] = (out[key] ?? 0) + n;
  };
  for (const [bundleId, app] of Object.entries(day.apps)) {
    const bucket = appBucket(bundleId);
    add(`words|${bucket}`, app.words);
    add(`dictations|${bucket}`, app.dictations);
  }
  // Counted dictations that have no app are "other".
  const appWords = Object.values(day.apps).reduce((sum, app) => sum + app.words, 0);
  const appDictations = Object.values(day.apps).reduce((sum, app) => sum + app.dictations, 0);
  add("words|other", day.words - appWords);
  add("dictations|other", day.dictations - appDictations);
  return out;
}

/** What is new since the last time: each day's growth, and each meeting not yet counted. */
export function buildBatch(input: {
  days: readonly InsightsDay[];
  meetings: readonly UsageMeeting[];
  memory: UsageMemory;
  now: number;
}): Pending[] {
  const events: Pending[] = [];
  const cutoff = dayOf(input.now - MAX_DAYS * 86_400_000);

  for (const day of input.days) {
    if (day.date < cutoff) continue;
    const before = input.memory.sent[day.date] ?? {};
    for (const [key, total] of Object.entries(totalsOf(day))) {
      const delta = total - (before[key] ?? 0);
      if (delta <= 0) continue;
      const [metric, bucket] = key.split("|") as [string, string];
      events.push({ day: day.date, metric, count: delta, bucket, total: { key, value: total } });
    }
  }

  const known = new Set(input.memory.meetings);
  for (const meeting of input.meetings) {
    if (known.has(meeting.id) || meeting.endedAt === null) continue;
    const day = dayOf(meeting.startedAt);
    if (day < cutoff) continue;
    events.push({ day, metric: "meetings_recorded", count: 1, meetingId: meeting.id });
    const minutes = Math.round(meeting.durationMs / 60_000);
    if (minutes > 0) events.push({ day, metric: "meeting_minutes_recorded", count: minutes });
  }
  return events;
}

export interface UsageDeps {
  days(): InsightsDay[];
  meetings(): UsageMeeting[];
  /** Posts a batch; true when the server took it (or had it already). */
  post(batchId: string, events: UsageEvent[]): Promise<boolean>;
  load(): UsageMemory;
  save(memory: UsageMemory): void;
  now(): number;
  newId?: () => string;
}

const BATCH = 500;

/** The memory once a batch was taken: its day totals and its meetings are remembered. */
function commit(memory: UsageMemory, events: readonly Pending[]): UsageMemory {
  const sent = { ...memory.sent };
  const meetings = [...memory.meetings];
  for (const event of events) {
    if (event.total)
      sent[event.day] = { ...(sent[event.day] ?? {}), [event.total.key]: event.total.value };
    if (event.meetingId) meetings.push(event.meetingId);
  }
  const days = Object.keys(sent).sort().slice(-MAX_DAYS);
  return {
    sent: Object.fromEntries(days.map((day) => [day, sent[day]!])),
    meetings: [...new Set(meetings)].slice(-2000),
    pending: null,
  };
}

const wire = (events: readonly Pending[]): UsageEvent[] =>
  events.map(({ day, metric, count, bucket }) => ({
    day,
    metric,
    count,
    ...(bucket !== undefined ? { bucket } : {}),
  }));

export function createUsageReporter(deps: UsageDeps) {
  return {
    /** Sends what is new. Returns how many events were sent. */
    async flush(): Promise<number> {
      let memory = deps.load();
      let sentCount = 0;

      // A batch from before that never got its answer goes first, with the same id, so the
      // server counts it once.
      if (memory.pending) {
        const waiting = memory.pending;
        if (!(await deps.post(waiting.batchId, wire(waiting.events)))) return 0;
        memory = commit(memory, waiting.events);
        deps.save(memory);
        sentCount += waiting.events.length;
      }

      const events = buildBatch({
        days: deps.days(),
        meetings: deps.meetings(),
        memory,
        now: deps.now(),
      });
      for (let at = 0; at < events.length; at += BATCH) {
        const piece = events.slice(at, at + BATCH);
        const batchId = (deps.newId ?? randomUUID)();
        // The batch is written down before it goes, so a lost answer can be repeated.
        memory = { ...memory, pending: { batchId, events: piece } };
        deps.save(memory);
        if (!(await deps.post(batchId, wire(piece)))) return sentCount;
        memory = commit(memory, piece);
        deps.save(memory);
        sentCount += piece.length;
      }
      return sentCount;
    },
  };
}
