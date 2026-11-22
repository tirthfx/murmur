import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { createMeetingsStore } from "../meetings/meetings-store";
import { createUsageCounts } from "./usage-counts";

const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).getTime();
const dayOf = (day: number) => `2026-11-${String(day).padStart(2, "0")}`;

function setup() {
  const db = openDatabase(":memory:");
  const meetings = createMeetingsStore(db);
  for (const [id, started] of [
    ["m1", at(20)],
    ["m2", at(21)],
  ] as const) {
    meetings.create({ id, title: id, startedAt: started, source: "ad_hoc", folder: "/f" });
    db.prepare("UPDATE meetings SET duration_ms = ? WHERE id = ?").run(
      id === "m1" ? 30 * 60_000 : 12 * 60_000,
      id,
    );
  }
  return { db, counts: createUsageCounts(db) };
}

const summary = (db: ReturnType<typeof setup>["db"], id: string, quick: number, created: number) =>
  db
    .prepare(
      `INSERT INTO meeting_summaries (id, meeting_id, version, skill_id, skill_name, model_id, quick, markdown, created_at)
       VALUES (?, 'm1', ?, 'general', 'General', 'x', ?, 'text', ?)`,
    )
    .run(id, Math.floor(Math.random() * 1e6), quick, created);

describe("the counts beyond dictation", () => {
  it("is empty when nothing was done", () => {
    expect(setup().counts.daily()).toEqual([]);
  });

  it("counts the summaries a Skill wrote by day, and not the quick ones", () => {
    const t = setup();
    summary(t.db, "s1", 0, at(20));
    summary(t.db, "s2", 0, at(20, 18));
    summary(t.db, "s3", 1, at(20));
    summary(t.db, "s4", 0, at(21));
    const days = t.counts.daily();
    expect(days.map((d) => [d.date, d.skills_run])).toEqual([
      [dayOf(20), 2],
      [dayOf(21), 1],
    ]);
  });

  it("counts Ask threads by day", () => {
    const t = setup();
    for (const [id, created] of [
      ["a1", at(20)],
      ["a2", at(20, 15)],
      ["a3", at(22)],
    ] as const)
      t.db
        .prepare(
          "INSERT INTO ask_threads (id, title, scope_json, created_at, updated_at) VALUES (?, 't', '{}', ?, ?)",
        )
        .run(id, created, created);
    expect(t.counts.daily().map((d) => [d.date, d.ask_sessions])).toEqual([
      [dayOf(20), 2],
      [dayOf(22), 1],
    ]);
  });

  it("counts the minutes of meetings whose transcription finished, on the day it finished", () => {
    const t = setup();
    const job = (id: string, status: string, updated: number) =>
      t.db
        .prepare(
          "INSERT INTO meeting_jobs (meeting_id, kind, status, created_at, updated_at) VALUES (?, 'transcribe', ?, 1, ?)",
        )
        .run(id, status, updated);
    job("m1", "done", at(20));
    job("m2", "running", at(21));
    expect(t.counts.daily()).toEqual([
      { date: dayOf(20), skills_run: 0, ask_sessions: 0, meeting_minutes_processed: 30 },
    ]);
  });

  it("keeps the three counts of a day together, in date order", () => {
    const t = setup();
    summary(t.db, "s1", 0, at(21));
    t.db
      .prepare(
        "INSERT INTO ask_threads (id, title, scope_json, created_at, updated_at) VALUES ('a', 't', '{}', ?, ?)",
      )
      .run(at(20), at(20));
    t.db
      .prepare(
        "INSERT INTO meeting_jobs (meeting_id, kind, status, created_at, updated_at) VALUES ('m2', 'transcribe', 'done', 1, ?)",
      )
      .run(at(21));
    expect(t.counts.daily()).toEqual([
      { date: dayOf(20), skills_run: 0, ask_sessions: 1, meeting_minutes_processed: 0 },
      { date: dayOf(21), skills_run: 1, ask_sessions: 0, meeting_minutes_processed: 12 },
    ]);
  });
});
