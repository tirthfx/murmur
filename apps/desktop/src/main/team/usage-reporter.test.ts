import { describe, expect, it } from "vitest";
import type { InsightsDay } from "@murmur/shared";
import {
  EMPTY_USAGE_MEMORY,
  appBucket,
  buildBatch,
  createUsageReporter,
  type UsageEvent,
  type UsageMemory,
} from "./usage-reporter";

const day = (
  date: string,
  words: number,
  dictations: number,
  apps: InsightsDay["apps"] = {},
): InsightsDay => ({
  date,
  words,
  dictations,
  speechMs: 0,
  wpmWords: 0,
  wpmMs: 0,
  apps,
});

const NOW = new Date(2026, 10, 22, 12, 0).getTime();

describe("app groups", () => {
  it("name a kind of app, never the app", () => {
    expect(appBucket("com.apple.mail")).toBe("mail");
    expect(appBucket("com.google.Chrome")).toBe("browser");
    expect(appBucket("com.tinyspeck.slackmacgap")).toBe("chat");
    expect(appBucket("com.apple.dt.Xcode")).toBe("code");
    expect(appBucket("com.apple.Notes")).toBe("notes");
    expect(appBucket("com.notion.id")).toBe("documents");
    expect(appBucket("com.unknown.thing")).toBe("other");
  });
});

