import { z } from "zod";

/**
 * Tasks (NT-26). The local model suggests tasks from a finished meeting; they are `suggested`
 * until the owner accepts them, and are never accepted by themselves. My Tasks lists them
 * across meetings.
 */

export const TASK_STATUSES = ["suggested", "open", "done", "archived"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_TEXT: Record<TaskStatus, string> = {
  suggested: "Suggested",
  open: "Open",
  done: "Done",
  archived: "Archived",
};

export const TASK_LIMITS = { title: 200, notes: 2000, owner: 80 } as const;

/** `YYYY-MM-DD` that is a real calendar day. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** What the owner can change on a task. */
export const taskDraftSchema = z.strictObject({
  title: z.string().trim().min(1).max(TASK_LIMITS.title),
  notes: z.string().max(TASK_LIMITS.notes),
  /** A name said in the meeting; null when nobody was named. */
  owner: z.string().trim().min(1).max(TASK_LIMITS.owner).nullable(),
  ownerIsMe: z.boolean(),
  dueOn: z.string().refine(isCalendarDate, "A due date is written YYYY-MM-DD.").nullable(),
});
export type TaskDraft = z.infer<typeof taskDraftSchema>;

export interface Task extends TaskDraft {
  id: string;
  status: TaskStatus;
  source: "meeting" | "manual";
  meetingId: string | null;
  meetingTitle: string | null;
  /** The transcript line the task came from. `removed`: the line is gone (retention). */
  sourceSegmentId: string | null;
  sourceState: "none" | "ok" | "removed";
  position: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export const TASK_OWNER_FILTERS = ["me-or-named", "me", "others", "unassigned", "all"] as const;
export type TaskOwnerFilter = (typeof TASK_OWNER_FILTERS)[number];

export const TASK_OWNER_FILTER_TEXT: Record<TaskOwnerFilter, string> = {
  "me-or-named": "Me or named",
  me: "Me",
  others: "Others",
  unassigned: "Nobody named",
  all: "Everyone",
};

export const taskFilterSchema = z.strictObject({
  /** One status, or all of them. */
  status: z.enum([...TASK_STATUSES, "all"]).optional(),
  owner: z.enum(TASK_OWNER_FILTERS).optional(),
  meetingId: z.string().min(1).max(64).optional(),
});
export type TaskFilter = z.infer<typeof taskFilterSchema>;

export const TASK_ACTIONS = ["accept", "done", "reopen", "archive", "restore"] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

export interface TasksView {
  tasks: Task[];
  /** What Undo would take back, or null when there is nothing to undo. */
  undo: string | null;
}

export type TaskResult = { ok: true; task: Task } | { ok: false; message: string };

/** NT-26: how many actions Undo can take back. */
export const TASK_UNDO_LIMIT = 20;

export const TASK_OWNER_RULES = ["me-or-named", "all"] as const;

/** `notetaker.tasks` (NT-26). */
export const tasksSettingsSchema = z.strictObject({
  /** Suggest tasks after a meeting has been summarised. */
  extract: z.boolean(),
  maxPerMeeting: z.number().int().min(1).max(50),
  /** Which owners My Tasks shows to begin with. */
  ownerRule: z.enum(TASK_OWNER_RULES),
});
export const DEFAULT_TASKS_SETTINGS: z.infer<typeof tasksSettingsSchema> = {
  extract: true,
  maxPerMeeting: 15,
  ownerRule: "me-or-named",
};
