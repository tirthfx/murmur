import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { createFoldersStore, titleWords } from "./folders-store";
import { createMeetingsStore } from "./meetings-store";

function setup() {
  const db = openDatabase(":memory:");
  const meetings = createMeetingsStore(db);
  let n = 0;
  let clock = 100;
  const folders = createFoldersStore(db, { now: () => ++clock, newId: () => `f${++n}` });
  const meeting = (id: string, title: string, startedAt: number, folderId: string | null = null) =>
    meetings.create({ id, title, startedAt, source: "ad_hoc", folder: `/m/${id}`, folderId });
  return { db, meetings, folders, meeting };
}

const id = (result: { ok: boolean; id?: string }) => {
  if (!result.ok || !result.id) throw new Error("no id");
  return result.id;
};

describe("folders (NT-17)", () => {
  it("creates, renames and lists folders with their meeting counts", () => {
    const t = setup();
    const calls = id(t.folders.create("  Customer   calls "));
    id(t.folders.create("Planning"));
    t.meeting("m-1", "Acme", 1, calls);
    t.meeting("m-2", "Beta", 2, calls);
    t.meeting("m-3", "Gamma", 3);
    expect(t.folders.list().map((f) => [f.name, f.meetings])).toEqual([
      ["Customer calls", 2],
      ["Planning", 0],
    ]);
    expect(t.folders.rename(calls, "Clients")).toMatchObject({ ok: true });
    expect(t.folders.get(calls)?.name).toBe("Clients");
  });

  it.each([
    ["an empty name", "  ", /Write a name/],
    ["a name that is too long", "x".repeat(61), /up to 60/],
    ["the Inbox", "inbox", /Inbox is always there/],
    ["a name that is taken, ignoring case", "PLANNING", /already/],
  ])("refuses %s", (_label, name, message) => {
    const t = setup();
    t.folders.create("Planning");
    const result = t.folders.create(name);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).toMatch(message);
    expect(t.folders.list()).toHaveLength(1);
  });

  it("keeps a folder's own name when it is renamed to itself in other letters", () => {
    const t = setup();
    const f = id(t.folders.create("Planning"));
    expect(t.folders.rename(f, "planning")).toMatchObject({ ok: true });
    expect(t.folders.rename("nope", "x")).toMatchObject({ ok: false });
  });

  it("puts a meeting in a folder and back in the Inbox", () => {
    const t = setup();
    const f = id(t.folders.create("Planning"));
    t.meeting("m-1", "One", 1);
    expect(t.folders.folderOf("m-1")).toBeNull();
    expect(t.folders.move("m-1", f)).toMatchObject({ ok: true });
    expect(t.folders.folderOf("m-1")).toBe(f);
    expect(t.meetings.get("m-1")?.folderId).toBe(f);
    expect(t.folders.meetingIds(f)).toEqual(["m-1"]);
    expect(t.folders.meetingIds(null)).toEqual([]);
    expect(t.folders.move("m-1", null)).toMatchObject({ ok: true });
    expect(t.folders.meetingIds(null)).toEqual(["m-1"]);
    expect(t.folders.move("nope", f)).toMatchObject({ ok: false });
    expect(t.folders.move("m-1", "nope")).toMatchObject({ ok: false });
  });

  it("keeps the meetings of a deleted folder, in the Inbox", () => {
    const t = setup();
    const f = id(t.folders.create("Planning"));
    t.meeting("m-1", "One", 1, f);
    t.meeting("m-2", "Two", 2, f);
    t.folders.remove(f);
    expect(t.folders.list()).toEqual([]);
    expect(t.meetings.get("m-1")).toMatchObject({ folderId: null, title: "One" });
    expect(t.folders.meetingIds(null).sort()).toEqual(["m-1", "m-2"]);
  });

  it("keeps a folder's default Skill and export path, and gives the Skill of a meeting's folder", () => {
    const t = setup();
    const f = id(t.folders.create("Customer calls"));
    t.folders.setDefaultSkill(f, "customer-call-notes");
    t.folders.setAutoExport(f, "/Users/me/Shared");
    expect(t.folders.get(f)).toMatchObject({
      defaultSkillId: "customer-call-notes",
      autoExportPath: "/Users/me/Shared",
    });
    t.meeting("m-1", "Acme", 1, f);
    t.meeting("m-2", "Inbox one", 2);
    expect(t.folders.defaultSkillOf("m-1")).toBe("customer-call-notes");
    expect(t.folders.defaultSkillOf("m-2")).toBeNull();
    t.folders.setDefaultSkill(f, null);
    t.folders.setAutoExport(f, null);
    expect(t.folders.get(f)).toMatchObject({ defaultSkillId: null, autoExportPath: null });
  });
});

