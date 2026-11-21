import { z } from "zod";
import { isCalendarDate } from "./tasks";

/**
 * Ask across meetings (NT-14): questions answered from the owner's own meetings, with the
 * sources the answer rests on. Ask reads transcripts, summaries, notes and tasks and changes
 * none of them.
 */

const dateSchema = z.string().refine(isCalendarDate, "A date is written YYYY-MM-DD.");

/** Which meetings a question looks in. Dates are local days, both ends included. */
export const askScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({ kind: z.literal("range"), from: dateSchema, to: dateSchema }),
  /** The meetings in a folder now; null is the Inbox. Moving a meeting changes the answer. */
  z.strictObject({ kind: z.literal("folder"), folderId: z.string().min(1).max(64).nullable() }),
  z.strictObject({
    kind: z.literal("meetings"),
    ids: z.array(z.string().min(1).max(64)).min(1).max(500),
  }),
]);
export type AskScope = z.infer<typeof askScopeSchema>;

export const ASK_SOURCES = ["transcript", "summary", "notes", "task"] as const;
export type AskSource = (typeof ASK_SOURCES)[number];

export const ASK_SOURCE_TEXT: Record<AskSource, string> = {
  transcript: "Transcript",
  summary: "Summary",
  notes: "Notes",
  task: "Task",
};

export const ASK_LIMITS = { question: 1000, title: 80 } as const;

/** What an answer rests on, as shown in a citation chip. */
export interface AskCitation {
  /** The number the answer uses: [1]. */
  n: number;
  meetingId: string;
  meetingTitle: string;
  /** The meeting was deleted: the chip no longer opens anything. */
  gone: boolean;
  source: AskSource;
  /** A transcript segment id, a summary id or a task id; null for notes. */
  ref: string | null;
  /** Where in the meeting a transcript source starts. */
  startMs: number | null;
  /** The words of the source, cut short. */
  excerpt: string;
}

export interface AskClosest {
  meetingId: string;
  title: string;
  startedAt: number;
}

export interface AskMessage {
  id: string;
  role: "user" | "assistant";
  /** An answer cites its sources as [1], [2]. */
  text: string;
  citations: AskCitation[];
  /** For an answer: false when the meetings do not support one. Null for a question. */
  supported: boolean | null;
  /** The meetings checked when nothing supported an answer. */
  closest: AskClosest[];
  createdAt: number;
}

export interface AskThreadItem {
  id: string;
  title: string;
  updatedAt: number;
}

export interface AskThread extends AskThreadItem {
  scope: AskScope;
  createdAt: number;
  messages: AskMessage[];
}

export const askSendSchema = z.strictObject({
  threadId: z.string().min(1).max(64).nullable(),
  question: z.string().trim().min(1).max(ASK_LIMITS.question),
  scope: askScopeSchema,
});
export type AskSendInput = z.infer<typeof askSendSchema>;

export type AskSendResult = { ok: true; thread: AskThread } | { ok: false; message: string };

export const ASK_DEFAULT_SCOPES = ["all", "week", "month"] as const;

/** `notetaker.ask` (NT-14). */
export const askSettingsSchema = z.strictObject({
  /** Where a new question looks to begin with: everything, the last 7 days or the last 30. */
  defaultScope: z.enum(ASK_DEFAULT_SCOPES),
  /** How many pieces of the meetings are given to the model. */
  topK: z.number().int().min(1).max(30),
  /** Look in the owner's own notes too. */
  includeNotes: z.boolean(),
});
export const DEFAULT_ASK_SETTINGS: z.infer<typeof askSettingsSchema> = {
  defaultScope: "all",
  topK: 12,
  includeNotes: true,
};
