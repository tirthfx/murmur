import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/database";
import { createAskIndex } from "./ask-index";
import { AskError, createAskRunner, scopeFilter } from "./ask-runner";
import { createAskStore } from "./ask-store";
import { createMeetingsStore } from "./meetings-store";

const NOW = new Date(2026, 10, 21, 12, 0).getTime();

function setup(over: Record<string, unknown> = {}) {
  const db = openDatabase(":memory:");
  const meetings = createMeetingsStore(db);
  const make = (id: string, title: string, startedAt: number) =>
    meetings.create({ id, title, startedAt, source: "ad_hoc", folder: `/m/${id}` });
  let n = 0;
  const say = (
    meetingId: string,
    startMs: number,
    text: string,
    channel: "mic" | "system" = "system",
  ) =>
    db
      .prepare(
        `INSERT INTO meeting_segments (id, meeting_id, channel, start_ms, end_ms, text, is_dictated, is_final, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1, 1)`,
      )
      .run(`${meetingId}:s${++n}`, meetingId, channel, startMs, startMs + 1000, text);
  make("m-1", "Launch review", new Date(2026, 10, 17, 10).getTime()); // Tuesday 17 Nov
  say("m-1", 5_000, "The Frankfurt server capacity is the main risk before launch.");
  say("m-1", 65_000, "We ship on Thursday if the load test passes.", "mic");
  make("m-2", "Budget call", new Date(2026, 10, 10, 10).getTime()); // Tuesday 10 Nov
  say("m-2", 3_000, "The travel budget for the offsite is approved.");
  say("m-2", 9_000, "We also ship swag to the offsite on Thursday.");

  const warn = vi.fn();
  const generate = vi.fn().mockResolvedValue("We ship on Thursday if the load test passes [1].");
  let counter = 0;
  const index = createAskIndex(db, { now: () => NOW });
  const store = createAskStore(db, { now: () => NOW + ++counter, newId: () => `a${++counter}` });
  const runner = createAskRunner({
    index,
    store,
    settings: () => ({ topK: 12, includeNotes: true }),
    modelReady: async () => true,
    generate,
    dictating: () => false,
    generating: () => false,
    wait: async () => undefined,
    now: () => NOW,
    logger: { info: vi.fn(), warn, error: vi.fn() } as never,
    ...over,
  });
  return { db, meetings, runner, store, generate, warn, say, make };
}

const all = { kind: "all" } as const;

/** A model that cites the source whose text has the phrase, as a good one would. */
const citing = (phrase: string) =>
  vi.fn().mockImplementation(async ({ prompt }: { prompt: string }) => {
    const block = prompt.split(/\n\n(?=\[\d+\] )/).find((part) => part.includes(phrase));
    const n = block ? /^(?:Sources:\n\n)?\[(\d+)\]/.exec(block)?.[1] : undefined;
    return n ? `The answer is in the meeting [${n}].` : "NOT_SUPPORTED";
  });

