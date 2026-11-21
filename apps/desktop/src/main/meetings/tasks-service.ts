import type { DatabaseSync } from "node:sqlite";
import {
  TASK_UNDO_LIMIT,
  taskDraftSchema,
  type Task,
  type TaskAction,
  type TaskDraft,
  type TaskFilter,
  type TaskResult,
  type TaskStatus,
  type TasksView,
} from "@murmur/shared";

/** A task the model suggested from a meeting. */
export interface SuggestedTask {
  title: string;
  owner: string | null;
  ownerIsMe: boolean;
  dueOn: string | null;
  sourceSegmentId: string | null;
}

export interface TasksService {
  /** In the owner's order (`position`), narrowed by the filter. */
  list(filter?: TaskFilter): TasksView;
  get(id: string): Task | null;
  /** A task written by the owner: open at once, and it can be undone. */
  addManual(draft: unknown): TaskResult;
  /**
   * Adds tasks from a meeting as `suggested`. A task with the title of one the meeting already
   * has (in any state) is skipped. Not an action the owner did, so Undo does not list it.
   * Returns how many were added.
   */
  addSuggested(meetingId: string, tasks: readonly SuggestedTask[]): number;
  update(id: string, draft: unknown): TaskResult;
  act(id: string, action: TaskAction): TaskResult;
  /** Puts a task before another one, or last when `beforeId` is null. */
  reorder(id: string, beforeId: string | null): TaskResult;
  /** Takes back the last action. */
  undo(): { ok: true; label: string } | { ok: false };
  /** How many tasks a meeting has (for the Tasks tab). */
  countFor(meetingId: string): number;
}

