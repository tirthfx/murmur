import { z } from "zod";

// Instruct Mode (RW-11, RW-17): hold the Instruct key, say what to write, and get a draft in a
// panel near the Bar. Murmur drafts text only. Main owns the session; the panel page shows it.

export const INSTRUCT_PANEL_SIZE = { width: 480, height: 500 } as const;

/**
 * Context a draft can use (RW-17). `selection` and `field` are the app's text; `memory`,
 * `samples` and `style` are Murmur's own. The email profile waits for a mail connector.
 */
export const INSTRUCT_SOURCES = ["selection", "field", "memory", "samples", "style"] as const;
export type InstructSource = (typeof INSTRUCT_SOURCES)[number];

export const INSTRUCT_SOURCE_LABELS: Record<InstructSource, string> = {
  selection: "Selection",
  field: "Field text",
  memory: "Memory",
  samples: "Writing samples",
  style: "Style",
};

interface ThreadContext {
  /** The latest request, as heard or typed. */
  instruction: string;
  /** Earlier requests in this thread, oldest first (RW-12). */
  earlier: string[];
  /** Requests so far, the latest included. At INSTRUCT_LIMITS.turns no more are taken. */
  turns: number;
  /** Sources this draft could use (they have content and are on in Settings). */
  available: InstructSource[];
  /** Sources turned off for this thread. */
  off: InstructSource[];
}

export type InstructPanelState =
  | { stage: "hidden" }
  /** A new thread, waiting for its first request (typed, or said with the Instruct key). */
  | { stage: "empty" }
  | (ThreadContext & {
      stage: "running";
      /** Output so far. */
      text: string;
      loading: boolean;
    })
  | (ThreadContext & {
      stage: "draft";
      text: string;
      /** Sources that went into this draft, for the chips. */
      used: InstructSource[];
      /** Set when the request asked Murmur to act (send, schedule, remind). */
      note: string | null;
    })
  | (ThreadContext & {
      stage: "message";
      message: string;
      canRetry: boolean;
    });

export const INSTRUCT_PANEL_CHANNELS = {
  ready: "instruct-panel:ready",
  insert: "instruct-panel:insert",
  copy: "instruct-panel:copy",
  regenerate: "instruct-panel:regenerate",
  toggleSource: "instruct-panel:toggle-source",
  followUp: "instruct-panel:follow-up",
  newThread: "instruct-panel:new-thread",
  close: "instruct-panel:close",
} as const;

export const INSTRUCT_PANEL_PUSH = { state: "instruct-panel:state" } as const;

/** Arguments the panel may send, checked in main. */
export const INSTRUCT_PANEL_ARGS = {
  [INSTRUCT_PANEL_CHANNELS.ready]: z.tuple([]),
  [INSTRUCT_PANEL_CHANNELS.insert]: z.tuple([]),
  [INSTRUCT_PANEL_CHANNELS.copy]: z.tuple([]),
  [INSTRUCT_PANEL_CHANNELS.regenerate]: z.tuple([]),
  [INSTRUCT_PANEL_CHANNELS.toggleSource]: z.tuple([z.enum(INSTRUCT_SOURCES)]),
  [INSTRUCT_PANEL_CHANNELS.followUp]: z.tuple([z.string().min(1).max(1000)]),
  [INSTRUCT_PANEL_CHANNELS.newThread]: z.tuple([]),
  [INSTRUCT_PANEL_CHANNELS.close]: z.tuple([]),
} as const;

/** What the Instruct panel's preload exposes as `window.murmurInstruct`. */
export interface MurmurInstructApi {
  ready(): Promise<InstructPanelState>;
  onState(handler: (state: InstructPanelState) => void): () => void;
  /** Paste the draft at the caret in the app. */
  insert(): Promise<void>;
  copy(): Promise<void>;
  regenerate(): Promise<void>;
  /** Turn a context source off or back on for this thread; the draft is written again. */
  toggleSource(source: InstructSource): Promise<void>;
  /**
   * A typed request (RW-12): a follow-up that changes the current draft, or the first request
   * of a new thread.
   */
  followUp(text: string): Promise<void>;
  /** Drops the thread and waits for a new request. */
  newThread(): Promise<void>;
  /** Escape or Discard. */
  close(): Promise<void>;
}

export const INSTRUCT_MESSAGES = {
  draftsOnly: "Murmur only drafts text. Nothing was sent, scheduled or set.",
  nothingSaid: "Say what to write",
  notBack: "Could not get back to the app. The draft was copied instead.",
  inserted: "Inserted",
  copied: "Copied",
  turnLimit: "Start a new thread to keep going.",
  newThread: "New thread. Hold the Instruct key and say what to write.",
} as const;

/** RW-12 and RW-14 limits. */
export const INSTRUCT_LIMITS = {
  /** Requests per thread. */
  turns: 20,
  /** Earlier turns sent with a follow-up; older requests go in as a short list. */
  promptTurns: 6,
  /** Thread text is kept this long; then only the counts remain. */
  keepDays: 30,
  /** Threads kept; the oldest go first. */
  maxThreads: 1000,
  /** Longest typed follow-up. */
  followUpChars: 1000,
} as const;

export const INSTRUCT_OUTCOMES = ["pending", "inserted", "copied", "discarded"] as const;
export type InstructOutcome = (typeof INSTRUCT_OUTCOMES)[number];

/** A saved thread as the Instruct page lists it (RW-14). */
export const instructThreadSummarySchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  appBundleId: z.string().nullable(),
  /** The first request; empty once the text was removed after 30 days. */
  title: z.string(),
  /** The last draft; null once removed. */
  finalDraft: z.string().nullable(),
  turnCount: z.number().int(),
  outcome: z.enum(INSTRUCT_OUTCOMES),
  /** True after 30 days: only the counts are left. */
  textRemoved: z.boolean(),
});
export type InstructThreadSummary = z.infer<typeof instructThreadSummarySchema>;

export const instructTurnSchema = z.object({
  seq: z.number().int(),
  createdAt: z.number(),
  instruction: z.string(),
  draft: z.string().nullable(),
});
export type InstructTurn = z.infer<typeof instructTurnSchema>;

export const instructThreadSchema = instructThreadSummarySchema.extend({
  turns: z.array(instructTurnSchema),
});
export type InstructThread = z.infer<typeof instructThreadSchema>;

/** Longest field text sent with an instruction, on each side of the caret. */
export const INSTRUCT_FIELD_CHARS = 2000;
