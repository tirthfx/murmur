import { describe, expect, it, vi } from "vitest";
import { BUILT_IN_SKILLS, type MeetingSegment } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createMeetingsStore } from "./meetings-store";
import { createSkillsStore, createSummariesStore } from "./summaries-store";
import { createSummaryRunner, SummaryError } from "./summary-runner";

const segment = (id: string, startMs: number, isDictated = false): MeetingSegment => ({
  id,
  meetingId: "m-1",
  channel: "mic",
  startMs,
  endMs: startMs + 1000,
  text: `Line ${id}`,
  language: "en",
  speakerId: null,
  isDictated,
  isFinal: true,
  edited: false,
});

const ANSWER = "## Overview\n- We met [0:02]\n## Key points\n- Roadmap [0:02]";

function setup(options: { segments?: MeetingSegment[]; ready?: boolean; naming?: boolean } = {}) {
  const db = openDatabase(":memory:");
  const meetings = createMeetingsStore(db);
  meetings.create({ id: "m-1", title: "Sync", startedAt: 1, source: "ad_hoc", folder: "/f" });
  const summaries = createSummariesStore(db);
  const skills = createSkillsStore(db);
  let dictating = false;
  let generating = false;
  let id = 0;
  const changes: string[] = [];
  const waits: number[] = [];
  const generate = vi.fn(
    async (_request: { system: string; prompt: string; maxTokens: number }) => ANSWER,
  );
  const runner = createSummaryRunner({
    hasMeeting: (meetingId) => meetings.get(meetingId) !== null,
    segments: () => options.segments ?? [segment("s1", 2000), segment("d1", 3000, true)],
    notes: () => "my notes",
    summaries,
    skills,
    settings: () => ({ skillId: "meeting-summary", length: "medium" }),
    modelId: "model-1",
    modelReady: async () => options.ready ?? true,
    generate,
    dictating: () => dictating,
    generating: () => generating,
    wait: async (ms) => {
      waits.push(ms);
      dictating = false;
      generating = false;
    },
    now: () => 50,
    newId: () => `sum-${++id}`,
    onChange: (meetingId) => changes.push(meetingId),
    logger: { info() {}, warn() {}, error() {} },
    ...(options.naming
      ? {
          title: {
            wanted: () => true,
            set: (meetingId: string, title: string) =>
              void meetings.setGeneratedTitle(meetingId, title),
          },
        }
      : {}),
  });
  return {
    runner,
    meetings,
    summaries,
    generate,
    changes,
    waits,
    busy: () => {
      dictating = true;
      generating = true;
    },
  };
}

describe("summary runner", () => {
  it("names the meeting from its summary, and never over a name the owner gave", async () => {
    const t = setup({ naming: true });
    t.generate.mockResolvedValueOnce(ANSWER).mockResolvedValueOnce("Roadmap review");
    await t.runner.run("m-1");
    expect(t.meetings.get("m-1")?.title).toBe("Roadmap review");

    t.meetings.rename("m-1", "My name for it");
    t.generate.mockResolvedValueOnce(ANSWER).mockResolvedValueOnce("Something else");
    await t.runner.run("m-1");
    expect(t.meetings.get("m-1")?.title).toBe("My name for it");
  });

  it("keeps the summary when the meeting cannot be named", async () => {
    const t = setup({ naming: true });
    t.generate.mockResolvedValueOnce(ANSWER).mockRejectedValueOnce(new Error("no model"));
    await expect(t.runner.run("m-1")).resolves.toMatchObject({ version: 1 });
    expect(t.meetings.get("m-1")?.title).toBe("Sync");
  });

  it("does not name a meeting after a quick summary", async () => {
    const t = setup({ naming: true });
    await t.runner.run("m-1", { quick: true });
    expect(t.meetings.get("m-1")?.title).toBe("Sync");
  });

  it("writes a summary from the transcript without dictated lines and keeps each version", async () => {
    const t = setup();
    const first = await t.runner.run("m-1");
    expect(first).toMatchObject({
      version: 1,
      skillId: "meeting-summary",
      modelId: "model-1",
      quick: false,
    });
    expect(first.markdown).toContain("[0:02](seg:s1)");
    expect(t.generate.mock.calls[0]![0].prompt).not.toContain("d1");
    const second = await t.runner.run("m-1", { skillId: "decision-record" });
    expect(second).toMatchObject({ version: 2, skillName: "Decision record" });
    expect(t.summaries.list("m-1")).toHaveLength(2);
    expect(t.runner.status("m-1")).toEqual({ state: "idle" });
  });

  it("labels a quick summary, and the final one replaces it", async () => {
    const t = setup();
    expect((await t.runner.run("m-1", { quick: true })).quick).toBe(true);
    await t.runner.run("m-1");
    expect(t.summaries.list("m-1").map((s) => s.quick)).toEqual([false]);
  });

  it("explains what is missing instead of writing nothing", async () => {
    const none = setup({ segments: [] });
    await expect(none.runner.run("m-1")).rejects.toMatchObject({ code: "no-transcript" });
    const noModel = setup({ ready: false });
    await expect(noModel.runner.run("m-1")).rejects.toMatchObject({ code: "model-missing" });
    await expect(noModel.runner.run("gone")).rejects.toBeInstanceOf(SummaryError);
    const unknown = setup();
    await expect(unknown.runner.run("m-1", { skillId: "nope" })).resolves.toMatchObject({
      skillId: "meeting-summary",
    });
    expect(BUILT_IN_SKILLS[0]!.id).toBe("meeting-summary");
  });

  it("waits for a dictation and for another generation before it uses the model", async () => {
    const t = setup();
    t.busy();
    await t.runner.run("m-1");
    expect(t.waits).toEqual([1000]);
  });

  it("asks again when the model dropped a step for another request, and gives up after a few", async () => {
    const t = setup();
    const dropped = Object.assign(new Error("cancelled"), { retry: true });
    t.generate.mockRejectedValueOnce(dropped).mockResolvedValue(ANSWER);
    await t.runner.run("m-1");
    expect(t.generate).toHaveBeenCalledTimes(2);
    expect(t.waits).toContain(2000);

    const hopeless = setup();
    hopeless.generate.mockRejectedValue(dropped);
    await expect(hopeless.runner.run("m-1")).rejects.toMatchObject({ code: "failed" });
    expect(hopeless.runner.status("m-1")).toMatchObject({ state: "failed" });
  });

  it("writes one summary at a time and reports progress", async () => {
    const t = setup();
    let release: (text: string) => void = () => {};
    t.generate.mockImplementationOnce(() => new Promise<string>((resolve) => (release = resolve)));
    const first = t.runner.run("m-1");
    await Promise.resolve();
    await expect(t.runner.run("m-1")).rejects.toMatchObject({ code: "busy" });
    expect(t.runner.status("m-1")).toMatchObject({ state: "running" });
    release(ANSWER);
    await first;
    expect(t.changes.length).toBeGreaterThan(1);
  });
});
