import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/database";
import { createMeetingsStore } from "./meetings-store";
import { groundRecap, recapPrompt, SYSTEM, type RecapLine } from "./recap";
import { createRecapRunner, RecapError } from "./recap-runner";
import { createRecapsStore } from "./recaps-store";

const line = (id: string | null, startMs: number, speaker: string, text: string): RecapLine => ({
  id,
  startMs,
  speaker,
  text,
});

const LINES: RecapLine[] = [
  line("s1", 600_000, "Dana", "The launch moves to Thursday."),
  line("s2", 660_000, "You", "Can QA finish by Wednesday?"),
  line("s3", 725_000, "Sam", "Yes, two bugs are left."),
  line(null, 790_000, "Dana", "And I will tell the customer."),
];
const WINDOW = { startMs: 600_000, endMs: 800_000 };

describe("recap prompt and grounding (NT-13)", () => {
  it("lists the lines with times and the names of the speakers", () => {
    const prompt = recapPrompt(LINES);
    expect(prompt).toContain("[10:00] Dana: The launch moves to Thursday.");
    expect(prompt).toContain("[11:00] You: Can QA finish by Wednesday?");
    expect(SYSTEM(false)).toContain("3 to 6 short bullets");
    expect(SYSTEM(true)).toContain("3 or 4");
    expect(SYSTEM(false)).toContain("You is the person reading");
  });

  it("keeps bullets whose time is inside the window and links it to the line", () => {
    const out = groundRecap(
      "- Dana moved the launch to Thursday [10:00]\n- Sam said two bugs are left [12:05]\n- Dana will tell the customer [13:10]",
      LINES,
      WINDOW,
    );
    expect(out.split("\n")).toEqual([
      "- Dana moved the launch to Thursday [10:00](seg:s1)",
      "- Sam said two bugs are left [12:05](seg:s3)",
      // The grey line has no segment to link to: the time is plain text.
      "- Dana will tell the customer [13:10]",
    ]);
  });

  it("drops a bullet whose time is outside the window, near no line, or missing", () => {
    const out = groundRecap(
      "- Earlier thing [05:00]\n- Far from any line [11:30]\n- No time at all\n- Good one [11:00]\n- Later thing [20:00]",
      LINES,
      WINDOW,
    );
    expect(out).toBe("- Good one [11:00](seg:s2)");
  });

  it("reads several times in a bracket and keeps only the valid ones", () => {
    const out = groundRecap("- Launch and QA [10:00, 11:00, 59:00]", LINES, WINDOW);
    expect(out).toBe("- Launch and QA [10:00](seg:s1) [11:00](seg:s2)");
  });

  it("keeps at most six bullets, the same bullet once, and no other text", () => {
    const many = Array.from({ length: 9 }, (_, i) => `- Point ${i} [10:00]`).join("\n");
    expect(
      groundRecap(
        `Here is a recap:\n${many}\n- point 0 [10:00]\nThat is all.`,
        LINES,
        WINDOW,
      ).split("\n"),
    ).toHaveLength(6);
    expect(groundRecap("- Same [10:00]\n- same [11:00]", LINES, WINDOW).split("\n")).toHaveLength(
      1,
    );
    expect(groundRecap("no bullets here [10:00]", LINES, WINDOW)).toBe("");
  });

  it("allows a few seconds of slack at the ends of the window", () => {
    const out = groundRecap(
      "- Just before the window [09:57]",
      [line("s0", 598_000, "Dana", "x"), ...LINES],
      WINDOW,
    );
    expect(out).toBe("- Just before the window [9:58](seg:s0)");
  });
});

function setup(over: Record<string, unknown> = {}) {
  const db = openDatabase(":memory:");
  const meetings = createMeetingsStore(db);
  meetings.create({ id: "m-1", title: "Sync", startedAt: 1, source: "ad_hoc", folder: "/m" });
  const recaps = createRecapsStore(db);
  const generate = vi
    .fn()
    .mockResolvedValue(
      "- Dana moved the launch to Thursday [10:00]\n- Sam said two bugs are left [12:05]\n- Dana will tell the customer [13:10]",
    );
  const onChange = vi.fn();
  const warn = vi.fn();
  const runner = createRecapRunner({
    position: (id) => (id === "m-1" ? { recording: true, nowMs: 800_000 } : null),
    lines: () => LINES,
    lastSummaryMs: () => null,
    windowMinutes: () => 10,
    recaps,
    modelId: "model-1",
    modelReady: async () => true,
    generate,
    dictating: () => false,
    generating: () => false,
    wait: async () => undefined,
    now: () => 5_000,
    newId: () => "r-1",
    onChange,
    logger: { info: vi.fn(), warn, error: vi.fn() } as never,
    ...over,
  });
  return { db, recaps, runner, generate, onChange, warn };
}

