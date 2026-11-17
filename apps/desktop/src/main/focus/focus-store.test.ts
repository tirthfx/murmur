import { describe, expect, it } from "vitest";
import { FOCUS_LIMITS } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createFocusStore } from "./focus-store";

function setup() {
  const db = openDatabase(":memory:");
  let time = 1_000;
  let id = 0;
  const store = createFocusStore(
    db,
    () => time,
    () => `id${++id}`,
  );
  return { db, store, advance: (ms: number) => (time += ms) };
}

describe("focus store", () => {
  it("keeps blocked apps by name, once each, up to the limit", () => {
    const { store } = setup();
    expect(store.addApp("com.apple.Safari", "Safari")).toMatchObject({ value: "com.apple.Safari" });
    store.addApp("com.apple.Music", "Music");
    expect(store.addApp("com.apple.Safari", "Safari")).toBe("duplicate");
    expect(store.apps().map((rule) => rule.label)).toEqual(["Music", "Safari"]);
    store.remove(store.apps()[0]!.id);
    expect(store.apps().map((rule) => rule.label)).toEqual(["Safari"]);
    for (let index = 1; index < FOCUS_LIMITS.apps; index++)
      store.addApp(`com.example.a${index}`, "A");
    expect(store.addApp("com.example.full", "Full")).toBe("limit");
  });

  it("records sessions with how they ended, and closes ones left open", () => {
    const { db, store, advance } = setup();
    const first = store.start(25 * 60_000);
    advance(1000);
    store.end(first, "user");
    store.start(null);
    expect(store.endOpen("quit")).toBe(1);
    const rows = db
      .prepare("SELECT planned_ms, end_reason FROM focus_sessions ORDER BY started_at, id")
      .all();
    expect(rows).toEqual([
      { planned_ms: 25 * 60_000, end_reason: "user" },
      { planned_ms: null, end_reason: "quit" },
    ]);
  });
});
