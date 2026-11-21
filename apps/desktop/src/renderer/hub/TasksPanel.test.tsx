// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@murmur/shared";
import { TasksPanel } from "./TasksPanel";
import { createMockApi } from "./test-api";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Send the budget",
  notes: "",
  owner: null,
  ownerIsMe: true,
  dueOn: "2026-11-27",
  status: "suggested",
  source: "meeting",
  meetingId: "m-1",
  meetingTitle: "Design sync",
  sourceSegmentId: "m-1:mic:1:0",
  sourceState: "ok",
  position: 1,
  createdAt: 1,
  updatedAt: 1,
  completedAt: null,
  ...over,
});

let api: ReturnType<typeof createMockApi>;
const open = vi.fn();

beforeEach(() => {
  api = createMockApi();
  open.mockClear();
  api.tasksList = vi.fn().mockResolvedValue({
    tasks: [
      task(),
      task({
        id: "t2",
        title: "Book the room",
        owner: "Priya",
        ownerIsMe: false,
        dueOn: null,
        position: 2,
      }),
      task({ id: "t3", title: "Old thing", status: "done", position: 3, sourceState: "removed" }),
    ],
    undo: null,
  });
  api.taskAction = vi.fn().mockResolvedValue({ ok: true, task: task() });
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

const list = async () => within(await screen.findByRole("list", { name: "Tasks" }));

describe("My Tasks (NT-26)", () => {
  it("lists suggested and open tasks with owner, due date and meeting, hiding done ones", async () => {
    render(<TasksPanel onOpenSource={open} />);
    const tasks = await list();
    expect(tasks.getByText("Send the budget")).toBeTruthy();
    expect(tasks.getByText("Book the room")).toBeTruthy();
    expect(tasks.queryByText("Old thing")).toBeNull();
    expect(tasks.getAllByText("Suggested")).toHaveLength(2);
    expect(tasks.getByText("Priya")).toBeTruthy();
    expect(tasks.getByText(/^Due .*2026/)).toBeTruthy();
    expect(tasks.getAllByText("From Design sync")).toHaveLength(2);
  });

  it("asks for tasks by the owner rule in Settings", async () => {
    render(<TasksPanel onOpenSource={open} />);
    await list();
    await waitFor(() =>
      expect(api.tasksList).toHaveBeenLastCalledWith({ status: "all", owner: "me-or-named" }),
    );
  });

  it("accepts a suggested task, and never does it by itself", async () => {
    render(<TasksPanel onOpenSource={open} />);
    const tasks = await list();
    expect(api.taskAction).not.toHaveBeenCalled();
    fireEvent.click(tasks.getByRole("button", { name: "Accept “Send the budget”" }));
    await waitFor(() => expect(api.taskAction).toHaveBeenCalledWith("t1", "accept"));
  });

  it("dismisses a suggestion as an archive", async () => {
    render(<TasksPanel onOpenSource={open} />);
    const tasks = await list();
    fireEvent.click(tasks.getByRole("button", { name: "Dismiss “Book the room”" }));
    await waitFor(() => expect(api.taskAction).toHaveBeenCalledWith("t2", "archive"));
  });

  it("opens the source line, and says when it was removed", async () => {
    render(<TasksPanel onOpenSource={open} />);
    const tasks = await list();
    fireEvent.click(
      tasks.getByRole("button", { name: /Open the transcript where “Send the budget”/ }),
    );
    expect(open).toHaveBeenCalledWith("m-1", "m-1:mic:1:0");
    cleanup();
    api.tasksList = vi
      .fn()
      .mockResolvedValue({ tasks: [task({ sourceState: "removed" })], undo: null });
    render(<TasksPanel onOpenSource={open} />);
    expect(await screen.findByText("Source removed")).toBeTruthy();
  });

  it("changes the filters", async () => {
    render(<TasksPanel onOpenSource={open} />);
    await list();
    fireEvent.click(screen.getByRole("combobox", { name: "Show" }));
    fireEvent.click(await screen.findByRole("option", { name: "Done" }));
    expect((await list()).getByText("Old thing")).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: "Owner" }));
    fireEvent.click(await screen.findByRole("option", { name: "Nobody named" }));
    await waitFor(() =>
      expect(api.tasksList).toHaveBeenLastCalledWith({ status: "all", owner: "unassigned" }),
    );
  });

  it("edits a task, checking the due date before sending", async () => {
    api.taskUpdate = vi.fn().mockResolvedValue({ ok: true, task: task() });
    render(<TasksPanel onOpenSource={open} />);
    const tasks = await list();
    fireEvent.click(tasks.getByRole("button", { name: "Edit “Send the budget”" }));
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-02-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the task" }));
    expect(await screen.findByText(/YYYY-MM-DD/)).toBeTruthy();
    expect(api.taskUpdate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "Send the budget today" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the task" }));
    await waitFor(() =>
      expect(api.taskUpdate).toHaveBeenCalledWith("t1", {
        title: "Send the budget today",
        notes: "",
        owner: null,
        ownerIsMe: true,
        dueOn: "2026-12-01",
      }),
    );
  });

  it("adds a task by hand", async () => {
    api.taskAdd = vi.fn().mockResolvedValue({ ok: true, task: task() });
    render(<TasksPanel onOpenSource={open} />);
    await list();
    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    fireEvent.click(screen.getByRole("button", { name: "Add the task" }));
    expect(await screen.findByText("Write what has to be done.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "Call Sam" } });
    fireEvent.click(screen.getByRole("button", { name: "Add the task" }));
    await waitFor(() =>
      expect(api.taskAdd).toHaveBeenCalledWith({
        title: "Call Sam",
        notes: "",
        owner: null,
        ownerIsMe: true,
        dueOn: null,
      }),
    );
  });

  it("moves a task with the buttons and by dragging", async () => {
    api.taskReorder = vi.fn().mockResolvedValue({ ok: true, task: task() });
    render(<TasksPanel onOpenSource={open} />);
    const tasks = await list();
    // Down on the first of two: it goes last.
    fireEvent.click(tasks.getByRole("button", { name: "Move “Send the budget” down" }));
    await waitFor(() => expect(api.taskReorder).toHaveBeenCalledWith("t1", null));
    // Up on the second: before the first.
    fireEvent.click(tasks.getByRole("button", { name: "Move “Book the room” up" }));
    await waitFor(() => expect(api.taskReorder).toHaveBeenCalledWith("t2", "t1"));
    expect(tasks.getByRole("button", { name: "Move “Send the budget” up" })).toHaveProperty(
      "disabled",
      true,
    );

    const items = document.querySelectorAll("li.hub-task");
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
    };
    fireEvent.dragStart(items[1]!, { dataTransfer });
    fireEvent.dragOver(items[0]!, { dataTransfer });
    fireEvent.drop(items[0]!, { dataTransfer });
    await waitFor(() => expect(api.taskReorder).toHaveBeenLastCalledWith("t2", "t1"));
  });

  it("undoes the last action by name", async () => {
    api.tasksList = vi.fn().mockResolvedValue({ tasks: [task()], undo: "Accept task" });
    api.tasksUndo = vi.fn().mockResolvedValue({ ok: true, label: "Accept task" });
    render(<TasksPanel onOpenSource={open} />);
    fireEvent.click(await screen.findByRole("button", { name: "Undo: Accept task" }));
    await waitFor(() => expect(api.tasksUndo).toHaveBeenCalled());
  });

  it("disables Undo when there is nothing to take back", async () => {
    render(<TasksPanel onOpenSource={open} />);
    await list();
    expect(screen.getByRole("button", { name: "Undo" })).toHaveProperty("disabled", true);
  });

  it("for one meeting, shows its tasks, hides the meeting filter and can look for tasks", async () => {
    api.tasksList = vi.fn().mockResolvedValue({ tasks: [], undo: null });
    render(<TasksPanel meetingId="m-1" taskStatus={{ state: "idle" }} onOpenSource={open} />);
    expect(await screen.findByText("No tasks for this meeting.")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Meeting" })).toBeNull();
    expect(api.tasksList).toHaveBeenCalledWith(expect.objectContaining({ meetingId: "m-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Look for tasks in this meeting" }));
    await waitFor(() => expect(api.meetingFindTasks).toHaveBeenCalledWith("m-1"));
  });

  it("says when tasks are being looked for or could not be found", async () => {
    api.tasksList = vi.fn().mockResolvedValue({ tasks: [], undo: null });
    const { rerender } = render(
      <TasksPanel meetingId="m-1" taskStatus={{ state: "running" }} onOpenSource={open} />,
    );
    expect(await screen.findByText("Looking for tasks in this meeting…")).toBeTruthy();
    rerender(<TasksPanel meetingId="m-1" taskStatus={{ state: "waiting" }} onOpenSource={open} />);
    expect(screen.getByText(/once the summary and the language model are ready/)).toBeTruthy();
    rerender(
      <TasksPanel
        meetingId="m-1"
        taskStatus={{ state: "failed", message: "Tasks could not be found. Try again." }}
        onOpenSource={open}
      />,
    );
    expect(screen.getByText("Tasks could not be found. Try again.")).toBeTruthy();
  });
});
