import { describe, expect, it } from "vitest";
import { createPrefaceFilter, repeatsInstruction, stripPreface } from "./output";

describe("stripPreface", () => {
  it.each([
    [
      "Sure! Here is the rewritten text:\nThe meeting moved to Friday.",
      "The meeting moved to Friday.",
    ],
    ["Here's a tighter version:\n\nShip it Monday.", "Ship it Monday."],
    ["Certainly.\nHere is the result:\nDone.", "Done."],
    ["Below is the structured text:\n- One\n- Two", "- One\n- Two"],
    ['"Ship it Monday."', "Ship it Monday."],
    ["<text>\nShip it Monday.\n</text>", "Ship it Monday."],
    ["```\nconst a = 1;\n```", "const a = 1;"],
  ])("cleans %j", (answer, expected) => {
    expect(stripPreface(answer)).toBe(expected);
  });

  it("keeps text that only looks like a preface", () => {
    expect(stripPreface("Here is what we agreed: Friday at 3.")).toBe(
      "Here is what we agreed: Friday at 3.",
    );
    expect(stripPreface('He said "yes" and "no".')).toBe('He said "yes" and "no".');
    expect(stripPreface("Note: the build is green.")).toBe("Note: the build is green.");
  });
});

describe("repeatsInstruction", () => {
  const instruction = "Make it shorter. Remove repeats and filler, keep every fact.";

  it("spots an answer that starts with the instruction or contains a long run of it", () => {
    expect(repeatsInstruction("Make it shorter. Remove repeats and filler.", instruction)).toBe(
      true,
    );
    expect(
      repeatsInstruction(
        "Sure, make it shorter: remove repeats and filler, keep every fact.",
        instruction,
      ),
    ).toBe(true);
  });

  it("accepts a normal answer, and ignores very short instructions", () => {
    expect(repeatsInstruction("We ship on Friday.", instruction)).toBe(false);
    expect(repeatsInstruction("Shorter", "Shorter")).toBe(false);
  });
});

describe("createPrefaceFilter", () => {
  function run(chunks: string[]) {
    const out: string[] = [];
    const filter = createPrefaceFilter((chunk) => out.push(chunk));
    for (const chunk of chunks) filter.push(chunk);
    const all = filter.end();
    return { out, all };
  }

  it("holds the first line, drops a preface, then streams", () => {
    const { out, all } = run(["Sure! Here", " is the text:", "\nThe ", "meeting ", "moved."]);
    expect(all).toBe("The meeting moved.");
    expect(out.slice(1)).toEqual(["meeting ", "moved."]);
  });

  it("waits past a bare acknowledgement line", () => {
    const { all } = run(["Sure!\n", "Here is the result:\n", "Done."]);
    expect(all).toBe("Done.");
  });

  it("passes a plain answer through, and releases a short one at the end", () => {
    expect(run(["One line\n", "two"]).all).toBe("One line\ntwo");
    expect(run(["Short."]).all).toBe("Short.");
  });

  it("releases after 160 characters without a line break", () => {
    const long = "word ".repeat(40);
    const { out } = run([long]);
    expect(out[0]).toBe(long);
  });
});
