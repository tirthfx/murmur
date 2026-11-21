import { describe, expect, it } from "vitest";
import { TASK_UNDO_LIMIT } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createFoldersStore } from "./folders-store";
import { createMeetingsStore } from "./meetings-store";
import { createTasksService, type SuggestedTask } from "./tasks-service";

function setup() {
  const db = openDatabase(":memory:");
  const meetings = createMeetingsStore(db);
  meetings.create({ id: "m-1", title: "Sync", startedAt: 1, source: "ad_hoc", folder: "/f" });
  meetings.create({ id: "m-2", title: "Review", startedAt: 2, source: "ad_hoc", folder: "/g" });
  let n = 0;
  let clock = 1000;
  const tasks = createTasksService(db, { newId: () => `t-${++n}`, now: () => ++clock });
  return { db, meetings, tasks };
}

const suggested = (title: string, over: Partial<SuggestedTask> = {}): SuggestedTask => ({
  title,
  owner: null,
  ownerIsMe: false,
  dueOn: null,
  sourceSegmentId: null,
  ...over,
});

const draft = (title: string, over: Record<string, unknown> = {}) => ({
  title,
  notes: "",
  owner: null,
  ownerIsMe: false,
  dueOn: null,
  ...over,
});

const titles = (t: ReturnType<typeof setup>, filter = {}) =>
  t.tasks.list(filter).tasks.map((task) => task.title);

describe("tasks from a meeting", () => {
  it("adds suggested tasks with owner, due date and source, never accepted", () => {
    const t = setup();
    const added = t.tasks.addSuggested("m-1", [
      suggested("Send the budget", {
        ownerIsMe: true,
        dueOn: "2026-11-27",
        sourceSegmentId: "m-1:mic:1:0",
      }),
      suggested("Book the room", { owner: "Priya" }),
    ]);
    expect(added).toBe(2);
    const [first, second] = t.tasks.list().tasks;
    expect(first).toMatchObject({
      title: "Send the budget",
      status: "suggested",
      source: "meeting",
      ownerIsMe: true,
      owner: null,
      dueOn: "2026-11-27",
      meetingTitle: "Sync",
      sourceSegmentId: "m-1:mic:1:0",
    });
    expect(second).toMatchObject({ owner: "Priya", status: "suggested" });
    expect(t.tasks.countFor("m-1")).toBe(2);
  });

  it("skips a title the meeting already has, in any state", () => {
    const t = setup();
    t.tasks.addSuggested("m-1", [suggested("Send the budget")]);
    const id = t.tasks.list().tasks[0]!.id;
    t.tasks.act(id, "archive");
    expect(t.tasks.addSuggested("m-1", [suggested("send the budget!"), suggested("New one")])).toBe(
      1,
    );
    // Another meeting may have the same task.
    expect(t.tasks.addSuggested("m-2", [suggested("Send the budget")])).toBe(1);
  });

  it("points at a segment that is removed", () => {
    const t = setup();
    t.db
      .prepare(
        `INSERT INTO meeting_segments (id, meeting_id, channel, start_ms, end_ms, text, is_dictated, is_final, created_at)
         VALUES ('m-1:mic:1:0', 'm-1', 'mic', 0, 1000, 'hi', 0, 1, 1)`,
      )
      .run();
    t.tasks.addSuggested("m-1", [
      suggested("A", { sourceSegmentId: "m-1:mic:1:0" }),
      suggested("B"),
    ]);
    expect(t.tasks.list().tasks.map((x) => x.sourceState)).toEqual(["ok", "none"]);
    t.db.prepare("DELETE FROM meeting_segments").run();
    expect(t.tasks.list().tasks.map((x) => x.sourceState)).toEqual(["removed", "none"]);
  });

  it("drops suggested tasks with their meeting, keeps accepted ones", () => {
    const t = setup();
    t.tasks.addSuggested("m-1", [suggested("Keep"), suggested("Lose")]);
    t.tasks.act(t.tasks.list().tasks[0]!.id, "accept");
    t.meetings.remove("m-1");
    expect(titles(t)).toEqual(["Keep"]);
    expect(t.tasks.list().tasks[0]!.meetingId).toBeNull();
  });
});

