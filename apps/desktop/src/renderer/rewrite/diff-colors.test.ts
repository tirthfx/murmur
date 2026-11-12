import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The diff colours (RW-06) must read clearly in both themes: WCAG AA, 4.5:1 for text.
const css = readFileSync(new URL("./rewrite.css", import.meta.url), "utf8");

function block(source: string): Record<string, string> {
  return Object.fromEntries(
    [...source.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((match) => [match[1]!, match[2]!]),
  );
}

const light = block(css.slice(0, css.indexOf("@media")));
const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
const dark = block(css.slice(darkStart, css.indexOf("}\n}", darkStart)));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

describe("diff colours", () => {
  for (const [theme, colours] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    it(`pass 4.5:1 in the ${theme} theme`, () => {
      expect(Object.keys(colours)).toEqual(
        expect.arrayContaining([
          "diff-added-bg",
          "diff-added-fg",
          "diff-removed-bg",
          "rewrite-card-bg",
        ]),
      );
      expect(contrast(colours["diff-added-fg"]!, colours["diff-added-bg"]!)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        contrast(colours["diff-removed-fg"]!, colours["diff-removed-bg"]!),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(colours["rewrite-card-fg"]!, colours["rewrite-card-bg"]!),
      ).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("uses different colours for each theme", () => {
    expect(light["diff-added-bg"]).not.toBe(dark["diff-added-bg"]);
  });
});
