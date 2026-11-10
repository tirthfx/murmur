import { describe, expect, it } from "vitest";
import { HUB_MIN_HEIGHT, HUB_MIN_WIDTH, createHubWindowOptions } from "./window-options";

const base = { preloadPath: "/app/preload.cjs", platform: "darwin", isDevelopment: false };

describe("createHubWindowOptions", () => {
  it("enables the renderer hardening switches", () => {
    const prefs = createHubWindowOptions(base).webPreferences;
    expect(prefs?.contextIsolation).toBe(true);
    expect(prefs?.sandbox).toBe(true);
    expect(prefs?.nodeIntegration).toBe(false);
    expect(prefs?.nodeIntegrationInWorker).toBe(false);
    expect(prefs?.nodeIntegrationInSubFrames).toBe(false);
    expect(prefs?.webSecurity).toBe(true);
    expect(prefs?.allowRunningInsecureContent).toBe(false);
    expect(prefs?.webviewTag).toBe(false);
  });

  it("does not use the removed remote module", () => {
    const prefs = createHubWindowOptions(base).webPreferences as Record<string, unknown>;
    expect(prefs).not.toHaveProperty("enableRemoteModule");
  });

  it("loads the given preload script", () => {
    expect(createHubWindowOptions(base).webPreferences?.preload).toBe("/app/preload.cjs");
  });

  it("allows developer tools in development builds only", () => {
    expect(createHubWindowOptions({ ...base, isDevelopment: true }).webPreferences?.devTools).toBe(
      true,
    );
    expect(createHubWindowOptions(base).webPreferences?.devTools).toBe(false);
  });

  it("sets a sensible minimum size", () => {
    const options = createHubWindowOptions(base);
    expect(options.minWidth).toBe(HUB_MIN_WIDTH);
    expect(options.minHeight).toBe(HUB_MIN_HEIGHT);
    expect(options.width).toBeGreaterThanOrEqual(HUB_MIN_WIDTH);
    expect(options.height).toBeGreaterThanOrEqual(HUB_MIN_HEIGHT);
  });

  it("uses a hidden inset title bar on macOS only", () => {
    expect(createHubWindowOptions(base).titleBarStyle).toBe("hiddenInset");
    expect(createHubWindowOptions({ ...base, platform: "linux" }).titleBarStyle).toBeUndefined();
  });
});
