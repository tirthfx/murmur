import { describe, expect, it } from "vitest";
import { BUILT_IN_SKILLS, hasNewBuiltInVersion, type SkillDraft } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createMeetingsStore } from "./meetings-store";
import { createSkillsStore, createSummariesStore } from "./summaries-store";

function setup() {
  const db = openDatabase(":memory:");
  const meetings = createMeetingsStore(db);
  meetings.create({ id: "m-1", title: "Sync", startedAt: 1, source: "ad_hoc", folder: "/f" });
  return { db, meetings, summaries: createSummariesStore(db), skills: createSkillsStore(db) };
}

const add = (t: ReturnType<typeof setup>, id: string, skillId: string, quick = false, text = "x") =>
  t.summaries.add({
    id,
    meetingId: "m-1",
    skill: { id: skillId, name: skillId },
    modelId: "model-1",
    quick,
    markdown: text,
    at: 10,
  });

describe("summaries store", () => {
  it("keeps every version, so another Skill makes a new one and the old stays", () => {
    const t = setup();
    expect(add(t, "a", "meeting-summary").version).toBe(1);
    expect(add(t, "b", "decision-record").version).toBe(2);
    const list = t.summaries.list("m-1");
    expect(list.map((s) => [s.version, s.skillId])).toEqual([
      [1, "meeting-summary"],
      [2, "decision-record"],
    ]);
    expect(list[0]).toMatchObject({ modelId: "model-1", quick: false, feedback: null });
  });

  it("a final summary replaces the quick one, and a quick one never replaces a final one", () => {
    const t = setup();
    add(t, "q1", "meeting-summary", true);
    add(t, "q2", "meeting-summary", true);
    expect(t.summaries.list("m-1")).toHaveLength(2);
    add(t, "f", "meeting-summary");
    expect(t.summaries.list("m-1").map((s) => s.id)).toEqual(["f"]);
    add(t, "q3", "meeting-summary", true);
    expect(t.summaries.list("m-1").map((s) => s.id)).toEqual(["f", "q3"]);
  });

  it("stores thumbs with a reason that only a thumbs down keeps", () => {
    const t = setup();
    add(t, "a", "meeting-summary");
    expect(t.summaries.setFeedback("a", { rating: "down", reason: "too_long" })).toBe(true);
    expect(t.summaries.list("m-1")[0]!.feedback).toEqual({ rating: "down", reason: "too_long" });
    t.summaries.setFeedback("a", { rating: "up", reason: "too_long" });
    expect(t.summaries.list("m-1")[0]!.feedback).toEqual({ rating: "up", reason: null });
    t.summaries.setFeedback("a", null);
    expect(t.summaries.list("m-1")[0]!.feedback).toBeNull();
    expect(t.summaries.setFeedback("missing", null)).toBe(false);
  });

  it("goes with the meeting when it is deleted", () => {
    const t = setup();
    add(t, "a", "meeting-summary");
    t.meetings.remove("m-1");
    expect(t.summaries.list("m-1")).toEqual([]);
  });
});

describe("skills store", () => {
  it("lists the 12 built-ins first, read-only, and duplicates one into a custom copy", () => {
    const t = setup();
    expect(t.skills.list().filter((s) => s.builtIn)).toHaveLength(12);
    const copy = t.skills.duplicate("meeting-summary", "custom-1", 5)!;
    expect(copy).toMatchObject({ id: "custom-1", name: "Meeting summary (copy)", builtIn: false });
    expect(copy.sections).toEqual(BUILT_IN_SKILLS[0]!.sections);
    expect(
      t.skills
        .list()
        .map((s) => s.id)
        .slice(-1),
    ).toEqual(["custom-1"]);
    expect(t.skills.get("meeting-summary")!.builtIn).toBe(true);
    expect(t.skills.duplicate("nope", "custom-2", 5)).toBeNull();
    // A copy can be copied too.
    expect(t.skills.duplicate("custom-1", "custom-3", 6)!.name).toBe(
      "Meeting summary (copy) (copy)",
    );
  });
});