describe("filters", () => {
  it("narrows by status, owner and meeting", () => {
    const t = setup();
    t.tasks.addSuggested("m-1", [
      suggested("Mine", { ownerIsMe: true }),
      suggested("Hers", { owner: "Priya" }),
      suggested("Nobody"),
    ]);
    t.tasks.addSuggested("m-2", [suggested("Other meeting", { ownerIsMe: true })]);
    t.tasks.act(t.tasks.list({ owner: "me" }).tasks[0]!.id, "accept");
    expect(titles(t, { owner: "me" })).toEqual(["Mine", "Other meeting"]);
    expect(titles(t, { owner: "others" })).toEqual(["Hers"]);
    expect(titles(t, { owner: "unassigned" })).toEqual(["Nobody"]);
    expect(titles(t, { owner: "me-or-named" })).toEqual(["Mine", "Hers", "Other meeting"]);
    expect(titles(t, { status: "open" })).toEqual(["Mine"]);
    expect(titles(t, { status: "all", meetingId: "m-2" })).toEqual(["Other meeting"]);
    expect(titles(t)).toHaveLength(4);
  });
});

describe("folder filter (NT-17)", () => {
  it("shows the tasks of the meetings in a folder, or in the Inbox", () => {
    const t = setup();
    const folders = createFoldersStore(t.db, { now: () => 1, newId: () => "f1" });
    const made = folders.create("Customer calls");
    if (!made.ok || !made.id) throw new Error("no folder");
    folders.move("m-2", made.id);
    t.tasks.addSuggested("m-1", [suggested("In the inbox")]);
    t.tasks.addSuggested("m-2", [suggested("In the folder")]);
    t.tasks.addManual(draft("By hand"));
    expect(titles(t, { folder: made.id })).toEqual(["In the folder"]);
    expect(titles(t, { folder: "inbox" })).toEqual(["In the inbox"]);
    expect(titles(t, {})).toHaveLength(3);
    // Moving the meeting moves its tasks in the filter.
    folders.move("m-2", null);
    expect(titles(t, { folder: made.id })).toEqual([]);
    expect(titles(t, { folder: "inbox" }).sort()).toEqual(["In the folder", "In the inbox"]);
  });
});

describe("actions", () => {
  it("accepts, completes, reopens, archives and restores, refusing the wrong move", () => {
    const t = setup();
    t.tasks.addSuggested("m-1", [suggested("A")]);
    const id = t.tasks.list().tasks[0]!.id;
    expect(t.tasks.act(id, "done")).toMatchObject({ ok: false });
    expect(t.tasks.act(id, "accept")).toMatchObject({ ok: true, task: { status: "open" } });
    const done = t.tasks.act(id, "done");
    expect(done).toMatchObject({ ok: true, task: { status: "done" } });
    expect(done.ok && done.task.completedAt).not.toBeNull();
    expect(t.tasks.act(id, "reopen")).toMatchObject({
      task: { status: "open", completedAt: null },
    });
    expect(t.tasks.act(id, "archive")).toMatchObject({ task: { status: "archived" } });
    expect(t.tasks.act(id, "accept")).toMatchObject({ ok: false });
    expect(t.tasks.act(id, "restore")).toMatchObject({ task: { status: "open" } });
    expect(t.tasks.act("nope", "accept")).toMatchObject({ ok: false });
  });

  it("edits a task and refuses an invalid edit", () => {
    const t = setup();
    t.tasks.addSuggested("m-1", [suggested("A")]);
    const id = t.tasks.list().tasks[0]!.id;
    expect(
      t.tasks.update(
        id,
        draft("A better title", { owner: "Sam", dueOn: "2026-12-01", notes: "n" }),
      ),
    ).toMatchObject({
      ok: true,
      task: {
        title: "A better title",
        owner: "Sam",
        dueOn: "2026-12-01",
        notes: "n",
        status: "suggested",
      },
    });
    expect(t.tasks.update(id, draft(" "))).toMatchObject({ ok: false });
    expect(t.tasks.update(id, draft("x", { dueOn: "2026-02-31" }))).toMatchObject({ ok: false });
    expect(t.tasks.update("nope", draft("x"))).toMatchObject({ ok: false });
    // "Me" clears the name.
    expect(t.tasks.update(id, draft("x", { owner: "Sam", ownerIsMe: true }))).toMatchObject({
      task: { owner: null, ownerIsMe: true },
    });
  });

  it("adds a task by hand, open at once", () => {
    const t = setup();
    expect(t.tasks.addManual(draft("Call Sam", { ownerIsMe: true }))).toMatchObject({
      ok: true,
      task: { status: "open", source: "manual", meetingId: null, ownerIsMe: true },
    });
    expect(t.tasks.addManual(draft(""))).toMatchObject({ ok: false });
  });
});

