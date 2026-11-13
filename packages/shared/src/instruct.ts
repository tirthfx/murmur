import { z } from "zod";

// Instruct Mode (RW-11, RW-17): hold the Instruct key, say what to write, and get a draft in a
// panel near the Bar. Murmur drafts text only. Main owns the session; the panel page shows it.

export const INSTRUCT_PANEL_SIZE = { width: 460, height: 420 } as const;

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
  /** What was asked, as heard. */
  instruction: string;
  /** Sources this draft could use (they have content and are on in Settings). */
  available: InstructSource[];
  /** Sources turned off for this thread. */
  off: InstructSource[];
}

export type InstructPanelState =
  | { stage: "hidden" }
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
  /** Escape or Discard. */
  close(): Promise<void>;
}

export const INSTRUCT_MESSAGES = {
  draftsOnly: "Murmur only drafts text. Nothing was sent, scheduled or set.",
  nothingSaid: "Say what to write",
  notBack: "Could not get back to the app. The draft was copied instead.",
  inserted: "Inserted",
  copied: "Copied",
} as const;

/** Longest field text sent with an instruction, on each side of the caret. */
export const INSTRUCT_FIELD_CHARS = 2000;