interface Row {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  source: "meeting" | "manual";
  meeting_id: string | null;
  owner_name: string | null;
  owner_is_me: number;
  due_on: string | null;
  source_segment_id: string | null;
  position: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface JoinedRow extends Row {
  meeting_title: string | null;
  meeting_folder: string | null;
  source_ok: number;
}

const SELECT = `SELECT t.*, m.title AS meeting_title, m.folder_id AS meeting_folder,
    EXISTS (SELECT 1 FROM meeting_segments s WHERE s.id = t.source_segment_id) AS source_ok
  FROM tasks t LEFT JOIN meetings m ON m.id = t.meeting_id`;

const toTask = (row: JoinedRow): Task => ({
  id: row.id,
  title: row.title,
  notes: row.notes,
  owner: row.owner_name,
  ownerIsMe: row.owner_is_me === 1,
  dueOn: row.due_on,
  status: row.status,
  source: row.source,
  meetingId: row.meeting_id,
  meetingTitle: row.meeting_title,
  sourceSegmentId: row.source_segment_id,
  sourceState: row.source_segment_id === null ? "none" : row.source_ok === 1 ? "ok" : "removed",
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
});

const normal = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const matchesOwner = (task: Task, owner: NonNullable<TaskFilter["owner"]>): boolean => {
  switch (owner) {
    case "me":
      return task.ownerIsMe;
    case "others":
      return !task.ownerIsMe && task.owner !== null;
    case "unassigned":
      return !task.ownerIsMe && task.owner === null;
    case "me-or-named":
      return task.ownerIsMe || task.owner !== null;
    default:
      return true;
  }
};

const NO_TASK = "That task was not found.";

export function createTasksService(
  db: DatabaseSync,
  deps: { newId(): string; now(): number },
): TasksService {
  /** Each entry holds the rows as they were before an action (null: the row did not exist). */
  const undoStack: { label: string; before: Map<string, Row | null> }[] = [];

  const rowOf = (id: string) =>
    db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as unknown as Row | undefined;
  const allRows = () =>
    db.prepare("SELECT * FROM tasks ORDER BY position, rowid").all() as unknown as Row[];
  const get = (id: string): Task | null => {
    const row = db.prepare(`${SELECT} WHERE t.id = ?`).get(id) as unknown as JoinedRow | undefined;
    return row ? toTask(row) : null;
  };
  const maxPosition = (except?: string) =>
    (
      db
        .prepare("SELECT COALESCE(MAX(position), 0) AS p FROM tasks WHERE id IS NOT ?")
        .get(except ?? null) as { p: number }
    ).p;

  const record = (label: string, ids: readonly string[] | "all") => {
    const before = new Map<string, Row | null>();
    if (ids === "all") for (const row of allRows()) before.set(row.id, row);
    else for (const id of ids) before.set(id, rowOf(id) ?? null);
    undoStack.push({ label, before });
    if (undoStack.length > TASK_UNDO_LIMIT) undoStack.shift();
  };

  const insert = (row: Row) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO tasks (id, title, notes, status, source, meeting_id, owner_name,
           owner_is_me, due_on, source_segment_id, position, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.title,
        row.notes,
        row.status,
        row.source,
        row.meeting_id,
        row.owner_name,
        row.owner_is_me,
        row.due_on,
        row.source_segment_id,
        row.position,
        row.created_at,
        row.updated_at,
        row.completed_at,
      );

  const checked = (draft: unknown) => {
    const parsed = taskDraftSchema.safeParse(draft);
    if (parsed.success) return { ok: true as const, draft: parsed.data };
    const field = String(parsed.error.issues[0]?.path[0] ?? "task");
    return { ok: false as const, message: `The ${field} is not valid.` };
  };

  const done = (id: string): TaskResult => {
    const task = get(id);
    return task ? { ok: true, task } : { ok: false, message: NO_TASK };
  };

  const apply = (draft: TaskDraft, row: Row, at: number): Row => ({
    ...row,
    title: draft.title,
    notes: draft.notes,
    owner_name: draft.ownerIsMe ? null : draft.owner,
    owner_is_me: draft.ownerIsMe ? 1 : 0,
    due_on: draft.dueOn,
    updated_at: at,
  });

  return {
    list(filter = {}) {
      const rows = db
        .prepare(`${SELECT} ORDER BY t.position, t.rowid`)
        .all() as unknown as JoinedRow[];
      // The tasks of the meetings in a folder; "inbox" is the meetings in no folder (NT-17).
      const inFolder = (row: JoinedRow) =>
        !filter.folder ||
        (row.meeting_id !== null &&
          (filter.folder === "inbox"
            ? row.meeting_folder === null
            : row.meeting_folder === filter.folder));
      const tasks = rows
        .filter(inFolder)
        .map(toTask)
        .filter(
          (task) => !filter.status || filter.status === "all" || task.status === filter.status,
        )
        .filter((task) => !filter.meetingId || task.meetingId === filter.meetingId)
        .filter((task) => matchesOwner(task, filter.owner ?? "all"));
      return { tasks, undo: undoStack.at(-1)?.label ?? null };
    },

    get,

    addManual(input) {
      const result = checked(input);
      if (!result.ok) return result;
      const at = deps.now();
      const id = deps.newId();
      record("Add task", [id]);
      insert(
        apply(
          result.draft,
          {
            id,
            title: "",
            notes: "",
            status: "open",
            source: "manual",
            meeting_id: null,
            owner_name: null,
            owner_is_me: 0,
            due_on: null,
            source_segment_id: null,
            position: maxPosition() + 1,
            created_at: at,
            updated_at: at,
            completed_at: null,
          },
          at,
        ),
      );
      return done(id);
    },

    addSuggested(meetingId, tasks) {
      const have = new Set(
        (
          db.prepare("SELECT title FROM tasks WHERE meeting_id = ?").all(meetingId) as {
            title: string;
          }[]
        ).map((row) => normal(row.title)),
      );
      const at = deps.now();
      let position = maxPosition();
      let added = 0;
      for (const task of tasks) {
        const key = normal(task.title);
        if (key === "" || have.has(key)) continue;
        have.add(key);
        insert({
          id: deps.newId(),
          title: task.title,
          notes: "",
          status: "suggested",
          source: "meeting",
          meeting_id: meetingId,
          owner_name: task.ownerIsMe ? null : task.owner,
          owner_is_me: task.ownerIsMe ? 1 : 0,
          due_on: task.dueOn,
          source_segment_id: task.sourceSegmentId,
          position: ++position,
          created_at: at,
          updated_at: at,
          completed_at: null,
        });
        added++;
      }
      return added;
    },

    update(id, input) {
      const row = rowOf(id);
      if (!row) return { ok: false, message: NO_TASK };
      const result = checked(input);
      if (!result.ok) return result;
      record("Edit task", [id]);
      insert(apply(result.draft, row, deps.now()));
      return done(id);
    },

    act(id, action) {
      const row = rowOf(id);
      if (!row) return { ok: false, message: NO_TASK };
      const at = deps.now();
      const moves: Record<TaskAction, { from: TaskStatus[]; to: TaskStatus; label: string }> = {
        accept: { from: ["suggested"], to: "open", label: "Accept task" },
        done: { from: ["open"], to: "done", label: "Mark done" },
        reopen: { from: ["done"], to: "open", label: "Reopen task" },
        archive: { from: ["suggested", "open", "done"], to: "archived", label: "Archive task" },
        restore: { from: ["archived"], to: "open", label: "Restore task" },
      };
      const move = moves[action];
      if (!move.from.includes(row.status))
        return { ok: false, message: `A ${row.status} task cannot be changed that way.` };
      record(move.label, [id]);
      insert({
        ...row,
        status: move.to,
        updated_at: at,
        completed_at: move.to === "done" ? at : null,
      });
      return done(id);
    },

    reorder(id, beforeId) {
      const row = rowOf(id);
      if (!row) return { ok: false, message: NO_TASK };
      if (beforeId === id) return done(id);
      const target = beforeId === null ? null : rowOf(beforeId);
      if (beforeId !== null && !target) return { ok: false, message: NO_TASK };
      record("Move task", "all");
      const place = (): number => {
        if (!target) return maxPosition(id) + 1;
        const earlier = allRows().filter(
          (other) => other.id !== id && other.position < target.position,
        );
        const previous = earlier.at(-1);
        return previous ? (previous.position + target.position) / 2 : target.position - 1;
      };
      let position = place();
      const crowded = (value: number) =>
        allRows().some((other) => other.id !== id && Math.abs(other.position - value) < 1e-9);
      if (crowded(position)) {
        // The gaps ran out: number every task again, keeping the order.
        allRows().forEach((other, index) =>
          db.prepare("UPDATE tasks SET position = ? WHERE id = ?").run(index + 1, other.id),
        );
        const fresh = beforeId === null ? null : rowOf(beforeId);
        const others = allRows().filter((other) => other.id !== id);
        const index = fresh ? others.findIndex((other) => other.id === fresh.id) : others.length;
        const previous = others[index - 1];
        position = !fresh
          ? (others.at(-1)?.position ?? 0) + 1
          : previous
            ? (previous.position + fresh.position) / 2
            : fresh.position - 1;
      }
      db.prepare("UPDATE tasks SET position = ?, updated_at = ? WHERE id = ?").run(
        position,
        deps.now(),
        id,
      );
      return done(id);
    },

    undo() {
      const entry = undoStack.pop();
      if (!entry) return { ok: false };
      for (const [id, row] of entry.before) {
        if (row) insert(row);
        else db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
      }
      return { ok: true, label: entry.label };
    },

    countFor: (meetingId) =>
      (
        db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE meeting_id = ?").get(meetingId) as {
          n: number;
        }
      ).n,
  };
}
