import { describe, expect, it, vi } from "vitest";
import { extractTasks, resolveDue } from "./tasks-extractor";
import type { SummarySegment } from "./summarizer";

const segments: SummarySegment[] = [
  {
    id: "s1",
    channel: "mic",
    startMs: 12_000,
    text: "I will send the budget to finance by Friday.",
  },
  {
    id: "s2",
    channel: "system",
    startMs: 75_000,
    text: "Priya, can you book the room for the review?",
  },
  { id: "s3", channel: "system", startMs: 80_000, text: "Sure, I will." },
];
// Saturday 21 November 2026, 10:00 local time.
const startedAt = new Date(2026, 10, 21, 10, 0).getTime();
const request = { segments, meetingStartedAt: startedAt, max: 15 };

const answer = (tasks: unknown) => JSON.stringify({ tasks });
const TWO = answer([
  { title: "Send the budget to finance", owner: "me", due: "2026-11-27", time: "0:12" },
  { title: "Book the room for the review", owner: "Priya", due: null, time: "1:15" },
]);

describe("extractTasks (NT-26)", () => {
  it("gives two suggested tasks for two explicit action items", async () => {
    const generate = vi.fn().mockResolvedValue(TWO);
    const result = await extractTasks({ generate }, request);
    expect(result).toEqual({
      ok: true,
      tasks: [
        {
          title: "Send the budget to finance",
          ownerIsMe: true,
          owner: null,
          dueOn: "2026-11-27",
          sourceSegmentId: "s1",
        },
        {
          title: "Book the room for the review",
          ownerIsMe: false,
          owner: "Priya",
          dueOn: null,
          sourceSegmentId: "s2",
        },
      ],
    });
    expect(generate).toHaveBeenCalledOnce();
    const sent = generate.mock.calls[0]![0] as { prompt: string; system: string };
    expect(sent.prompt).toContain("Meeting date: 2026-11-21 (Saturday)");
    expect(sent.prompt).toContain("[0:12] Owner: I will send the budget");
    expect(sent.system).toContain("JSON only");
  });

  it("reads JSON inside a code fence or after a few words", async () => {
    const generate = vi.fn().mockResolvedValue("Here you go:\n```json\n" + TWO + "\n```");
    const result = await extractTasks({ generate }, request);
    expect(result.ok && result.tasks).toHaveLength(2);
  });

  it("asks once more after invalid JSON, and uses the second answer", async () => {
    const generate = vi.fn().mockResolvedValueOnce("sorry, I cannot").mockResolvedValueOnce(TWO);
    const result = await extractTasks({ generate }, request);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.ok && result.tasks).toHaveLength(2);
  });

  it.each([
    ["not JSON", "no tasks here"],
    ["a tasks field that is not a list", '{"tasks": "send the budget"}'],
    ["a task with no title", answer([{ owner: "me" }])],
    ["a task with an empty title", answer([{ title: "  " }])],
    ["an item that is not an object", answer(["send the budget"])],
    ["broken JSON", '{"tasks": [{"title": "A"'],
  ])("creates no tasks from %s twice", async (_label, text) => {
    const generate = vi.fn().mockResolvedValue(text);
    const result = await extractTasks({ generate }, request);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: false });
  });

  it("gives none (and no error) when the model says there are none", async () => {
    const result = await extractTasks({ generate: vi.fn().mockResolvedValue(answer([])) }, request);
    expect(result).toEqual({ ok: true, tasks: [] });
  });

  it("cleans owners, dates and times", async () => {
    const generate = vi.fn().mockResolvedValue(
      answer([
        { title: "A", owner: "Me", due: "2026-02-31", time: "[0:12]" },
        { title: "B", owner: "someone", due: "sometime soon", time: "9:59" },
        { title: "C", owner: null },
        { title: "D", owner: "  Sam Lee  ", due: "2026-12-01", time: "1:16" },
      ]),
    );
    const result = await extractTasks({ generate }, request);
    expect(result.ok && result.tasks).toEqual([
      { title: "A", ownerIsMe: true, owner: null, dueOn: null, sourceSegmentId: "s1" },
      { title: "B", ownerIsMe: false, owner: null, dueOn: null, sourceSegmentId: null },
      { title: "C", ownerIsMe: false, owner: null, dueOn: null, sourceSegmentId: null },
      {
        title: "D",
        ownerIsMe: false,
        owner: "Sam Lee",
        dueOn: "2026-12-01",
        sourceSegmentId: "s2",
      },
    ]);
  });

  it("keeps at most the limit, and the same task once", async () => {
    const generate = vi
      .fn()
      .mockResolvedValue(
        answer([{ title: "Send it" }, { title: "send it!" }, { title: "Two" }, { title: "Three" }]),
      );
    const result = await extractTasks({ generate }, { ...request, max: 2 });
    expect(result.ok && result.tasks.map((t) => t.title)).toEqual(["Send it", "Two"]);
  });

  it("reads a long meeting in parts, each within the context, and merges the tasks", async () => {
    const long: SummarySegment[] = Array.from({ length: 400 }, (_, i) => ({
      id: `l${i}`,
      channel: i % 2 ? "mic" : "system",
      startMs: i * 10_000,
      text: `Line number ${i} of a long talk about the plan and the budget and the schedule.`,
    }));
    let n = 0;
    const generate = vi.fn().mockImplementation(async (r: { prompt: string }) => {
      expect(r.prompt.length / 3.5).toBeLessThan(3_300);
      return answer([{ title: `Task ${++n}` }, { title: "Shared task" }]);
    });
    const result = await extractTasks(
      { generate },
      { segments: long, meetingStartedAt: startedAt, max: 50 },
    );
    expect(generate.mock.calls.length).toBeGreaterThan(2);
    expect(result.ok && result.tasks.filter((t) => t.title === "Shared task")).toHaveLength(1);
    expect(result.ok && result.tasks.length).toBe(generate.mock.calls.length + 1);
  });

  it("passes a model failure on", async () => {
    await expect(
      extractTasks({ generate: vi.fn().mockRejectedValue(new Error("gone")) }, request),
    ).rejects.toThrow("gone");
  });
});

describe("resolveDue", () => {
  // Saturday 21 November 2026.
  const at = new Date(2026, 10, 21, 10, 0).getTime();
  it.each([
    ["Wednesday", "2026-11-25"],
    ["by Monday", "2026-11-23"],
    ["saturday", "2026-11-28"],
    ["Friday", "2026-11-27"],
    ["today", "2026-11-21"],
    ["tomorrow", "2026-11-22"],
    ["the 27th", "2026-11-27"],
    ["Thursday the 27th", "2026-11-27"],
    ["Nov 27", "2026-11-27"],
    ["27 November", "2026-11-27"],
    ["November 3rd", "2027-11-03"],
    ["the 3rd", "2026-12-03"],
    ["the 21st", "2026-11-21"],
    ["the 31st", "2026-12-31"],
    ["March 9", "2027-03-09"],
    ["2026-12-01", "2026-12-01"],
  ])("reads %s as %s", (phrase, expected) => {
    expect(resolveDue(phrase, at)).toBe(expected);
  });

  it.each([
    [null],
    [""],
    ["sometime soon"],
    ["2026-11-20"],
    ["2026-02-31"],
    ["February 30"],
    ["the 40th"],
    ["in 3 days"],
  ])("gives no date for %s", (phrase) => {
    expect(resolveDue(phrase, at)).toBeNull();
  });
});
