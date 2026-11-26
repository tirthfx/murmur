import { BAR_WIDTH, dock } from "./bar-position";
import { describe, expect, it } from "vitest";
import { createBarWindowOptions } from "./bar-window";

describe("bar window options", () => {
  const options = createBarWindowOptions({
    preloadPath: "/p/bar-preload.cjs",
    isDevelopment: false,
    x: 10,
    y: 20,
  });

  it("can never take keyboard focus", () => {
    expect(options.focusable).toBe(false);
    expect(options.type).toBe("panel");
    expect(options.show).toBe(false);
  });

  it("floats as a transparent pill without a frame", () => {
    expect(options).toMatchObject({
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      x: 10,
      y: 20,
    });
  });

  it("keeps the locked-down web preferences", () => {
    expect(options.webPreferences).toMatchObject({
      preload: "/p/bar-preload.cjs",
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      devTools: false,
    });
  });
});

describe("docking a dropped Bar (DC-07)", () => {
  const displays = [{ id: 1, workArea: { x: 0, y: 0, width: 1000, height: 800 } }];

  it("snaps to a near side edge and stays put elsewhere", () => {
    expect(dock({ x: 10, y: 100 }, displays)).toEqual({ x: 0, y: 100 });
    expect(dock({ x: 1000 - BAR_WIDTH - 5, y: 100 }, displays)).toEqual({
      x: 1000 - BAR_WIDTH,
      y: 100,
    });
    expect(dock({ x: 300, y: 100 }, displays)).toEqual({ x: 300, y: 100 });
  });
});
