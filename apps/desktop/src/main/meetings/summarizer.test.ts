import { describe, expect, it } from "vitest";
import { BUILT_IN_SKILLS, NOT_DISCUSSED, NO_SOURCE, formatElapsed } from "@murmur/shared";
import {
  CHUNK_TOKENS,
  chunkLines,
  estimateTokens,
  groundSummary,
  languageLine,
  NOT_WRITTEN,
  summarizeMeeting,
  transcriptLines,
  type SummarySegment,
} from "./summarizer";

const summary = BUILT_IN_SKILLS[0]!;

function segment(id: string, seconds: number, text = "We should ship on Friday."): SummarySegment {
  return { id, channel: seconds % 2 === 0 ? "mic" : "system", startMs: seconds * 1000, text };
}

/** A 60-minute call: a line about every 8 seconds, about 110 characters each. */
function hour(): SummarySegment[] {
  return Array.from({ length: 450 }, (_, i) =>
    segment(
      `m:${i % 2 === 0 ? "mic" : "system"}:${i}:0`,
      i * 8,
      `Point ${i}: the team talked through item ${i} of the plan and agreed who looks at it next week, ok.`,
    ),
  );
}

describe("transcript lines and chunks", () => {
  it("writes each segment with its time and who said it", () => {
    expect(transcriptLines([segment("b", 65), segment("a", 2)])).toEqual([
      "[0:02] Owner: We should ship on Friday.",
      "[1:05] Remote: We should ship on Friday.",
    ]);
  });

  it("cuts into whole-line parts that overlap a little", () => {
    const lines = Array.from(
      { length: 40 },
      (_, i) => `[0:${String(i).padStart(2, "0")}] Owner: ${"x".repeat(90)}`,
    );
    const chunks = chunkLines(lines, 300, 100);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) expect(estimateTokens(chunk.join("\n"))).toBeLessThanOrEqual(330);
    // The start of one part is the end of the one before.
    expect(chunks[0]!.slice(-3)).toEqual(chunks[1]!.slice(0, 3));
    expect(chunks.flat().filter((line, i, all) => all.indexOf(line) === i)).toEqual(lines);
  });
});

describe("grounding a summary", () => {
  const segments = [segment("s1", 2), segment("s2", 65), segment("s3", 754)];

  it("keeps the Skill's sections in order, drops the rest, and says Not discussed", () => {
    const output = [
      "Sure, here is the summary:",
      "## Key points",
      "- Ship on Friday [0:02]",
      "## Decisions",
      "Not discussed",
      "## Extra",
      "- ignored [1:05]",
    ].join("\n");
    const result = groundSummary(output, summary, segments);
    expect(result.split("\n").filter((line) => line.startsWith("## "))).toEqual(
      summary.sections.map((name) => `## ${name}`),
    );
    expect(result).toContain("- Ship on Friday [0:02](seg:s1)");
    expect(result).toContain(`## Decisions\n${NOT_DISCUSSED}`);
    expect(result).toContain(`## Overview\n${NOT_DISCUSSED}`);
    expect(result).not.toContain("Sure");
    expect(result).not.toContain("ignored");
  });

  it("links to the segment at the cited time, drops times that match nothing", () => {
    const output =
      "## Key points\n- Roadmap first [1:05] [12:34] [59:00]\n- Made up [40:00]\n- Same [1:06] [1:05]";
    const result = groundSummary(output, summary, segments);
    expect(result).toContain("- Roadmap first [1:05](seg:s2) [12:34](seg:s3)");
    expect(result).toContain(`- Made up (${NO_SOURCE})`);
    // 1:06 is the nearest to s2 and the same segment is linked once.
    expect(result).toContain("- Same [1:05](seg:s2)");
  });

  it("reads times grouped in one bracket, and keeps punctuation tidy", () => {
    const output = "## Key points\n- Roadmap first [1:05, 12:34].\n- Cut off mid [12:3";
    const result = groundSummary(output, summary, segments);
    expect(result).toContain("- Roadmap first. [1:05](seg:s2) [12:34](seg:s3)");
    expect(result).toContain(`- Cut off mid (${NO_SOURCE})`);
  });

  it("says Not written, not Not discussed, for sections an answer that was cut never reached", () => {
    const output = "## Overview\n- Start [0:02]\n## Key points\n- One [1:05]";
    const result = groundSummary(output, summary, segments, true);
    expect(result).toContain(`## Key points\n- One [1:05](seg:s2)`);
    expect(result).toContain(`## Decisions\n${NOT_WRITTEN}`);
    expect(groundSummary(output, summary, segments)).toContain(`## Decisions\n${NOT_DISCUSSED}`);
  });

  it("gives every bullet a link or No source", () => {
    const output = "## Key points\n- A [0:02]\n- B\n- C [9:99]\n* D [1:05]";
    for (const line of groundSummary(output, summary, segments)
      .split("\n")
      .filter((l) => l.startsWith("- "))) {
      expect(line).toMatch(/\(seg:[^)]+\)|\(No source\)$/);
    }
  });
});

