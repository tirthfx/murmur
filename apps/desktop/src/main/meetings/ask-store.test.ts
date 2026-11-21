import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { createAskStore } from "./ask-store";
import { createMeetingsStore } from "./meetings-store";

function setup() {
  const db = openDatabase(":memory:");
  const meetings = createMeetingsStore(db);
  meetings.create({
    id: "m-1",
    title: "Design sync",
    startedAt: 1_000,
    source: "ad_hoc",
    folder: "/f",
  });
  let n = 0;
  let clock = 100;
  const store = createAskStore(db, { now: () => ++clock, newId: () => `id-${++n}` });
  return { db, meetings, store };
}

const citation = {
  n: 1,
  meetingId: "m-1",
  meetingTitle: "Design sync",
  source: "transcript" as const,
  ref: "m-1:s1",
  startMs: 5_000,
  excerpt: "Owner: ship on Thursday",
};

describe("ask threads", () => {
  it("keeps a thread with its questions, answers and the sources an answer cites", () => {
    const t = setup();
    const id = t.store.createThread("When do we ship?", { kind: "all" });
    t.store.addMessage(id, { role: "user", text: "When do we ship?" });
    t.store.addMessage(id, {
      role: "assistant",
      text: "Thursday [1].",
      citations: [citation],
      supported: true,
    });
    const thread = t.store.get(id)!;
    expect(thread).toMatchObject({ id, title: "When do we ship?", scope: { kind: "all" } });
    expect(thread.messages.map((m) => [m.role, m.supported])).toEqual([
      ["user", null],
      ["assistant", true],
    ]);
    expect(thread.messages[1]!.citations).toEqual([{ ...citation, gone: false }]);
  });

  it("lists the newest thread first and shortens a long title", () => {
    const t = setup();
    t.store.createThread("First", { kind: "all" });
    const second = t.store.createThread("x".repeat(200), { kind: "all" });
    expect(t.store.list()[0]).toMatchObject({ id: second });
    expect(t.store.list()[0]!.title.length).toBeLessThanOrEqual(80);
    expect(t.store.list()[0]!.title.endsWith("…")).toBe(true);
  });

  it("moves a thread up when it gets a message, and keeps its scope", () => {
    const t = setup();
    const a = t.store.createThread("A", { kind: "all" });
    t.store.createThread("B", { kind: "all" });
    t.store.setScope(a, { kind: "range", from: "2026-11-01", to: "2026-11-30" });
    t.store.addMessage(a, { role: "user", text: "more" });
    expect(t.store.list().map((x) => x.title)).toEqual(["A", "B"]);
    expect(t.store.get(a)!.scope).toEqual({ kind: "range", from: "2026-11-01", to: "2026-11-30" });
  });

  it("shows a renamed meeting's new title and marks a deleted meeting's citation as gone", () => {
    const t = setup();
    const id = t.store.createThread("Q", { kind: "all" });
    t.store.addMessage(id, {
      role: "assistant",
      text: "A [1]",
      citations: [citation],
      supported: false,
      closest: [{ meetingId: "m-1", title: "Design sync", startedAt: 1_000 }],
    });
    t.meetings.rename("m-1", "Design review");
    expect(t.store.get(id)!.messages[0]!.citations[0]).toMatchObject({
      meetingTitle: "Design review",
      gone: false,
    });
    expect(t.store.get(id)!.messages[0]!.closest[0]!.title).toBe("Design review");
    t.meetings.remove("m-1");
    const after = t.store.get(id)!.messages[0]!;
    // The title kept with the citation is shown once the meeting is gone.
    expect(after.citations[0]).toMatchObject({ meetingTitle: "Design sync", gone: true });
    expect(after.closest).toEqual([]);
  });

  it("deletes a thread with its messages, and returns null for an unknown one", () => {
    const t = setup();
    const id = t.store.createThread("Q", { kind: "all" });
    t.store.addMessage(id, { role: "user", text: "Q" });
    t.store.remove(id);
    expect(t.store.get(id)).toBeNull();
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM ask_messages").get()).toEqual({ n: 0 });
    expect(t.store.get("nope")).toBeNull();
  });
});
