import { describe, expect, it } from "vitest";
import { DIFF_MAX_CHARS, tokenize, wordDiff } from "./word-diff";

const show = (source: string, result: string) =>
  (wordDiff(source, result).parts ?? [])
    .map((part) =>
      part.kind === "same"
        ? part.text
        : part.kind === "added"
          ? `[+${part.text}]`
          : `[-${part.text}]`,
    )
    .join("");

describe("wordDiff", () => {
  it("shows exactly the removed and added words of a known pair", () => {
    const diff = wordDiff(
      "So basically the meeting moved to Thursday at 3:30.",
      "The meeting moved to Friday at 3:30.",
    );
    expect(diff.removed).toBe(4);
    expect(diff.added).toBe(2);
    expect(
      show(
        "So basically the meeting moved to Thursday at 3:30.",
        "The meeting moved to Friday at 3:30.",
      ),
    ).toBe("[-So basically the ][+The ]meeting moved to [-Thursday ][+Friday ]at 3:30.");
  });

  it("rebuilds the result exactly, and the source's words, from its parts", () => {
    const source = "We have three options: rebuild, add a node, or wait.";
    const result = "Three options: rebuild the cache, add a node, or wait a day.";
    const parts = wordDiff(source, result).parts!;
    // Words both share are shown with the result's spacing.
    const squash = (text: string) => text.replace(/\s+/g, "");
    expect(
      squash(
        parts
          .filter((part) => part.kind !== "added")
          .map((part) => part.text)
          .join(""),
      ),
    ).toBe(squash(source));
    expect(
      parts
        .filter((part) => part.kind !== "removed")
        .map((part) => part.text)
        .join(""),
    ).toBe(result);
  });

  it("finds nothing to change in equal texts, and handles empty ones", () => {
    expect(wordDiff("Same text.", "Same text.")).toEqual({
      parts: [{ kind: "same", text: "Same text." }],
      added: 0,
      removed: 0,
    });
    expect(wordDiff("", "New words")).toMatchObject({ added: 2, removed: 0 });
    expect(wordDiff("Old words", "")).toMatchObject({ added: 0, removed: 2 });
  });

  it("counts punctuation changes without counting them as words", () => {
    expect(wordDiff("its done", "It's done.")).toMatchObject({ added: 1, removed: 1 });
  });

  it("shows counts only for text over 20,000 characters", () => {
    const long = "word ".repeat(DIFF_MAX_CHARS / 8);
    const diff = wordDiff(long, `${long} extra words here`);
    expect(diff.parts).toBeNull();
    expect(diff).toMatchObject({ added: 3, removed: 0 });
  });

  it("handles a full 8,000-character rewrite quickly, falling back to counts", () => {
    const words = (seed: string) =>
      Array.from({ length: 1400 }, (_, index) => `${seed}${index % 97}`).join(" ");
    const started = performance.now();
    const diff = wordDiff(words("a"), words("b"));
    expect(performance.now() - started).toBeLessThan(1500);
    expect(diff.added).toBeGreaterThan(0);
    expect(diff.removed).toBeGreaterThan(0);
  });

  it("finds a few edits in a long text word by word", () => {
    const base = Array.from({ length: 1200 }, (_, index) => `w${index}`).join(" ");
    const edited = base.replace("w600", "changed").replace("w10 ", "");
    const diff = wordDiff(base, edited);
    expect(diff.parts).not.toBeNull();
    expect(diff).toMatchObject({ added: 1, removed: 2 });
  });

  it("keeps the spaces after each token", () => {
    expect(tokenize("Hi,  there!").map((token) => token.text)).toEqual(["Hi", ",  ", "there", "!"]);
  });
});
