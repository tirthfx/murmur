import { describe, expect, it } from "vitest";
import type { MeetingBrief } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createBriefsStore } from "./briefs-store";

const brief = (key: string, over: Partial<MeetingBrief> = {}): MeetingBrief => ({
  eventKey: key,
  title: "Design sync",
  startMs: 1000,
  builtAt: 500,
  markdown: "## Who is coming\n- Dana",
  sources: [{ id: "meetings", label: "Earlier meetings", state: "used", count: 1, note: null }],
  items: [
    {
      n: 1,
      source: "meetings",
      title: "Last sync",
      text: "Decided",
      at: 1,
      url: null,
      meetingId: "m1",
    },
  ],
  modelWrote: true,
  ...over,
});

describe("briefs store (NT-11)", () => {
  it("keeps a brief with its sources and what it cites, and replaces it when built again", () => {
    const store = createBriefsStore(openDatabase(":memory:"));
    expect(store.get("a:e1")).toBeNull();
    store.put(brief("a:e1"));
    expect(store.get("a:e1")).toEqual(brief("a:e1"));
    store.put(brief("a:e1", { builtAt: 900, markdown: "## New" }));
    expect(store.get("a:e1")).toMatchObject({ builtAt: 900, markdown: "## New" });
  });

  it("says when each event's brief was built", () => {
    const store = createBriefsStore(openDatabase(":memory:"));
    store.put(brief("a:e1", { builtAt: 10 }));
    store.put(brief("a:e2", { builtAt: 20 }));
    expect([...store.builtAt(["a:e1", "a:e2", "a:e3"]).entries()]).toEqual([
      ["a:e1", 10],
      ["a:e2", 20],
    ]);
  });

  it("drops the briefs of meetings long past", () => {
    const store = createBriefsStore(openDatabase(":memory:"));
    store.put(brief("old", { startMs: 100 }));
    store.put(brief("new", { startMs: 10_000 }));
    expect(store.prune(5000)).toBe(1);
    expect(store.get("old")).toBeNull();
    expect(store.get("new")).not.toBeNull();
  });

  it("finds the brief of an event by the event's own id, whichever account it is in", () => {
    const store = createBriefsStore(openDatabase(":memory:"));
    store.put(brief("acct-1:ev:one", { title: "Mine", builtAt: 10 }));
    store.put(brief("acct-2:other", { title: "Other" }));
    expect(store.getForEvent("ev:one")?.title).toBe("Mine");
    expect(store.getForEvent("nope")).toBeNull();
    expect(store.getForEvent("one")).toBeNull();
  });
});
