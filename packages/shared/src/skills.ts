import { z } from "zod";
import { meetingLanguageCodes } from "./languages";

/**
 * Skills (NT-15): a named prompt that turns a meeting's transcript and notes into a summary,
 * a document or a follow-up. A Skill says what to write and the sections to fill; Murmur adds
 * the rules that keep the output grounded (timestamps, "Not discussed"). Built-in Skills ship
 * with the app, are read-only and can be duplicated into custom copies.
 */

export const SKILL_LENGTHS = ["short", "medium", "long"] as const;
export type SkillLength = (typeof SKILL_LENGTHS)[number];

/** Which local model writes a Skill's output; "quality" needs the larger model downloaded. */
export const SKILL_MODELS = ["fast", "quality"] as const;

export const skillSchema = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300),
  /** The headings of the output, in order. A section with nothing to say reads "Not discussed". */
  sections: z.array(z.string().trim().min(1).max(60)).min(1).max(12),
  length: z.enum(SKILL_LENGTHS),
  /** What to write, in the Skill author's words. */
  prompt: z.string().trim().min(1).max(4000),
  model: z.enum(SKILL_MODELS).default("fast"),
  /** Built-in Skills are read-only. */
  builtIn: z.boolean(),
  /**
   * A built-in's version is bumped when it changes. A custom Skill's version goes up by one with
   * every edit; the versions before it are kept (NT-16).
   */
  version: z.number().int().min(1),
  /** The built-in a custom Skill was copied from, and the version it had then. */
  basedOn: z.string().min(1).max(64).nullable(),
  basedOnVersion: z.number().int().min(1).nullable(),
});
export type Skill = z.infer<typeof skillSchema>;

/** What the owner writes when making or editing a custom Skill. */
export const skillDraftSchema = skillSchema.pick({
  name: true,
  description: true,
  sections: true,
  length: true,
  prompt: true,
  model: true,
});
export type SkillDraft = z.infer<typeof skillDraftSchema>;

/** An earlier version of a custom Skill, kept so an edit can be undone (NT-16). */
export interface SkillVersion extends SkillDraft {
  skillId: string;
  version: number;
  /** When this version stopped being the current one. */
  createdAt: number;
}

export type SkillResult = { ok: true; skill: Skill } | { ok: false; message: string };
export type SkillImportResult =
  | { ok: true; skill: Skill }
  | { ok: false; message: string; line: number | null }
  | { ok: false; cancelled: true };
export type SkillExportResult =
  { ok: true; path: string } | { ok: false; message: string } | { ok: false; cancelled: true };

/** A copy of a built-in Skill has a newer version of the built-in to look at. */
export function hasNewBuiltInVersion(
  skill: Skill,
  builtIns: readonly Skill[] = BUILT_IN_SKILLS,
): boolean {
  if (skill.builtIn || !skill.basedOn || skill.basedOnVersion === null) return false;
  const built = builtIns.find((candidate) => candidate.id === skill.basedOn);
  return !!built && built.version > skill.basedOnVersion;
}

export const DEFAULT_SKILL_ID = "meeting-summary";

type Authored = Omit<Skill, "builtIn" | "version" | "basedOn" | "basedOnVersion">;