describe("summary language (NT-20)", () => {
  it("writes in the transcript's language unless a language is chosen", () => {
    expect(languageLine(undefined)).toBe("Write in the language the transcript is in.");
    expect(languageLine("meeting")).toBe("Write in the language the transcript is in.");
    expect(languageLine("es")).toBe("Write in Spanish, whatever language the transcript is in.");
    expect(languageLine("hi-Latn")).toBe("Write in the language the transcript is in.");
  });
});

describe("summarising a meeting", () => {
  /** A model that notes the first time it sees in its prompt, and records every prompt. */
  function fakeModel() {
    const calls: { system: string; prompt: string; maxTokens: number }[] = [];
    return {
      calls,
      generate: async (request: { system: string; prompt: string; maxTokens: number }) => {
        calls.push(request);
        const times = [...request.prompt.matchAll(/\[(\d{1,2}(?::\d{2})+)\]/g)].map((m) => m[1]!);
        const mid = times[Math.floor(times.length / 2)] ?? "0:00";
        const sections = [...request.system.matchAll(/"## Heading": ([^.]+)\./g)][0]?.[1];
        if (!sections) return `- Noted something [${mid}]\n- And another [${times[0] ?? "0:00"}]`;
        return sections
          .split(", ")
          .map((name, i) =>
            i === 1 ? `## ${name}\nNot discussed` : `## ${name}\n- Point in ${name} [${mid}]`,
          )
          .join("\n");
      },
    };
  }

  it("a short meeting goes to the model once", async () => {
    const model = fakeModel();
    const result = await summarizeMeeting(model, {
      segments: [segment("s1", 2), segment("s2", 65)],
      notes: "Agenda: roadmap",
      skill: summary,
      length: "medium",
    });
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]!.prompt).toContain("The owner's own notes:\nAgenda: roadmap");
    expect(result).toContain("(seg:");
  });

  it("is asked to write in the chosen language", async () => {
    const model = fakeModel();
    await summarizeMeeting(model, {
      segments: [segment("s1", 2)],
      notes: "",
      skill: summary,
      length: "medium",
      language: "fr",
    });
    expect(model.calls[0]!.system).toContain(
      "Write in French, whatever language the transcript is in.",
    );
  });

  it("a 60-minute meeting fits the model context in every call", async () => {
    const model = fakeModel();
    const progress: [number, number][] = [];
    const segments = hour();
    const result = await summarizeMeeting(
      { ...model, onProgress: (done, total) => progress.push([done, total]) },
      { segments, notes: "", skill: summary, length: "long" },
    );
    expect(model.calls.length).toBeGreaterThan(3);
    for (const call of model.calls) {
      // The smallest context is 4,096 tokens; the prompt and the answer share it.
      expect(
        estimateTokens(call.system) + estimateTokens(call.prompt) + call.maxTokens,
      ).toBeLessThanOrEqual(4_096);
      expect(estimateTokens(call.prompt)).toBeLessThanOrEqual(CHUNK_TOKENS + 300);
    }
    // Everything said is in some part.
    const seen = model.calls.map((c) => c.prompt).join("\n");
    expect(seen).toContain("Point 0:");
    expect(seen).toContain("Point 449:");
    expect(progress.at(-1)![0]).toBe(model.calls.length);
    for (const line of result.split("\n").filter((l) => l.startsWith("- "))) {
      expect(line).toMatch(/\(seg:[^)]+\)|\(No source\)$/);
    }
    expect(result).toContain(`## Key points\n${NOT_DISCUSSED}`);
  });

  it("all 12 built-in Skills run and produce their declared sections", async () => {
    expect(BUILT_IN_SKILLS).toHaveLength(12);
    for (const skill of BUILT_IN_SKILLS) {
      const result = await summarizeMeeting(fakeModel(), {
        segments: [segment("s1", 2), segment("s2", 65)],
        notes: "",
        skill,
        length: skill.length,
      });
      expect(result.split("\n").filter((line) => line.startsWith("## "))).toEqual(
        skill.sections.map((name) => `## ${name}`),
      );
    }
    expect(formatElapsed(65_000)).toBe("1:05");
  });

  it("asks again with fewer bullets when the answer fills the room, and says what was not reached", async () => {
    const calls: string[] = [];
    const filler = `## Overview\n- ${"word ".repeat(1_000)}[0:02]`;
    const result = await summarizeMeeting(
      {
        generate: async (request) => {
          calls.push(request.system);
          return filler;
        },
      },
      { segments: [segment("s1", 2)], notes: "", skill: summary, length: "short" },
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("one time");
    expect(result).toContain(`## Key points\n${NOT_WRITTEN}`);
  });

  it("a section the model leaves out says Not discussed instead of being invented", async () => {
    const result = await summarizeMeeting(
      { generate: async () => "## Overview\n- Only this [0:02]" },
      { segments: [segment("s1", 2)], notes: "", skill: summary, length: "short" },
    );
    expect(result).toContain("## Decisions\nNot discussed");
  });
});