describe("recap runner (NT-13)", () => {
  it("writes a recap of the window, with bullets that carry times inside it, and keeps it", async () => {
    const t = setup();
    const recap = await t.runner.run("m-1");
    expect(recap).toMatchObject({
      id: "r-1",
      meetingId: "m-1",
      windowStartMs: 200_000,
      windowEndMs: 800_000,
    });
    const bullets = recap.markdown.split("\n");
    expect(bullets).toHaveLength(3);
    for (const bullet of bullets) {
      const [, mm, ss] = /\[(\d+):(\d{2})\]/.exec(bullet)!;
      const at = (Number(mm) * 60 + Number(ss)) * 1000;
      expect(at).toBeGreaterThanOrEqual(WINDOW.startMs - 5_000);
      expect(at).toBeLessThanOrEqual(WINDOW.endMs + 5_000);
    }
    expect(t.recaps.list("m-1")).toEqual([recap]);
    expect(t.runner.status("m-1")).toEqual({ state: "idle" });
    expect(t.onChange).toHaveBeenCalledWith("m-1");
  });

  it("covers only the last N minutes of a long meeting", async () => {
    const lines = [line("old", 60_000, "Dana", "very early"), ...LINES];
    const t = setup({ lines: () => lines, position: () => ({ recording: true, nowMs: 800_000 }) });
    await t.runner.run("m-1");
    expect((t.generate.mock.calls[0]![0] as { prompt: string }).prompt).not.toContain("very early");
  });

  it("covers only the time since the last summary when that is shorter", async () => {
    const t = setup({ lastSummaryMs: () => 700_000 });
    const recap = await t.runner.run("m-1");
    expect(recap.windowStartMs).toBe(700_000);
    const prompt = (t.generate.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).not.toContain("The launch moves to Thursday");
    expect(prompt).toContain("Yes, two bugs are left");
  });

  it("says so when nothing has been said, or nothing since the last summary, without asking the model", async () => {
    const quiet = setup({ lines: () => [] });
    await expect(quiet.runner.run("m-1")).rejects.toMatchObject({
      code: "no-text",
      message: expect.stringContaining("last 10 minutes"),
    });
    const summarised = setup({
      lastSummaryMs: () => 799_000,
      lines: () => [line("s9", 700_000, "Dana", "x")],
    });
    await expect(summarised.runner.run("m-1")).rejects.toMatchObject({
      code: "no-text",
      message: expect.stringContaining("since the last summary"),
    });
    expect(quiet.generate).not.toHaveBeenCalled();
    expect(summarised.generate).not.toHaveBeenCalled();
  });

  it("asks again with fewer bullets when nothing came back with a time inside the window", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce("- Something with no time\n- Another [59:59]")
      .mockResolvedValueOnce("- Dana moved the launch [10:00]");
    const t = setup({ generate });
    const recap = await t.runner.run("m-1");
    expect(generate).toHaveBeenCalledTimes(2);
    expect((generate.mock.calls[1]![0] as { system: string }).system).toContain("3 or 4");
    expect(recap.markdown).toBe("- Dana moved the launch [10:00](seg:s1)");
  });

  it("fails, keeping nothing, when the model gives no usable bullet twice", async () => {
    const t = setup({ generate: vi.fn().mockResolvedValue("I cannot do that.") });
    await expect(t.runner.run("m-1")).rejects.toMatchObject({ code: "failed" });
    expect(t.recaps.list("m-1")).toEqual([]);
    expect(t.runner.status("m-1")).toMatchObject({ state: "failed" });
    expect(t.warn).toHaveBeenCalled();
  });

  it("waits for a dictation and another generation", async () => {
    let busy = 2;
    const t = setup({ dictating: () => busy-- > 1 });
    await t.runner.run("m-1");
    expect(t.generate).toHaveBeenCalledOnce();
  });

  it("ignores a second request while one runs, and refuses a missing meeting or model", async () => {
    let release: (text: string) => void = () => undefined;
    const t = setup({
      generate: vi.fn().mockReturnValue(new Promise<string>((r) => (release = r))),
    });
    const first = t.runner.run("m-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(t.runner.run("m-1")).rejects.toBeInstanceOf(RecapError);
    await expect(t.runner.run("m-1")).rejects.toMatchObject({ code: "busy" });
    expect(t.runner.status("m-1")).toEqual({ state: "running" });
    release("- Dana moved the launch [10:00]");
    await first;
    await expect(setup().runner.run("nope")).rejects.toMatchObject({ code: "failed" });
    await expect(setup({ modelReady: async () => false }).runner.run("m-1")).rejects.toMatchObject({
      code: "model-missing",
    });
  });

  it("lists recaps newest first, and forgets them with the meeting", async () => {
    const t = setup();
    t.recaps.add({
      id: "a",
      meetingId: "m-1",
      windowStartMs: 0,
      windowEndMs: 1,
      markdown: "- x [0:00]",
      modelId: "m",
      at: 1,
    });
    t.recaps.add({
      id: "b",
      meetingId: "m-1",
      windowStartMs: 0,
      windowEndMs: 1,
      markdown: "- y [0:00]",
      modelId: "m",
      at: 2,
    });
    expect(t.recaps.list("m-1").map((r) => r.id)).toEqual(["b", "a"]);
    createMeetingsStore(t.db).remove("m-1");
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM recaps").get()).toEqual({ n: 0 });
  });
});