const AUTHORED: Authored[] = [
  {
    id: "meeting-summary",
    name: "Meeting summary",
    description: "What was discussed, decided and left to do.",
    sections: ["Overview", "Key points", "Decisions", "Action items", "Open questions"],
    length: "medium",
    model: "fast",
    prompt:
      "Summarise this meeting for someone who was not there. Give a short overview, then the key points in the order they came up, the decisions that were made, the action items with an owner when one was named, and the questions left open.",
  },
  {
    id: "action-review",
    name: "Action review",
    description: "Decisions and who owns what.",
    sections: ["Decisions", "Owners and actions", "Deadlines", "Risks"],
    length: "short",
    model: "fast",
    prompt:
      "List every decision made and every action agreed. For each action name the owner and the deadline if they were said. Note risks or blockers that people raised.",
  },
  {
    id: "follow-up-note",
    name: "Follow-up note",
    description: "A recap with next steps for everyone who attended.",
    sections: ["Recap", "Next steps", "Questions to answer"],
    length: "medium",
    model: "fast",
    prompt:
      "Write a note to send to the attendees after the meeting: a brief recap of what was covered, the next steps for each person, and the questions that still need an answer. Use a friendly, plain tone.",
  },
  {
    id: "customer-call-notes",
    name: "Customer call notes",
    description: "Problems, asks and commitments from a customer call.",
    sections: [
      "Who and why",
      "Problems raised",
      "What they asked for",
      "What we committed to",
      "Follow-ups",
    ],
    length: "medium",
    model: "fast",
    prompt:
      "Write notes of a call with a customer. Capture who was on the call and why, the problems they described, what they asked for, anything our side promised, and the follow-ups. Use the customer's own words where it matters.",
  },
  {
    id: "product-spec-draft",
    name: "Product spec draft",
    description: "A first draft of a spec from a product discussion.",
    sections: ["Problem", "Goals", "Proposed approach", "Out of scope", "Open questions"],
    length: "long",
    model: "fast",
    prompt:
      "Turn this discussion into the first draft of a product spec. State the problem, the goals, the approach that was favoured and why, what was explicitly left out, and the questions nobody could answer yet. Do not add requirements nobody mentioned.",
  },
  {
    id: "decision-record",
    name: "Decision record",
    description: "Context, options, the decision and the reason.",
    sections: ["Context", "Options considered", "Decision", "Reason", "Consequences"],
    length: "medium",
    model: "fast",
    prompt:
      "Write a decision record for the main decision of this meeting: the context, the options that were weighed, what was decided, why, and what follows from it. If several decisions were made, write about the most important one and list the others briefly in Consequences.",
  },
  {
    id: "one-to-one-prep",
    name: "One-to-one prep",
    description: "Topics, open items and questions for the next one-to-one.",
    sections: ["Topics covered", "Open items", "Questions for next time", "Feedback given"],
    length: "short",
    model: "fast",
    prompt:
      "Prepare the next one-to-one from this one: what was covered, what is still open for either person, questions to bring next time, and any feedback that was given in either direction.",
  },
  {
    id: "interview-debrief",
    name: "Interview debrief",
    description: "Strengths, concerns and a recommendation.",
    sections: ["Role and candidate", "Strengths", "Concerns", "Evidence", "Recommendation"],
    length: "medium",
    model: "fast",
    prompt:
      "Write a debrief of this interview. Give the strengths and the concerns with the evidence from the conversation for each, and the recommendation if one was stated. Do not judge beyond what was said.",
  },
  {
    id: "stand-up-update",
    name: "Stand-up update",
    description: "Done, next and blockers, per person.",
    sections: ["Done", "Next", "Blockers"],
    length: "short",
    model: "fast",
    prompt:
      "Write the stand-up update: what each person finished, what each person will do next, and what is blocking anyone. Group by person when names were spoken.",
  },
  {
    id: "weekly-digest",
    name: "Weekly digest",
    description: "A digest of the week for a folder of meetings.",
    sections: ["Highlights", "Decisions", "Progress", "Looking ahead"],
    length: "medium",
    model: "fast",
    prompt:
      "Write a digest of the week from these meeting notes: the highlights, the decisions, the progress made and what is coming up. Mention which meeting something came from.",
  },
  {
    id: "email-reply-draft",
    name: "Email reply draft",
    description: "A reply to the email thread pasted into the notes.",
    sections: ["Reply"],
    length: "short",
    model: "fast",
    prompt:
      "The owner's notes contain an email thread. Draft a reply to the last message in it, using what was agreed in the meeting. Keep it short and polite, and do not promise anything that was not agreed.",
  },
  {
    id: "next-meeting-agenda",
    name: "Next meeting agenda",
    description: "An agenda for the next call.",
    sections: ["Goal", "Agenda", "Carried over", "Prepare before"],
    length: "short",
    model: "fast",
    prompt:
      "Draft an agenda for the next meeting on this topic: its goal, the items to discuss in a sensible order, the items carried over from this meeting, and what each person should prepare.",
  },
];

/** The built-in Skills, in the order they are listed. */
export const BUILT_IN_SKILLS: readonly Skill[] = AUTHORED.map((skill) => ({
  ...skill,
  builtIn: true,
  version: 1,
  basedOn: null,
  basedOnVersion: null,
}));

export const NOT_DISCUSSED = "Not discussed";
export const NO_SOURCE = "No source";

// ----------------------------------------------------------------- summaries

export const SUMMARY_FEEDBACK_REASONS = [
  "missed_points",
  "wrong_names",
  "too_long",
  "too_short",
] as const;
export type SummaryFeedbackReason = (typeof SUMMARY_FEEDBACK_REASONS)[number];

export const SUMMARY_FEEDBACK_TEXT: Record<SummaryFeedbackReason, string> = {
  missed_points: "Missed points",
  wrong_names: "Wrong names",
  too_long: "Too long",
  too_short: "Too short",
};

export const summaryFeedbackSchema = z.strictObject({
  rating: z.enum(["up", "down"]),
  reason: z.enum(SUMMARY_FEEDBACK_REASONS).nullable(),
});
export type SummaryFeedback = z.infer<typeof summaryFeedbackSchema>;

/** One generated summary of a meeting. Older versions are kept. */
export interface MeetingSummary {
  id: string;
  meetingId: string;
  /** 1 for the first, then up by one for each new summary of the meeting. */
  version: number;
  skillId: string;
  skillName: string;
  modelId: string;
  /** A quick summary made during the meeting; the final one replaces it. */
  quick: boolean;
  /**
   * Markdown: `##` sections and `-` bullets. A citation is a link `[12:34](seg:<segment id>)`;
   * a bullet without one ends in "(No source)".
   */
  markdown: string;
  createdAt: number;
  feedback: SummaryFeedback | null;
}

export const SUMMARY_LENGTH_SETTINGS = ["short", "medium", "long"] as const;

/** `notetaker.summary` and `notetaker.skills` (NT-09, NT-15). */
export const summarySettingsSchema = z.strictObject({
  /** Write a summary when a recording has been transcribed. */
  auto: z.boolean(),
  length: z.enum(SUMMARY_LENGTH_SETTINGS),
  /** NT-20: the language a summary is written in: the meeting's, or a fixed one. */
  language: z.enum(["meeting", ...meetingLanguageCodes]).default("meeting"),
});
export const DEFAULT_SUMMARY_SETTINGS: z.infer<typeof summarySettingsSchema> = {
  auto: true,
  length: "medium",
  language: "meeting",
};
export const skillsSettingsSchema = z.strictObject({ default: z.string().min(1).max(64) });
export const DEFAULT_SKILLS_SETTINGS: z.infer<typeof skillsSettingsSchema> = {
  default: DEFAULT_SKILL_ID,
};
