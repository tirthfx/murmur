import {
  DEFAULT_SKILL_ID,
  BUILT_IN_SKILLS,
  type MeetingSegment,
  type MeetingSummary,
  type Skill,
  type SkillLength,
} from "@murmur/shared";
import type { Logger } from "../helper/types";
import { titleFromSummary } from "./meeting-title";
import { createModelAsk } from "./model-ask";
import { summarizeMeeting } from "./summarizer";
import type { SkillsStore, SummariesStore } from "./summaries-store";

export type SummaryErrorCode = "model-missing" | "no-transcript" | "busy" | "no-skill" | "failed";

export class SummaryError extends Error {
  constructor(
    readonly code: SummaryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SummaryError";
  }
}

/** What the Summary tab shows besides the summaries. */
export type SummaryStatus =
  | { state: "idle" }
  | { state: "running"; done: number; total: number }
  | { state: "failed"; message: string };

export interface SummaryRunnerDeps {
  hasMeeting(meetingId: string): boolean;
  segments(meetingId: string): MeetingSegment[];
  notes(meetingId: string): string;
  summaries: Pick<SummariesStore, "add">;
  skills: Pick<SkillsStore, "get">;
  settings(): { skillId: string; length: SkillLength; language?: string };
  /** NT-05: names a meeting from its summary, when it still has the name it was given. */
  title?: {
    wanted(meetingId: string): boolean;
    set(meetingId: string, title: string): void;
  };
  /** The Skill set for the folder a meeting is in (NT-17), or null. */
  folderSkill?(meetingId: string): string | null;
  modelId: string;
  modelReady(): Promise<boolean>;
  /** One call of the local model. A cancelled or preempted call rejects with `retry: true`. */
  generate(request: { system: string; prompt: string; maxTokens: number }): Promise<string>;
  /** True while a dictation is recording or being transcribed. */
  dictating(): boolean;
  /** True while a Rewrite, Command or Instruct generation uses the model. */
  generating(): boolean;
  wait(ms: number): Promise<void>;
  now(): number;
  newId(): string;
  /** The status or the summaries of a meeting changed. */
  onChange(meetingId: string): void;
  logger: Logger;
}

export interface SummaryRunner {
  /**
   * Writes a summary and stores it as the next version. `skillId` defaults to the setting.
   * Throws a SummaryError; at most one summary is written at a time.
   */
  run(meetingId: string, options?: { skillId?: string; quick?: boolean }): Promise<MeetingSummary>;
  status(meetingId: string): SummaryStatus;
}

/**
 * Runs summaries (NT-09). The model is shared: a dictation always goes first, and a Rewrite,
 * Command or Instruct generation is never cancelled by a summary (the newest request would
 * win), so every step waits until they are done. A step the model dropped is asked again.
 */
export function createSummaryRunner(deps: SummaryRunnerDeps): SummaryRunner {
  const states = new Map<string, SummaryStatus>();
  let running: string | null = null;

  const set = (meetingId: string, status: SummaryStatus | null) => {
    if (status) states.set(meetingId, status);
    else states.delete(meetingId);
    deps.onChange(meetingId);
  };

  const ask = createModelAsk(deps);

  /** A meeting that cannot be named keeps its name: the summary is already saved. */
  async function retitle(meetingId: string, markdown: string): Promise<void> {
    if (!deps.title?.wanted(meetingId)) return;
    try {
      const title = await titleFromSummary(ask, markdown);
      if (!title) return;
      deps.title.set(meetingId, title);
      deps.onChange(meetingId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.logger.warn(`meeting ${meetingId} could not be named: ${message}`);
    }
  }

  return {
    status: (meetingId) => states.get(meetingId) ?? { state: "idle" },

    async run(meetingId, options = {}) {
      if (running !== null)
        throw new SummaryError("busy", "A summary is being written. Try again when it is done.");
      if (!deps.hasMeeting(meetingId)) throw new SummaryError("failed", "That meeting is gone.");
      const settings = deps.settings();
      const skill: Skill | null =
        deps.skills.get(options.skillId ?? deps.folderSkill?.(meetingId) ?? settings.skillId) ??
        BUILT_IN_SKILLS.find((candidate) => candidate.id === DEFAULT_SKILL_ID) ??
        null;
      if (!skill) throw new SummaryError("no-skill", "That Skill was not found.");
      const segments = deps
        .segments(meetingId)
        .filter((segment) => !segment.isDictated)
        .map((segment) => ({
          id: segment.id,
          channel: segment.channel,
          startMs: segment.startMs,
          text: segment.text,
        }));
      if (segments.length === 0)
        throw new SummaryError("no-transcript", "There is no transcript to summarise yet.");
      if (!(await deps.modelReady()))
        throw new SummaryError(
          "model-missing",
          "The language model is not downloaded. Get it in Settings.",
        );
      running = meetingId;
      set(meetingId, { state: "running", done: 0, total: 1 });
      try {
        const markdown = await summarizeMeeting(
          {
            generate: ask,
            onProgress: (done, total) => set(meetingId, { state: "running", done, total }),
          },
          {
            segments,
            notes: deps.notes(meetingId),
            skill,
            length: skill.length === "medium" ? settings.length : skill.length,
            ...(settings.language ? { language: settings.language } : {}),
          },
        );
        const summary = deps.summaries.add({
          id: deps.newId(),
          meetingId,
          skill,
          modelId: deps.modelId,
          quick: options.quick === true,
          markdown,
          at: deps.now(),
        });
        set(meetingId, null);
        if (!summary.quick) await retitle(meetingId, markdown);
        return summary;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.logger.warn(`summary of meeting ${meetingId} failed: ${message}`);
        set(meetingId, {
          state: "failed",
          message: "The summary could not be written. Try again.",
        });
        throw error instanceof SummaryError ? error : new SummaryError("failed", message);
      } finally {
        running = null;
      }
    },
  };
}
