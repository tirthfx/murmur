import { z } from "zod";

/**
 * Meeting briefs (NT-11): a page before a calendar meeting, built on this Mac from the meetings
 * Murmur already has and from the connectors that are connected and turned on. The local model
 * writes only a short opening; the lists are built by code, and every line cites the numbered
 * source it came from.
 */

export const BRIEF_SOURCE_IDS = [
  "meetings",
  "tasks",
  "gmail",
  "slack",
  "notion",
  "linear",
  "github",
] as const;
export type BriefSourceId = (typeof BRIEF_SOURCE_IDS)[number];

export interface BriefSourceText {
  label: string;
  /** The connector that provides it; null for what Murmur has itself. */
  connector: string | null;
}

export const BRIEF_SOURCE_TEXT: Record<BriefSourceId, BriefSourceText> = {
  meetings: { label: "Earlier meetings", connector: null },
  tasks: { label: "Open tasks", connector: null },
  gmail: { label: "Gmail", connector: "gmail" },
  slack: { label: "Slack", connector: "slack" },
  notion: { label: "Notion", connector: "notion" },
  linear: { label: "Linear", connector: "linear" },
  github: { label: "GitHub", connector: "github" },
};

export const BRIEF_LEAD_MINUTES = [15, 30, 60] as const;

/** `notetaker.brief`: when to build, and which sources to use. Connector sources are off until turned on. */
export const briefSettingsSchema = z.strictObject({
  /** Build a brief when a meeting is `leadMinutes` away. */
  auto: z.boolean(),
  leadMinutes: z.number().int().min(5).max(240),
  sources: z.strictObject({
    meetings: z.boolean(),
    tasks: z.boolean(),
    gmail: z.boolean(),
    slack: z.boolean(),
    notion: z.boolean(),
    linear: z.boolean(),
    github: z.boolean(),
  }),
});
export type BriefSettings = z.infer<typeof briefSettingsSchema>;

export const DEFAULT_BRIEF_SETTINGS: BriefSettings = {
  auto: true,
  leadMinutes: 30,
  sources: {
    meetings: true,
    tasks: true,
    gmail: false,
    slack: false,
    notion: false,
    linear: false,
    github: false,
  },
};

/** What a source did for one brief. */
export const BRIEF_SOURCE_STATES = [
  /** It gave items. */
  "used",
  /** It was asked and had nothing about this meeting. */
  "empty",
  /** The owner turned it off for briefs. */
  "off",
  /** The connector has no connected account. */
  "not-connected",
  /** Connected, but Google has not been given the permission to read mail. */
  "needs-permission",
  /** It could not be read. */
  "failed",
] as const;
export type BriefSourceState = (typeof BRIEF_SOURCE_STATES)[number];

export interface BriefSourceReport {
  id: BriefSourceId;
  label: string;
  state: BriefSourceState;
  /** How many items of it are in the brief. */
  count: number;
  /** What to do or what went wrong, in plain words; null when there is nothing to say. */
  note: string | null;
}

/** One thing a brief cites. `n` is the number used in the text, as [n]. */
export interface BriefItem {
  n: number;
  source: BriefSourceId;
  title: string;
  /** Plain text, cut to the source's share of the budget. */
  text: string;
  /** Milliseconds of the meeting, message, edit or update it comes from; null when unknown. */
  at: number | null;
  /** An address to open it; null when there is none. */
  url: string | null;
  /** The meeting, for an item that is one of Murmur's own. */
  meetingId: string | null;
}

export interface MeetingBrief {
  /** `<account id>:<event id>`. */
  eventKey: string;
  title: string;
  startMs: number;
  builtAt: number;
  /** Markdown: `##` sections and `-` bullets; a citation is `[n]`. */
  markdown: string;
  sources: BriefSourceReport[];
  items: BriefItem[];
  /** Whether the local model wrote the opening. */
  modelWrote: boolean;
}

/** An event a brief can be made for. */
export interface BriefEvent {
  eventKey: string;
  title: string;
  startMs: number;
  endMs: number;
  /** Who is invited, by name or address; the owner is left out. */
  people: string[];
  /** When its brief was built; null when there is none yet. */
  builtAt: number | null;
}

/** What the Brief tab shows. */
export interface BriefOverview {
  /** Whether any calendar account is connected. */
  calendarConnected: boolean;
  events: BriefEvent[];
  /** Each source: whether it is on and what it needs, so the tab can say what to connect. */
  sources: BriefSourceReport[];
  /** The brief settings, for the lead time and the switches. */
  settings: BriefSettings;
}

export type BriefResult = { ok: true; brief: MeetingBrief } | { ok: false; message: string };

export const BRIEF_LIMITS = {
  /** About 1,500 tokens of text for each source. */
  charsPerSource: 6000,
  meetings: 3,
  tasks: 5,
  items: 5,
  opening: 700,
} as const;