describe("reorder", () => {
  const four = () => {
    const t = setup();
    for (const title of ["A", "B", "C", "D"]) t.tasks.addManual(draft(title));
    const id = (title: string) => t.tasks.list().tasks.find((x) => x.title === title)!.id;
    return { t, id };
  };

  it("puts a task before another or last", () => {
    const { t, id } = four();
    t.tasks.reorder(id("D"), id("B"));
    expect(titles(t)).toEqual(["A", "D", "B", "C"]);
    t.tasks.reorder(id("A"), null);
    expect(titles(t)).toEqual(["D", "B", "C", "A"]);
    t.tasks.reorder(id("A"), id("D"));
    expect(titles(t)).toEqual(["A", "D", "B", "C"]);
    expect(t.tasks.reorder("nope", null)).toMatchObject({ ok: false });
    expect(t.tasks.reorder(id("A"), "nope")).toMatchObject({ ok: false });
  });

  it("keeps the order when the gaps run out", () => {
    const { t, id } = four();
    // Move C back and forth between A and B until halving would collide.
    for (let i = 0; i < 60; i++) {
      t.tasks.reorder(id("C"), id("B"));
      t.tasks.reorder(id("B"), id("C"));
    }
    t.tasks.reorder(id("C"), id("B"));
    expect(titles(t).sort()).toEqual(["A", "B", "C", "D"]);
    const order = titles(t);
    expect(order.indexOf("C")).toBeLessThan(order.indexOf("B"));
    const positions = t.tasks.list().tasks.map((x) => x.position);
    expect(new Set(positions).size).toBe(4);
  });
});

describe("undo", () => {
  it("takes back accept, edit, archive, add and reorder, newest first", () => {
    const t = setup();
    t.tasks.addSuggested("m-1", [suggested("A"), suggested("B")]);
    const [a, b] = t.tasks.list().tasks.map((x) => x.id) as [string, string];
    t.tasks.act(a, "accept");
    t.tasks.update(a, draft("A edited"));
    t.tasks.reorder(b, a);
    t.tasks.addManual(draft("C"));
    t.tasks.act(b, "archive");
    expect(t.tasks.list().undo).toBe("Archive task");

    expect(t.tasks.undo()).toEqual({ ok: true, label: "Archive task" });
    expect(t.tasks.get(b)!.status).toBe("suggested");
    expect(t.tasks.undo()).toEqual({ ok: true, label: "Add task" });
    expect(titles(t)).toEqual(["B", "A edited"]);
    expect(t.tasks.undo()).toEqual({ ok: true, label: "Move task" });
    expect(titles(t)).toEqual(["A edited", "B"]);
    expect(t.tasks.undo()).toEqual({ ok: true, label: "Edit task" });
    expect(t.tasks.get(a)!.title).toBe("A");
    expect(t.tasks.undo()).toEqual({ ok: true, label: "Accept task" });
    expect(t.tasks.get(a)!.status).toBe("suggested");
    expect(t.tasks.undo()).toEqual({ ok: false });
    expect(t.tasks.list().undo).toBeNull();
  });

  it("remembers the last 20 actions and no more", () => {
    const t = setup();
    t.tasks.addSuggested("m-1", [suggested("A")]);
    const id = t.tasks.list().tasks[0]!.id;
    for (let i = 0; i < 25; i++) {
      t.tasks.update(id, draft(`A${i}`));
    }
    let undone = 0;
    while (t.tasks.undo().ok) undone++;
    expect(undone).toBe(TASK_UNDO_LIMIT);
    expect(t.tasks.get(id)!.title).toBe("A4");
  });

  it("does not list tasks suggested from a meeting as something to undo", () => {
    const t = setup();
    t.tasks.addSuggested("m-1", [suggested("A")]);
    expect(t.tasks.list().undo).toBeNull();
  });
});
