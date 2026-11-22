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
