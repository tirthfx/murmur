import { describe, expect, it } from "vitest";
import { askPrompt, numberSources, parseAnswer, SOURCE_TOKENS } from "./ask-answer";
import type { AskHit } from "./ask-index";

const hit = (id: number, over: Partial<AskHit> = {}): AskHit => ({
  id,
  meetingId: `m-${id}`,
  meetingTitle: `Meeting ${id}`,
  meetingStartedAt: Date.UTC(2026, 10, 21, 10, 0),
  source: "transcript",
  ref: `m-${id}:s1`,
  startMs: 754_000,
  text: `Owner: text of source ${id}`,
  score: -1,
  ...over,
});

describe("numberSources", () => {
  it("numbers the hits from 1 in order and keeps within the budget", () => {
    const big = Array.from({ length: 40 }, (_, i) => hit(i + 1, { text: "word ".repeat(150) }));
    const sources = numberSources(big);
    expect(sources[0]).toMatchObject({ n: 1 });
    expect(sources.map((s) => s.n)).toEqual(sources.map((_, i) => i + 1));
    expect(sources.length).toBeLessThan(40);
    expect(sources.length).toBeGreaterThan(2);
    const tokens = sources.reduce((total, s) => total + Math.ceil(s.hit.text.length / 3.5) + 30, 0);
    expect(tokens).toBeLessThanOrEqual(SOURCE_TOKENS);
  });

  it("always keeps the best hit, however long", () => {
    const sources = numberSources([hit(1, { text: "x".repeat(20_000) }), hit(2)]);
    expect(sources[0]!.hit.id).toBe(1);
  });
});

describe("askPrompt", () => {
  it("labels each source with the meeting, date, kind and time", () => {
    const prompt = askPrompt(
      "When do we ship?",
      numberSources([hit(1), hit(2, { source: "summary", startMs: null })]),
      new Date(2026, 10, 21, 12).getTime(),
    );
    expect(prompt.startsWith("Today is Saturday, 21 Nov 2026.")).toBe(true);
    expect(prompt).toContain("[1] (Meeting 1, 21 Nov 2026, transcript at 12:34)");
    expect(prompt).toContain("[2] (Meeting 2, 21 Nov 2026, summary)");
    expect(prompt.endsWith("Question: When do we ship?")).toBe(true);
  });
});

describe("parseAnswer", () => {
  it("keeps an answer and the sources it cites", () => {
    expect(parseAnswer("We ship on Thursday [2]. The load test comes first [1][3].", 3)).toEqual({
      kind: "answer",
      text: "We ship on Thursday [2]. The load test comes first [1][3].",
      cited: [1, 2, 3],
      dropped: [],
    });
  });

  it("reads several numbers in one bracket", () => {
    expect(parseAnswer("Both agreed [1, 2].", 2)).toMatchObject({
      text: "Both agreed [1][2].",
      cited: [1, 2],
    });
  });

  it("removes a number that is not a source, and says which", () => {
    expect(parseAnswer("It is Thursday [1] and the venue is Berlin [7].", 3)).toEqual({
      kind: "answer",
      text: "It is Thursday [1] and the venue is Berlin.",
      cited: [1],
      dropped: [7],
    });
    expect(parseAnswer("Yes [0][2][9].", 2)).toMatchObject({ cited: [2], dropped: [0, 9] });
  });

  it("does not accept an answer with no valid citation", () => {
    expect(parseAnswer("It is on Thursday.", 3)).toEqual({
      kind: "unsupported",
      reason: "uncited",
    });
    expect(parseAnswer("It is on Thursday [5].", 3)).toEqual({
      kind: "unsupported",
      reason: "uncited",
    });
  });

  it.each(["NOT_SUPPORTED", "  not_supported\n", '"NOT_SUPPORTED."', "", "   "])(
    "reads %j as not supported",
    (text) => {
      expect(parseAnswer(text, 3)).toEqual({ kind: "unsupported", reason: "model" });
    },
  );
});
