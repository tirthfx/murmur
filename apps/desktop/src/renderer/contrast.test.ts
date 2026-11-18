import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// HB-22: our own colours, outside the Astryx theme, must read clearly. WCAG AA: 4.5:1 for
// text. The Astryx tokens are checked by the design system itself.

function hex(value: string): [number, number, number] {
  const text = value.trim();
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(text);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const h = text.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(color: string): number {
  const [r, g, b] = hex(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

function tokens(file: string): Record<string, string> {
  const css = readFileSync(new URL(file, import.meta.url), "utf8");
  return Object.fromEntries(
    [...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6}|rgba?\([^)]*\))/gi)].map((m) => [m[1]!, m[2]!]),
  );
}

describe("colour contrast (HB-22)", () => {
  it("the Bar's text and state colours read on its background", () => {
    const bar = tokens("./bar/bar.css");
    for (const name of ["bar-fg", "bar-muted", "bar-accent", "bar-ok", "bar-warn", "bar-error"]) {
      expect(contrast(bar[name]!, bar["bar-bg"]!), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the Focus overlay's text reads on its background", () => {
    expect(contrast("#f4f4f5", "rgb(20 20 22)")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#f4f4f5", "#1f1f22")).toBeGreaterThanOrEqual(4.5);
  });
});
