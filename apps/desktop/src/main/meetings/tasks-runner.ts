import type { Logger } from "../helper/types";
import type { MeetingSegment } from "@murmur/shared";
import { createModelAsk, type ModelAskDeps } from "./model-ask";
import { extractTasks } from "./tasks-extractor";
import type { TasksService } from "./tasks-service";

export type TaskErrorCode = "model-missing" | "no-transcript" | "busy" | "failed";

export class TaskError extends Error {
  constructor(
    readonly code: TaskErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TaskError";
  }
}

/** What the Tasks tab shows besides the tasks. */
export type TaskStatus =
  { state: "idle" } | { state: "running" } | { state: "failed"; message: string };

export interface TaskRunnerDeps extends ModelAskDeps {
  hasMeeting(meetingId: string): boolean;
  startedAt(meetingId: string): number;
  segments(meetingId: string): MeetingSegment[];
  tasks: Pick<TasksService, "addSuggested">;
  maxPerMeeting(): number;
  modelReady(): Promise<boolean>;
  /** The status or the tasks of a meeting changed. */
  onChange(meetingId: string): void;
  logger: Logger;
}

export interface TaskRunner {
  /**
   * Suggests tasks for a meeting. Returns how many were added, and a `note` when the model
   * could not give valid JSON (the meeting then has no new tasks). Throws a TaskError; at most
   * one meeting is read at a time.
   */
  run(meetingId: string): Promise<{ added: number; note?: string }>;
  status(meetingId: string): TaskStatus;
}

/** Runs the extraction pass (NT-26) on the shared local model. */
export function createTaskRunner(deps: TaskRunnerDeps): TaskRunner {
  const states = new Map<string, TaskStatus>();
  let running: string | null = null;
  const ask = createModelAsk(deps);
  const set = (meetingId: string, status: TaskStatus | null) => {
    if (status) states.set(meetingId, status);
    else states.delete(meetingId);
    deps.onChange(meetingId);
  };

  return {
    status: (meetingId) => states.get(meetingId) ?? { state: "idle" },

    async run(meetingId) {
      if (running !== null)
        throw new TaskError("busy", "Tasks are being found for another meeting.");
      if (!deps.hasMeeting(meetingId)) throw new TaskError("failed", "That meeting is gone.");
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
        throw new TaskError("no-transcript", "There is no transcript to find tasks in.");
      if (!(await deps.modelReady()))
        throw new TaskError("model-missing", "The language model is not downloaded.");
      running = meetingId;
      set(meetingId, { state: "running" });
      try {
        const result = await extractTasks(
          { generate: ask },
          {
            segments,
            meetingStartedAt: deps.startedAt(meetingId),
            max: deps.maxPerMeeting(),
          },
        );
        set(meetingId, null);
        if (!result.ok) {
          deps.logger.warn(`no tasks for meeting ${meetingId}: ${result.reason}`);
          return { added: 0, note: result.reason };
        }
        const added = deps.tasks.addSuggested(meetingId, result.tasks);
        deps.onChange(meetingId);
        return { added };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.logger.warn(`finding tasks for meeting ${meetingId} failed: ${message}`);
        set(meetingId, { state: "failed", message: "Tasks could not be found. Try again." });
        throw error instanceof TaskError ? error : new TaskError("failed", message);
      } finally {
        running = null;
      }
    },
  };
}