const draft = (over: Partial<SkillDraft> = {}): SkillDraft => ({
  name: "Retro",
  description: "What went well.",
  sections: ["Went well", "To change"],
  length: "short",
  prompt: "Write a retro.",
  ...over,
});

describe("custom Skills (NT-16)", () => {
  it("creates a Skill at version 1 with no history", () => {
    const t = setup();
    const skill = t.skills.create("s-1", draft(), 10);
    expect(skill).toMatchObject({ id: "s-1", version: 1, builtIn: false, basedOn: null });
    expect(t.skills.versions("s-1")).toEqual([]);
  });

  it("keeps the previous version when a Skill is edited", () => {
    const t = setup();
    t.skills.create("s-1", draft(), 10);
    const edited = t.skills.update("s-1", draft({ prompt: "Write a better retro." }), 20)!;
    expect(edited).toMatchObject({ version: 2, prompt: "Write a better retro." });
    t.skills.update("s-1", draft({ name: "Retro 2", prompt: "Write a better retro." }), 30);
    const versions = t.skills.versions("s-1");
    expect(versions.map((v) => [v.version, v.prompt, v.createdAt])).toEqual([
      [2, "Write a better retro.", 30],
      [1, "Write a retro.", 20],
    ]);
    expect(t.skills.get("s-1")).toMatchObject({ version: 3, name: "Retro 2" });
  });

  it("makes no new version when nothing changed, and refuses built-ins and unknown ids", () => {
    const t = setup();
    t.skills.create("s-1", draft(), 10);
    expect(t.skills.update("s-1", draft(), 20)!.version).toBe(1);
    expect(t.skills.versions("s-1")).toEqual([]);
    expect(t.skills.update("meeting-summary", draft(), 20)).toBeNull();
    expect(t.skills.update("nope", draft(), 20)).toBeNull();
    expect(t.skills.get("meeting-summary")!.version).toBe(1);
  });

  it("restores an earlier version as a new one, keeping the history", () => {
    const t = setup();
    t.skills.create("s-1", draft(), 10);
    t.skills.update("s-1", draft({ prompt: "Changed." }), 20);
    const back = t.skills.restore("s-1", 1, 30)!;
    expect(back).toMatchObject({ version: 3, prompt: "Write a retro." });
    expect(t.skills.versions("s-1").map((v) => v.version)).toEqual([2, 1]);
    expect(t.skills.restore("s-1", 9, 40)).toBeNull();
  });

  it("deletes a Skill with its versions, never a built-in", () => {
    const t = setup();
    t.skills.create("s-1", draft(), 10);
    t.skills.update("s-1", draft({ prompt: "Changed." }), 20);
    expect(t.skills.remove("s-1")).toBe(true);
    expect(t.skills.get("s-1")).toBeNull();
    expect(t.skills.versions("s-1")).toEqual([]);
    expect(t.skills.remove("s-1")).toBe(false);
    expect(t.skills.remove("meeting-summary")).toBe(false);
  });

  it("remembers the built-in a copy was made from, for the New version badge", () => {
    const t = setup();
    const copy = t.skills.duplicate("meeting-summary", "c-1", 5)!;
    expect(copy).toMatchObject({ basedOn: "meeting-summary", basedOnVersion: 1 });
    expect(hasNewBuiltInVersion(copy)).toBe(false);
    // The built-in moves on.
    const moved = BUILT_IN_SKILLS.map((s) =>
      s.id === "meeting-summary" ? { ...s, version: 2 } : s,
    );
    expect(hasNewBuiltInVersion(copy, moved)).toBe(true);
    expect(hasNewBuiltInVersion({ ...copy, basedOn: null })).toBe(false);
    // A copy of a copy stays tied to the built-in.
    expect(t.skills.duplicate("c-1", "c-2", 6)).toMatchObject({
      basedOn: "meeting-summary",
      basedOnVersion: 1,
    });
    expect(t.skills.duplicate("meeting-summary", "c-3", 7)!.basedOn).toBe("meeting-summary");
  });
});
