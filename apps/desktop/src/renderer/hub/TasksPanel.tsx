import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { CalendarEventCreate } from "./CalendarEventCreate";
import { EmailDraft } from "./EmailDraft";
import { SlackPost } from "./SlackPost";
import {
  TASK_LIMITS,
  TASK_OWNER_FILTERS,
  TASK_OWNER_FILTER_TEXT,
  TASK_STATUS_TEXT,
  INBOX,
  isCalendarDate,
  type MeetingFolder,
  type MeetingListItem,
  type Task,
  type TaskAction,
  type TaskDraft,
  type TaskOwnerFilter,
  type TaskRunStatus,
  type TaskStatus,
} from "@murmur/shared";

type StatusView = "active" | TaskStatus | "all";

const STATUS_VIEWS: { value: StatusView; label: string }[] = [
  { value: "active", label: "Suggested and open" },
  { value: "suggested", label: "Suggested" },
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

const inView = (task: Task, view: StatusView) =>
  view === "all" ||
  (view === "active"
    ? task.status === "suggested" || task.status === "open"
    : task.status === view);

const dueText = (dueOn: string) =>
  new Date(`${dueOn}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const toDraft = (task: Task): TaskDraft => ({
  title: task.title,
  notes: task.notes,
  owner: task.owner,
  ownerIsMe: task.ownerIsMe,
  dueOn: task.dueOn,
});

function TaskEditor({
  start,
  isNew,
  onSave,
  onCancel,
}: {
  start: TaskDraft;
  isNew: boolean;
  onSave: (draft: TaskDraft) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(start.title);
  const [notes, setNotes] = useState(start.notes);
  const [owner, setOwner] = useState(start.owner ?? "");
  const [mine, setMine] = useState(start.ownerIsMe);
  const [due, setDue] = useState(start.dueOn ?? "");
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    if (title.trim() === "") return setMessage("Write what has to be done.");
    if (title.trim().length > TASK_LIMITS.title)
      return setMessage(`The task can be up to ${TASK_LIMITS.title} characters.`);
    if (due.trim() !== "" && !isCalendarDate(due.trim()))
      return setMessage("Write the due date as YYYY-MM-DD, or leave it empty.");
    setMessage(null);
    const problem = await onSave({
      title: title.trim(),
      notes,
      owner: mine || owner.trim() === "" ? null : owner.trim(),
      ownerIsMe: mine,
      dueOn: due.trim() === "" ? null : due.trim(),
    });
    if (problem) setMessage(problem);
  }

  return (
    <VStack gap={2}>
      <TextInput label="Task" value={title} onChange={setTitle} />
      <Switch label="This task is mine" value={mine} onChange={setMine} />
      {mine ? null : (
        <TextInput
          label="Owner"
          description="A name said in the meeting. Leave it empty if nobody was named."
          value={owner}
          onChange={setOwner}
        />
      )}
      <TextInput label="Due date" placeholder="YYYY-MM-DD" value={due} onChange={setDue} />
      <TextArea label="Notes" rows={3} value={notes} onChange={setNotes} />
      {message ? <Banner status="warning" title={message} /> : null}
      <HStack gap={2}>
        <Button
          variant="primary"
          label={isNew ? "Add the task" : "Save the task"}
          onClick={() => void save()}
        >
          {isNew ? "Add task" : "Save"}
        </Button>
        <Button variant="secondary" label="Cancel editing" onClick={onCancel}>
          Cancel
        </Button>
      </HStack>
    </VStack>
  );
}

/**
 * NT-26: the tasks of every meeting (My Tasks), or of one meeting when `meetingId` is given.
 * Tasks suggested from a meeting wait here until they are accepted.
 */
export function TasksPanel({
  meetingId = null,
  taskStatus,
  onOpenSource,
}: {
  meetingId?: string | null;
  taskStatus?: TaskRunStatus;
  onOpenSource: (meetingId: string, segmentId: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusView>("active");
  const [owner, setOwner] = useState<TaskOwnerFilter>("me-or-named");
  const [meetingFilter, setMeetingFilter] = useState<string>("");
  const [folderFilter, setFolderFilter] = useState<string>("");
  const [folders, setFolders] = useState<MeetingFolder[]>([]);
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const dragging = useRef<string | null>(null);

  const scope = meetingId ?? (meetingFilter || undefined);
  const load = useCallback(async () => {
    const view = await window.murmur.tasksList({
      status: "all",
      owner,
      ...(scope ? { meetingId: scope } : {}),
      ...(folderFilter ? { folder: folderFilter } : {}),
    });
    setTasks(view.tasks);
    setUndo(view.undo);
  }, [owner, scope, folderFilter]);

  useEffect(() => {
    void load().catch(() => setTasks([]));
    return window.murmur.onMeetingsChanged(() => void load());
  }, [load]);

  // The owner rule in Settings says which owners to show first.
  useEffect(() => {
    void window.murmur.getSettings().then((view) => {
      setOwner(
        meetingId
          ? "all"
          : view.settings.notetaker.tasks.ownerRule === "all"
            ? "all"
            : "me-or-named",
      );
    });
  }, [meetingId]);
  useEffect(() => {
    if (meetingId) return;
    void window.murmur.meetingsList().then(setMeetings);
    void window.murmur.foldersList().then(setFolders);
  }, [meetingId]);

  const shown = (tasks ?? []).filter((task) => inView(task, status));

  async function run(action: Promise<{ ok: boolean; message?: string }>) {
    setMessage(null);
    const result = await action;
    if (!result.ok && result.message) setMessage(result.message);
    await load();
  }

  async function move(task: Task, direction: "up" | "down") {
    const index = shown.findIndex((other) => other.id === task.id);
    const before =
      direction === "up" ? (shown[index - 1]?.id ?? null) : (shown[index + 2]?.id ?? null);
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === shown.length - 1) return;
    await run(window.murmur.taskReorder(task.id, before));
  }

  const act = (task: Task, action: TaskAction) => run(window.murmur.taskAction(task.id, action));

  const sourceOf = (task: Task) =>
    task.sourceState === "ok" && task.meetingId && task.sourceSegmentId ? (
      <Button
        size="sm"
        variant="secondary"
        label={`Open the transcript where “${task.title}” was said`}
        onClick={() => onOpenSource(task.meetingId!, task.sourceSegmentId!)}
      >
        Source
      </Button>
    ) : task.sourceState === "removed" ? (
      <Text size="sm" color="secondary">
        Source removed
      </Text>
    ) : null;

  return (
    <VStack gap={3}>
      <HStack gap={2} align="end" wrap="wrap">
        <Selector
          label="Show"
          value={status}
          options={STATUS_VIEWS}
          onChange={(value) => setStatus(value as StatusView)}
        />
        <Selector
          label="Owner"
          value={owner}
          options={TASK_OWNER_FILTERS.map((value) => ({
            value,
            label: TASK_OWNER_FILTER_TEXT[value],
          }))}
          onChange={(value) => setOwner(value as TaskOwnerFilter)}
        />
        {meetingId ? null : (
          <Selector
            label="Folder"
            value={folderFilter}
            options={[
              { value: "", label: "All folders" },
              { value: INBOX, label: "Inbox" },
              ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
            ]}
            onChange={setFolderFilter}
          />
        )}
        {meetingId ? null : (
          <Selector
            label="Meeting"
            value={meetingFilter}
            options={[
              { value: "", label: "All meetings" },
              ...meetings.map((meeting) => ({ value: meeting.id, label: meeting.title })),
            ]}
            onChange={(value) => setMeetingFilter(value)}
          />
        )}
        <Button variant="secondary" label="New task" onClick={() => setEditing("new")}>
          New task
        </Button>
        <Button
          variant="secondary"
          label={undo ? `Undo: ${undo}` : "Undo"}
          isDisabled={undo === null}
          onClick={() => void run(window.murmur.tasksUndo().then((r) => ({ ok: r.ok })))}
        >
          {undo ? `Undo: ${undo}` : "Undo"}
        </Button>
      </HStack>
      {message ? <Banner status="warning" title={message} /> : null}
      {taskStatus?.state === "running" ? (
        <Text size="sm" color="secondary" role="status">
          Looking for tasks in this meeting…
        </Text>
      ) : taskStatus?.state === "waiting" ? (
        <Text size="sm" color="secondary" role="status">
          Tasks are looked for once the summary and the language model are ready.
        </Text>
      ) : taskStatus?.state === "failed" ? (
        <Banner status="warning" title={taskStatus.message} />
      ) : null}
      {editing === "new" ? (
        <TaskEditor
          isNew
          start={{ title: "", notes: "", owner: null, ownerIsMe: true, dueOn: null }}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            const result = await window.murmur.taskAdd(draft);
            if (!result.ok) return result.message;
            setEditing(null);
            await load();
            return null;
          }}
        />
      ) : null}
      {tasks === null ? (
        <Text color="secondary">Loading…</Text>
      ) : shown.length === 0 ? (
        <VStack gap={2}>
          <Text color="secondary">
            {meetingId
              ? "No tasks for this meeting."
              : "No tasks here. Tasks suggested from your meetings show up as Suggested."}
          </Text>
          {meetingId && taskStatus?.state !== "running" && taskStatus?.state !== "waiting" ? (
            <div>
              <Button
                variant="secondary"
                label="Look for tasks in this meeting"
                onClick={() => void run(window.murmur.meetingFindTasks(meetingId))}
              >
                Look for tasks
              </Button>
            </div>
          ) : null}
        </VStack>
      ) : (
        <ul className="hub-task-list" aria-label="Tasks">
          {shown.map((task, index) => (
            <li
              key={task.id}
              className="hub-task"
              draggable={editing === null}
              onDragStart={(event) => {
                dragging.current = task.id;
                event.dataTransfer?.setData("text/plain", task.id);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const from = dragging.current;
                dragging.current = null;
                if (from && from !== task.id) void run(window.murmur.taskReorder(from, task.id));
              }}
            >
              {editing === task.id ? (
                <TaskEditor
                  isNew={false}
                  start={toDraft(task)}
                  onCancel={() => setEditing(null)}
                  onSave={async (draft) => {
                    const result = await window.murmur.taskUpdate(task.id, draft);
                    if (!result.ok) return result.message;
                    setEditing(null);
                    await load();
                    return null;
                  }}
                />
              ) : (
                <VStack gap={1}>
                  <HStack gap={2} align="center" wrap="wrap">
                    <Text weight="semibold">{task.title}</Text>
                    <Badge
                      variant={task.status === "suggested" ? "info" : "neutral"}
                      label={TASK_STATUS_TEXT[task.status]}
                    />
                    {task.ownerIsMe ? <Badge variant="neutral" label="Me" /> : null}
                    {task.owner ? <Badge variant="neutral" label={task.owner} /> : null}
                    {task.dueOn ? (
                      <Badge variant="neutral" label={`Due ${dueText(task.dueOn)}`} />
                    ) : null}
                  </HStack>
                  {task.notes ? (
                    <Text size="sm" color="secondary">
                      {task.notes}
                    </Text>
                  ) : null}
                  {task.meetingTitle && !meetingId ? (
                    <Text size="sm" color="secondary">
                      From {task.meetingTitle}
                    </Text>
                  ) : null}
                  <HStack gap={1} wrap="wrap" align="center">
                    {task.status === "suggested" ? (
                      <Button
                        size="sm"
                        variant="primary"
                        label={`Accept “${task.title}”`}
                        onClick={() => void act(task, "accept")}
                      >
                        Accept
                      </Button>
                    ) : null}
                    {task.status === "open" ? (
                      <Button
                        size="sm"
                        variant="primary"
                        label={`Mark “${task.title}” done`}
                        onClick={() => void act(task, "done")}
                      >
                        Done
                      </Button>
                    ) : null}
                    {task.status === "done" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        label={`Reopen “${task.title}”`}
                        onClick={() => void act(task, "reopen")}
                      >
                        Reopen
                      </Button>
                    ) : null}
                    {task.status === "archived" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        label={`Restore “${task.title}”`}
                        onClick={() => void act(task, "restore")}
                      >
                        Restore
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        label={`${task.status === "suggested" ? "Dismiss" : "Archive"} “${task.title}”`}
                        onClick={() => void act(task, "archive")}
                      >
                        {task.status === "suggested" ? "Dismiss" : "Archive"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      label={`Edit “${task.title}”`}
                      onClick={() => setEditing(task.id)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      label={`Move “${task.title}” up`}
                      isDisabled={index === 0}
                      onClick={() => void move(task, "up")}
                    >
                      Up
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      label={`Move “${task.title}” down`}
                      isDisabled={index === shown.length - 1}
                      onClick={() => void move(task, "down")}
                    >
                      Down
                    </Button>
                    {sourceOf(task)}
                  </HStack>
                  {task.status === "open" ? (
                    <>
                      <EmailDraft source={{ kind: "task", id: task.id }} />
                      <CalendarEventCreate source={{ kind: "task", id: task.id }} />
                      <SlackPost source={{ kind: "task", id: task.id }} />
                    </>
                  ) : null}
                </VStack>
              )}
            </li>
          ))}
        </ul>
      )}
    </VStack>
  );
}
