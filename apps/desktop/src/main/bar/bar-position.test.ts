import { describe, expect, it } from "vitest";
import {
  BAR_HEIGHT,
  BAR_WIDTH,
  BOTTOM_MARGIN,
  defaultPosition,
  parseSaved,
  restorePosition,
  toSaved,
  type DisplayArea,
} from "./bar-position";

const laptop: DisplayArea = { id: 1, workArea: { x: 0, y: 25, width: 1512, height: 920 } };
const monitor: DisplayArea = { id: 2, workArea: { x: 1512, y: 0, width: 2560, height: 1415 } };

describe("bar position", () => {
  it("defaults to bottom centre, 24 px above the bottom of the work area", () => {
    expect(defaultPosition(laptop)).toEqual({
      x: Math.round((1512 - BAR_WIDTH) / 2),
      y: 25 + 920 - BAR_HEIGHT - BOTTOM_MARGIN,
    });
  });

  it("round-trips a dragged position on the same display", () => {
    const point = { x: 300, y: 100 };
    const saved = toSaved(point, [laptop, monitor]);
    expect(saved?.displayId).toBe(1);
    expect(restorePosition(saved, [laptop, monitor], laptop)).toEqual(point);
  });

  it("remembers the second display", () => {
    const saved = toSaved({ x: 2000, y: 700 }, [laptop, monitor]);
    expect(saved?.displayId).toBe(2);
    expect(restorePosition(saved, [laptop, monitor], laptop)).toEqual({ x: 2000, y: 700 });
  });

  it("keeps the same relative spot when the resolution changes", () => {
    const saved = toSaved({ x: 1512 - BAR_WIDTH, y: 25 }, [laptop])!;
    const bigger: DisplayArea = { id: 1, workArea: { x: 0, y: 25, width: 1800, height: 1100 } };
    expect(restorePosition(saved, [bigger], bigger)).toEqual({ x: 1800 - BAR_WIDTH, y: 25 });
  });

  it("falls back to the default when the saved display is gone", () => {
    const saved = toSaved({ x: 2000, y: 700 }, [laptop, monitor]);
    expect(restorePosition(saved, [laptop], laptop)).toEqual(defaultPosition(laptop));
    expect(restorePosition(null, [laptop], laptop)).toEqual(defaultPosition(laptop));
  });

  it("clamps a position dragged partly off screen", () => {
    const saved = toSaved({ x: -500, y: 5000 }, [laptop])!;
    expect(saved.rx).toBe(0);
    expect(saved.ry).toBe(1);
  });

  it("accepts only well-formed saved data", () => {
    expect(parseSaved({ displayId: 1, rx: 0.5, ry: 1 })).toEqual({ displayId: 1, rx: 0.5, ry: 1 });
    expect(parseSaved({ displayId: 1, rx: 2, ry: 0 })).toBeNull();
    expect(parseSaved({ displayId: "1", rx: 0, ry: 0 })).toBeNull();
    expect(parseSaved("nope")).toBeNull();
    expect(parseSaved(null)).toBeNull();
  });
});
