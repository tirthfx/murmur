import { describe, expect, it } from "vitest";
import { REWRITE_PANEL_SIZE } from "@murmur/shared";
import { BAR_HEIGHT, BAR_WIDTH } from "../bar/bar-position";
import { createPanelWindowOptions, panelPosition } from "./panel-window";

const area = { x: 0, y: 25, width: 1440, height: 875 };

describe("panelPosition", () => {
  it("sits above the Bar, centred on it", () => {
    const bar: [number, number] = [580, 820];
    expect(panelPosition(bar, area)).toEqual({
      x: 580 + BAR_WIDTH / 2 - REWRITE_PANEL_SIZE.width / 2,
      y: 820 - 8 - REWRITE_PANEL_SIZE.height,
    });
  });

  it("goes below a Bar near the top, and stays on screen at the sides", () => {
    expect(panelPosition([0, 40], area)).toEqual({ x: 0, y: 40 + BAR_HEIGHT + 8 });
    expect(panelPosition([1400, 820], area).x).toBe(1440 - REWRITE_PANEL_SIZE.width);
  });

  it("is centred low on the screen without a Bar", () => {
    const { x, y } = panelPosition(null, area);
    expect(x).toBe((1440 - REWRITE_PANEL_SIZE.width) / 2);
    expect(y).toBeGreaterThan(area.y);
    expect(y + REWRITE_PANEL_SIZE.height).toBeLessThanOrEqual(area.y + area.height);
  });
});

describe("panel window options", () => {
  it("is a locked-down floating panel that can take typing", () => {
    const options = createPanelWindowOptions({
      preloadPath: "/p.cjs",
      isDevelopment: false,
      x: 1,
      y: 2,
    });
    expect(options).toMatchObject({
      type: "panel",
      focusable: true,
      alwaysOnTop: true,
      frame: false,
    });
    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false,
    });
  });
});
