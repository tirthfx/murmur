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
