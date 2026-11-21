import { describe, expect, it } from "vitest";
import { BUILT_IN_SKILLS } from "@murmur/shared";
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
