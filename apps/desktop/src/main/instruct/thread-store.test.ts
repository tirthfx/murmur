import { describe, expect, it } from "vitest";
import { INSTRUCT_LIMITS } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createInstructThreadStore, type InstructTurnInput } from "./thread-store";

const DAY = 24 * 60 * 60_000;

function setup() {
  const db = openDatabase(":memory:");
  let time = 1_000_000_000_000;
  let id = 0;
  const store = createInstructThreadStore(
    db,
    () => time,
    () => `id${++id}`,
  );
  return { db, store, advance: (ms: number) => (time += ms) };
}

const turn = (instruction: string, draft: string): InstructTurnInput => ({
  instruction,
  draft,
  modelId: "qwen3-4b",
  appBundleId: "com.apple.mail",
  durationMs: 700,
});

const count = (db: ReturnType<typeof openDatabase>, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("Instruct thread store", () => {
  it("keeps every turn of a thread, titled by its first request", () => {
    const { store, advance } = setup();
    const id = store.create("com.apple.mail");
    store.addTurn(id, turn("draft a reply saying Thursday", "Thursday works."));
    advance(1000);
    store.addTurn(id, turn("make it shorter", "Thursday."));
    store.updateLastDraft(id, "Thursday!");
    store.setOutcome(id, "inserted");
    const thread = store.get(id)!;
    expect(thread).toMatchObject({
      title: "draft a reply saying Thursday",
      finalDraft: "Thursday!",
      turnCount: 2,
      outcome: "inserted",
      textRemoved: false,
    });
    expect(thread.turns.map((item) => [item.seq, item.instruction, item.draft])).toEqual([
      [1, "draft a reply saying Thursday", "Thursday works."],
      [2, "make it shorter", "Thursday!"],
    ]);
  });

  it("lists newest first and searches requests and drafts, ignoring case", () => {
    const { store, advance } = setup();
    const first = store.create(null);
    store.addTurn(first, turn("write a haiku about rain", "Rain on the roof."));
    advance(1000);
    const second = store.create(null);
    store.addTurn(second, turn("reply to Sam", "Hi Sam, Friday is fine."));
    store.addTurn(second, turn("add the budget", "Hi Sam, Friday is fine. Budget: 4k."));
    expect(store.list("").map((item) => item.id)).toEqual([second, first]);
    expect(store.list("ROOF").map((item) => item.id)).toEqual([first]);
    expect(store.list("budget").map((item) => item.id)).toEqual([second]);
    expect(store.list("100% match_")).toEqual([]);
  });

  it("deletes a thread with its turns, or all of them", () => {
    const { db, store } = setup();
    const a = store.create(null);
    store.addTurn(a, turn("one", "1"));
    store.addTurn(a, turn("two", "2"));
    const b = store.create(null);
    store.addTurn(b, turn("three", "3"));
    store.delete(a);
    expect(store.get(a)).toBeNull();
    expect(count(db, "instruct_history")).toBe(1);
    store.deleteAll();
    expect(count(db, "instruct_threads")).toBe(0);
    expect(count(db, "instruct_history")).toBe(0);
  });

  it("removes the text of threads older than 30 days and keeps the counts", () => {
    const { db, store, advance } = setup();
    const old = store.create("com.apple.mail");
    store.addTurn(old, turn("old request", "old draft"));
    store.addTurn(old, turn("old follow-up", "old draft 2"));
    advance(31 * DAY);
    const fresh = store.create(null);
    store.addTurn(fresh, turn("new request", "new draft"));
    expect(store.applyRetention()).toEqual({ textRemoved: 1, deleted: 0 });
    expect(store.get(old)).toMatchObject({
      title: "",
      finalDraft: null,
      turnCount: 2,
      textRemoved: true,
      turns: [],
    });
    expect(store.get(fresh)!.turns).toHaveLength(1);
    expect(count(db, "instruct_history")).toBe(1);
    expect(store.applyRetention()).toEqual({ textRemoved: 0, deleted: 0 });
  });

  it("keeps at most 1,000 threads, dropping the oldest", () => {
    const { store, advance } = setup();
    const first = store.create(null);
    for (let index = 0; index < INSTRUCT_LIMITS.maxThreads; index++) {
      advance(1);
      store.create(null);
    }
    expect(store.applyRetention().deleted).toBe(1);
    expect(store.get(first)).toBeNull();
    expect(store.list("", 2000)).toHaveLength(INSTRUCT_LIMITS.maxThreads);
  });

  it("marks the last turn undone", () => {
    const { db, store } = setup();
    const id = store.create(null);
    store.addTurn(id, turn("one", "1"));
    store.markUndone(id);
    const row = db
      .prepare("SELECT action_taken FROM instruct_history WHERE thread_id = ?")
      .get(id) as { action_taken: string };
    expect(row.action_taken).toBe("undone");
  });
});
