import { describe, expect, it, vi } from "vitest";
import type { MeetingSegment } from "@murmur/shared";
import { createTaskRunner, TaskError } from "./tasks-runner";

const segment = (over: Partial<MeetingSegment> = {}): MeetingSegment => ({
  id: "s1",
  meetingId: "m-1",
  channel: "mic",
  startMs: 5_000,
  endMs: 8_000,
  text: "I will send the budget.",
  language: "en",
  speakerId: null,
  isDictated: false,
  isFinal: true,
  edited: false,
  ...over,
});

function setup(over: Record<string, unknown> = {}) {
  const addSuggested = vi.fn().mockReturnValue(1);
  const generate = vi
    .fn()
    .mockResolvedValue('{"tasks":[{"title":"Send the budget","owner":"me","time":"0:05"}]}');
  const onChange = vi.fn();
  const warn = vi.fn();
  const runner = createTaskRunner({
    hasMeeting: () => true,
    startedAt: () => Date.UTC(2026, 10, 21),
    segments: () => [segment(), segment({ id: "s2", isDictated: true, text: "dictated" })],
    tasks: { addSuggested },
    maxPerMeeting: () => 15,
    modelReady: async () => true,
    generate,
    dictating: () => false,
    generating: () => false,
    wait: async () => undefined,
    onChange,
    logger: { info: vi.fn(), warn, error: vi.fn() } as never,
    ...over,
  });
  return { runner, addSuggested, generate, onChange, warn };
}

describe("task runner (NT-26)", () => {
  it("adds the suggested tasks it found, leaving dictated lines out", async () => {
    const t = setup();
    expect(await t.runner.run("m-1")).toEqual({ added: 1 });
    expect(t.addSuggested).toHaveBeenCalledWith("m-1", [
      expect.objectContaining({ title: "Send the budget", ownerIsMe: true, sourceSegmentId: "s1" }),
    ]);
    expect((t.generate.mock.calls[0]![0] as { prompt: string }).prompt).not.toContain("dictated");
    expect(t.runner.status("m-1")).toEqual({ state: "idle" });
  });

  it("creates no rows for invalid JSON, and keeps a note", async () => {
    const t = setup({ generate: vi.fn().mockResolvedValue("nope") });
    const result = await t.runner.run("m-1");
    expect(result).toMatchObject({ added: 0, note: expect.stringContaining("JSON") });
    expect(t.addSuggested).not.toHaveBeenCalled();
    expect(t.warn).toHaveBeenCalled();
  });

  it("waits for a dictation and for another generation", async () => {
    let busy = 2;
    const t = setup({
      dictating: () => busy-- > 1,
      generating: () => false,
    });
    await t.runner.run("m-1");
    expect(busy).toBeLessThan(1);
    expect(t.generate).toHaveBeenCalledOnce();
  });

  it.each([
    ["the meeting is gone", { hasMeeting: () => false }, "failed"],
    ["there is no transcript", { segments: () => [] }, "no-transcript"],
    ["the model is missing", { modelReady: async () => false }, "model-missing"],
  ])("refuses when %s", async (_label, over, code) => {
    const t = setup(over);
    await expect(t.runner.run("m-1")).rejects.toMatchObject({ code });
    expect(t.generate).not.toHaveBeenCalled();
  });

  it("reads one meeting at a time, and shows the failure of a call", async () => {
    let release: (text: string) => void = () => undefined;
    const t = setup({
      generate: vi.fn().mockReturnValue(new Promise<string>((resolve) => (release = resolve))),
    });
    const first = t.runner.run("m-1");
    await Promise.resolve();
    await Promise.resolve();
    await expect(t.runner.run("m-2")).rejects.toBeInstanceOf(TaskError);
    expect(t.runner.status("m-1")).toEqual({ state: "running" });
    release('{"tasks":[]}');
    await first;

    const failing = setup({ generate: vi.fn().mockRejectedValue(new Error("boom")) });
    await expect(failing.runner.run("m-1")).rejects.toMatchObject({ code: "failed" });
    expect(failing.runner.status("m-1")).toMatchObject({ state: "failed" });
  });
});