describe("titleWords", () => {
  it("keeps what a title is about, not numbers, months or words every meeting has", () => {
    expect(titleWords("Meeting, 21 Nov 2026 14:05")).toEqual([]);
    expect(titleWords("Acme renewal call, Weekly sync")).toEqual(["acme", "renewal"]);
    expect(titleWords("Roadmap review Roadmap")).toEqual(["roadmap"]);
  });
});

describe("folder suggestions (NT-17)", () => {
  function withHistory() {
    const t = setup();
    const calls = id(t.folders.create("Customer calls"));
    const planning = id(t.folders.create("Planning"));
    t.meeting("a1", "Acme renewal", 1_000, calls);
    t.meeting("a2", "Acme onboarding", 2_000, calls);
    t.meeting("p1", "Roadmap planning", 3_000, planning);
    return { ...t, calls, planning };
  }

  it("suggests the folder whose meetings share the title words", () => {
    const t = withHistory();
    t.meeting("new", "Acme pricing", 4_000);
    expect(t.folders.suggest("new")).toEqual({ folderId: t.calls, folderName: "Customer calls" });
  });

  it("does not suggest for a title that only slightly overlaps", () => {
    const t = withHistory();
    // One word of six matches a folder, which is not enough without recency.
    t.meeting("far", "Acme alpha beta gamma delta epsilon", 3_500);
    expect(t.folders.suggest("far")).toBeNull();
  });

  it("counts the folder of the meeting just before, but not alone", () => {
    const t = withHistory();
    t.meeting("new", "Roadmap sprint", 4_000);
    // "roadmap" matches Planning's title, and Planning is where the meeting before went.
    expect(t.folders.suggest("new")).toEqual({ folderId: t.planning, folderName: "Planning" });
    t.meeting("other", "Something unrelated entirely", 5_000);
    // Recency alone never suggests a folder.
    expect(t.folders.suggest("other")).toBeNull();
  });

  it("suggests nothing for a meeting that is in a folder, with a default title, or that does not exist", () => {
    const t = withHistory();
    t.meeting("moved", "Acme pricing", 4_000, t.calls);
    expect(t.folders.suggest("moved")).toBeNull();
    t.meeting("plain", "Meeting, 21 Nov 2026 14:05", 5_000);
    expect(t.folders.suggest("plain")).toBeNull();
    expect(t.folders.suggest("nope")).toBeNull();
  });

  it("stops offering a folder once it was dismissed for meetings like this one", () => {
    const t = withHistory();
    t.meeting("new", "Acme pricing", 4_000);
    expect(t.folders.suggest("new")?.folderId).toBe(t.calls);
    t.folders.dismiss("new", t.calls);
    expect(t.folders.suggest("new")).toBeNull();
    // Another meeting with the same title words is not asked again either; a different one is.
    t.meeting("same", "Acme pricing", 5_000);
    expect(t.folders.suggest("same")).toBeNull();
    t.meeting("diff", "Acme security", 6_000);
    expect(t.folders.suggest("diff")?.folderId).toBe(t.calls);
  });

  it("dismisses by the people when there are attendees", () => {
    const t = withHistory();
    t.meeting("new", "Acme pricing", 4_000);
    t.folders.dismiss("new", t.calls, ["Dana", "Sam"]);
    // The same people, whatever the order and case: not offered. Other people: the title still counts.
    t.meeting("again", "Acme pricing", 5_000);
    expect(t.folders.suggest("again", ["sam", "DANA"])).toBeNull();
    expect(t.folders.suggest("again", ["Priya"])?.folderId).toBe(t.calls);
    // Dismissing for the people did not dismiss it for the title.
    expect(t.folders.suggest("new")?.folderId).toBe(t.calls);
  });

  it("forgets dismissals with the folder", () => {
    const t = withHistory();
    t.meeting("new", "Acme pricing", 4_000);
    t.folders.dismiss("new", t.calls);
    t.folders.remove(t.calls);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM folder_suggestion_dismissals").get()).toEqual({
      n: 0,
    });
  });
});