describe("ask runner (NT-14)", () => {
  it("cites the segment that holds the answer, and keeps the thread", async () => {
    const t = setup({ generate: citing("load test passes") });
    const thread = await t.runner.send({
      threadId: null,
      question: "When do we ship?",
      scope: all,
    });
    const answer = thread.messages.at(-1)!;
    expect(answer).toMatchObject({ role: "assistant", supported: true });
    expect(answer.text).toMatch(/^The answer is in the meeting \[\d\]\.$/);
    expect(answer.citations).toHaveLength(1);
    // The source is the piece of the Launch review that starts at its first line.
    expect(answer.citations[0]).toMatchObject({
      meetingId: "m-1",
      meetingTitle: "Launch review",
      source: "transcript",
      ref: "m-1:s1",
      startMs: 5_000,
      gone: false,
    });
    expect(answer.citations[0]!.excerpt).toContain("We ship on Thursday");
    expect(thread.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(t.store.list()).toHaveLength(1);
  });

  it("gives the model the numbered sources and tells it to use only them", async () => {
    const t = setup();
    await t.runner.send({ threadId: null, question: "When do we ship?", scope: all });
    const request = t.generate.mock.calls[0]![0] as { system: string; prompt: string };
    expect(request.system).toContain("using only the numbered sources");
    expect(request.system).toContain("NOT_SUPPORTED");
    expect(request.prompt).toMatch(/\[1\] \((Launch review|Budget call), /);
    expect(request.prompt).toContain("(Launch review");
    expect(request.prompt).toContain("(Budget call");
    expect(request.prompt).toContain("Question: When do we ship?");
  });

  it("answers 'not supported' and names the closest meetings when the model finds no answer", async () => {
    const t = setup({ generate: vi.fn().mockResolvedValue("NOT_SUPPORTED") });
    const thread = await t.runner.send({
      threadId: null,
      question: "When do we ship?",
      scope: all,
    });
    const answer = thread.messages.at(-1)!;
    expect(answer).toMatchObject({ supported: false, citations: [] });
    expect(answer.text).toContain("could not find an answer");
    expect(answer.closest.map((m) => m.title).sort()).toEqual(["Budget call", "Launch review"]);
  });

  it("answers 'not supported' without the model when nothing matches", async () => {
    const t = setup();
    const thread = await t.runner.send({
      threadId: null,
      question: "What about zebras?",
      scope: all,
    });
    expect(t.generate).not.toHaveBeenCalled();
    expect(thread.messages.at(-1)).toMatchObject({ supported: false, closest: [] });
    expect(thread.messages.at(-1)!.text).toContain("found nothing");
  });

  it("removes a citation number that is not a source, and logs it", async () => {
    const t = setup({
      generate: vi.fn().mockResolvedValue("We ship on Thursday [1] in Berlin [9]."),
    });
    const thread = await t.runner.send({
      threadId: null,
      question: "When do we ship?",
      scope: all,
    });
    const answer = thread.messages.at(-1)!;
    expect(answer.text).toBe("We ship on Thursday [1] in Berlin.");
    expect(answer.citations.map((c) => c.n)).toEqual([1]);
    expect(t.warn).toHaveBeenCalledWith(expect.stringContaining("9"));
  });

  it("does not keep an answer that cites nothing", async () => {
    const t = setup({ generate: vi.fn().mockResolvedValue("They ship on Thursday.") });
    const thread = await t.runner.send({
      threadId: null,
      question: "When do we ship?",
      scope: all,
    });
    expect(thread.messages.at(-1)).toMatchObject({ supported: false, citations: [] });
    expect(t.warn).toHaveBeenCalled();
  });

  it("leaves other meetings out of a scope", async () => {
    const t = setup();
    // Both meetings talk about shipping on Thursday; only Budget call is in scope.
    const thread = await t.runner.send({
      threadId: null,
      question: "When do we ship?",
      scope: { kind: "meetings", ids: ["m-2"] },
    });
    const prompt = (t.generate.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain("Budget call");
    expect(prompt).not.toContain("Launch review");
    expect(thread.messages.at(-1)!.citations[0]!.meetingId).toBe("m-2");
    expect(thread.scope).toEqual({ kind: "meetings", ids: ["m-2"] });
  });

  it("limits a date range to the days given, both ends included", async () => {
    const t = setup();
    await t.runner.send({
      threadId: null,
      question: "When do we ship?",
      scope: { kind: "range", from: "2026-11-17", to: "2026-11-17" },
    });
    const prompt = (t.generate.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain("Launch review");
    expect(prompt).not.toContain("Budget call");
    expect(scopeFilter({ kind: "range", from: "2026-11-17", to: "2026-11-17" })).toEqual({
      from: new Date(2026, 10, 17).getTime(),
      to: new Date(2026, 10, 18).getTime(),
    });
    expect(scopeFilter({ kind: "all" })).toEqual({});
  });

  it("turns 'last Tuesday' in the question into a date range", async () => {
    const generate = citing("load test passes");
    const t = setup({ generate });
    // Today is Saturday 21 Nov: last Tuesday is the 17th.
    await t.runner.send({
      threadId: null,
      question: "What did we say last Tuesday about shipping?",
      scope: all,
    });
    const prompt = (generate.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain("Launch review");
    expect(prompt).not.toContain("Budget call");
    // The model is told the dates were applied, so it does not look for them in the text.
    expect(prompt).toContain("already limited to meetings from 17 Nov 2026");
  });

  it("can leave the owner's notes out", async () => {
    const t = setup();
    t.db
      .prepare(
        "INSERT INTO meeting_notes (meeting_id, body_md, updated_at) VALUES ('m-1', 'Secret zebra plan', 1)",
      )
      .run();
    const generate = vi.fn().mockResolvedValue("There is a plan [1].");
    const withNotes = setup({ generate });
    withNotes.db
      .prepare(
        "INSERT INTO meeting_notes (meeting_id, body_md, updated_at) VALUES ('m-1', 'Secret zebra plan', 1)",
      )
      .run();
    await withNotes.runner.send({ threadId: null, question: "zebra plan?", scope: all });
    expect((generate.mock.calls[0]![0] as { prompt: string }).prompt).toContain("zebra");

    const without = setup({ settings: () => ({ topK: 12, includeNotes: false }) });
    without.db
      .prepare(
        "INSERT INTO meeting_notes (meeting_id, body_md, updated_at) VALUES ('m-1', 'Secret zebra plan', 1)",
      )
      .run();
    const thread = await without.runner.send({
      threadId: null,
      question: "zebra plan?",
      scope: all,
    });
    expect(without.generate).not.toHaveBeenCalled();
    expect(thread.messages.at(-1)!.supported).toBe(false);
  });

  it("carries on in a thread and updates its scope", async () => {
    const t = setup();
    const first = await t.runner.send({ threadId: null, question: "When do we ship?", scope: all });
    const second = await t.runner.send({
      threadId: first.id,
      question: "And the budget?",
      scope: { kind: "meetings", ids: ["m-2"] },
    });
    expect(second.id).toBe(first.id);
    expect(second.messages).toHaveLength(4);
    expect(second.scope).toEqual({ kind: "meetings", ids: ["m-2"] });
  });

  it("waits for a dictation and for another generation", async () => {
    let busy = 2;
    const t = setup({ dictating: () => busy-- > 1 });
    await t.runner.send({ threadId: null, question: "When do we ship?", scope: all });
    expect(busy).toBeLessThan(1);
    expect(t.generate).toHaveBeenCalledOnce();
  });

  it.each([
    ["an empty question", { question: "   " }, "invalid"],
    [
      "dates the wrong way round",
      { scope: { kind: "range", from: "2026-11-20", to: "2026-11-01" } },
      "invalid",
    ],
    ["a thread that is gone", { threadId: "nope" }, "not-found"],
  ])("refuses %s", async (_label, input, code) => {
    const t = setup();
    await expect(
      t.runner.send({
        threadId: null,
        question: "When do we ship?",
        scope: all,
        ...input,
      } as never),
    ).rejects.toMatchObject({ code });
    expect(t.generate).not.toHaveBeenCalled();
    expect(t.store.list()).toEqual([]);
  });

  it("asks for the model when it is missing, before anything is kept", async () => {
    const t = setup({ modelReady: async () => false });
    await expect(
      t.runner.send({ threadId: null, question: "When do we ship?", scope: all }),
    ).rejects.toMatchObject({ code: "model-missing" });
    expect(t.store.list()).toEqual([]);
  });

  it("answers one question at a time, and reports a model failure", async () => {
    let release: (text: string) => void = () => undefined;
    const t = setup({
      generate: vi.fn().mockReturnValue(new Promise<string>((r) => (release = r))),
    });
    const first = t.runner.send({ threadId: null, question: "When do we ship?", scope: all });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(
      t.runner.send({ threadId: null, question: "Another?", scope: all }),
    ).rejects.toMatchObject({ code: "busy" });
    release("Thursday [1].");
    await first;

    const broken = vi.fn().mockRejectedValue(new Error("boom"));
    const failing = setup({ generate: broken });
    const error = await failing.runner
      .send({ threadId: null, question: "When do we ship?", scope: all })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AskError);
    expect(error).toMatchObject({ code: "failed" });
    // The next question can be asked.
    broken.mockResolvedValue("Thursday [1].");
    await expect(
      failing.runner.send({ threadId: null, question: "When do we ship?", scope: all }),
    ).resolves.toBeTruthy();
  });
});