describe("what is new", () => {
  it("counts a day's words and dictations by app group, with the rest as other", () => {
    const events = buildBatch({
      days: [
        day("2026-11-22", 100, 5, { "com.apple.mail": { name: "Mail", words: 60, dictations: 3 } }),
      ],
      meetings: [],
      memory: EMPTY_USAGE_MEMORY,
      now: NOW,
    });
    expect(events.map(({ day: d, metric, count, bucket }) => [d, metric, count, bucket])).toEqual([
      ["2026-11-22", "words", 60, "mail"],
      ["2026-11-22", "dictations", 3, "mail"],
      ["2026-11-22", "words", 40, "other"],
      ["2026-11-22", "dictations", 2, "other"],
    ]);
    // No app name and no text anywhere in what would be sent.
    expect(JSON.stringify(events)).not.toContain("Mail");
    expect(JSON.stringify(events)).not.toContain("com.apple");
  });

  it("sends only the growth since the last time, and nothing when nothing grew", () => {
    const memory: UsageMemory = {
      ...EMPTY_USAGE_MEMORY,
      sent: { "2026-11-22": { "words|other": 40, "dictations|other": 2 } },
    };
    const events = buildBatch({ days: [day("2026-11-22", 55, 2)], meetings: [], memory, now: NOW });
    expect(events.map((e) => [e.metric, e.count])).toEqual([["words", 15]]);
    expect(
      buildBatch({ days: [day("2026-11-22", 40, 2)], meetings: [], memory, now: NOW }),
    ).toEqual([]);
  });

  it("leaves out days older than 35 days", () => {
    expect(
      buildBatch({
        days: [day("2026-09-01", 10, 1)],
        meetings: [],
        memory: EMPTY_USAGE_MEMORY,
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("counts a finished meeting once, with its minutes, and not one still going", () => {
    const meetings = [
      { id: "m1", startedAt: NOW - 3_600_000, endedAt: NOW - 600_000, durationMs: 50 * 60_000 },
      { id: "m2", startedAt: NOW - 1000, endedAt: null, durationMs: 0 },
    ];
    const events = buildBatch({ days: [], meetings, memory: EMPTY_USAGE_MEMORY, now: NOW });
    expect(events.map((e) => [e.metric, e.count])).toEqual([
      ["meetings_recorded", 1],
      ["meeting_minutes_recorded", 50],
    ]);
    const again = buildBatch({
      days: [],
      meetings,
      memory: { ...EMPTY_USAGE_MEMORY, meetings: ["m1"] },
      now: NOW,
    });
    expect(again).toEqual([]);
  });
});

describe("sending", () => {
  function reporter(options: { answers?: boolean[]; days?: InsightsDay[] } = {}) {
    let memory: UsageMemory = EMPTY_USAGE_MEMORY;
    const posts: { batchId: string; events: UsageEvent[] }[] = [];
    const answers = options.answers ?? [];
    let n = 0;
    let days = options.days ?? [day("2026-11-22", 100, 5)];
    const r = createUsageReporter({
      days: () => days,
      meetings: () => [],
      now: () => NOW,
      newId: () => `batch-${++n}`,
      load: () => memory,
      save: (next) => (memory = next),
      post: async (batchId, events) => {
        posts.push({ batchId, events });
        return answers.length > 0 ? answers.shift()! : true;
      },
    });
    return { r, posts, memory: () => memory, setDays: (next: InsightsDay[]) => (days = next) };
  }

  it("sends what is new once, then only what grew", async () => {
    const t = reporter();
    expect(await t.r.flush()).toBe(2);
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0]!.events.every((e) => !("total" in e) && !("meetingId" in e))).toBe(true);
    expect(await t.r.flush()).toBe(0);
    expect(t.posts).toHaveLength(1);
    t.setDays([day("2026-11-22", 130, 6)]);
    await t.r.flush();
    expect(t.posts[1]!.events.map((e) => [e.metric, e.count])).toEqual([
      ["words", 30],
      ["dictations", 1],
    ]);
  });

  it("sends a batch again with the same id when the answer was lost, and counts it once", async () => {
    const t = reporter({ answers: [false] });
    expect(await t.r.flush()).toBe(0);
    expect(t.memory().pending?.batchId).toBe("batch-1");
    expect(await t.r.flush()).toBe(2);
    expect(t.posts.map((p) => p.batchId)).toEqual(["batch-1", "batch-1"]);
    expect(t.memory().pending).toBeNull();
    expect(await t.r.flush()).toBe(0);
  });

  it("splits a long list into batches of 500", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      day(`2026-11-${String(i + 1).padStart(2, "0")}`, 10, 1, {
        ...Object.fromEntries(
          [
            "com.apple.mail",
            "com.google.Chrome",
            "com.slack",
            "com.apple.Xcode",
            "com.apple.Notes",
            "com.notion",
            "x.y",
          ].map((id) => [id, { name: id, words: 1, dictations: 1 }]),
        ),
      }),
    );
    const t = reporter({ days: many });
    const sent = await t.r.flush();
    expect(sent).toBeGreaterThan(0);
    expect(t.posts.every((p) => p.events.length <= 500)).toBe(true);
    expect(t.posts.reduce((sum, p) => sum + p.events.length, 0)).toBe(sent);
  });
});

describe("skills run, Ask sessions and meeting minutes processed", () => {
  const counts = (date: string, skills: number, asks: number, minutes: number) => ({
    date,
    skills_run: skills,
    ask_sessions: asks,
    meeting_minutes_processed: minutes,
  });

  it("are sent as the day's growth, with no app group", () => {
    const events = buildBatch({
      days: [],
      counts: [counts("2026-11-22", 3, 0, 45)],
      meetings: [],
      memory: EMPTY_USAGE_MEMORY,
      now: NOW,
    });
    expect(
      events.map(({ day, metric, count, bucket }) => ({ day, metric, count, bucket })),
    ).toEqual([
      { day: "2026-11-22", metric: "skills_run", count: 3, bucket: undefined },
      { day: "2026-11-22", metric: "meeting_minutes_processed", count: 45, bucket: undefined },
    ]);
  });

  it("send only what is new on the next sync, and nothing when nothing grew", async () => {
    let memory: UsageMemory = EMPTY_USAGE_MEMORY;
    let current = [counts("2026-11-22", 2, 1, 10)];
    const sent: UsageEvent[][] = [];
    const reporter = createUsageReporter({
      days: () => [],
      counts: () => current,
      meetings: () => [],
      post: async (_id, events) => {
        sent.push(events);
        return true;
      },
      load: () => memory,
      save: (next) => (memory = next),
      now: () => NOW,
      newId: () => `b${sent.length + 1}`,
    });
    await reporter.flush();
    expect(sent[0]!.map((e) => `${e.metric}:${e.count}`)).toEqual([
      "skills_run:2",
      "ask_sessions:1",
      "meeting_minutes_processed:10",
    ]);
    await reporter.flush();
    expect(sent).toHaveLength(1);
    current = [counts("2026-11-22", 2, 4, 10)];
    await reporter.flush();
    expect(sent[1]!.map((e) => `${e.metric}:${e.count}`)).toEqual(["ask_sessions:3"]);
  });

  it("are sent again with the same batch id when the answer was lost, and counted once", async () => {
    let memory: UsageMemory = EMPTY_USAGE_MEMORY;
    const ids: string[] = [];
    let accept = false;
    const reporter = createUsageReporter({
      days: () => [],
      counts: () => [counts("2026-11-22", 1, 0, 0)],
      meetings: () => [],
      post: async (id) => {
        ids.push(id);
        return accept;
      },
      load: () => memory,
      save: (next) => (memory = next),
      now: () => NOW,
      newId: () => "first",
    });
    await reporter.flush();
    accept = true;
    await reporter.flush();
    expect(ids).toEqual(["first", "first"]);
    await reporter.flush();
    expect(ids).toHaveLength(2);
  });
});
