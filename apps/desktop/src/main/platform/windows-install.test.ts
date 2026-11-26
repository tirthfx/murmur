import { describe, expect, it, vi } from "vitest";
import { installerStartup, trayIcon, appIdentity } from "./index";
import { squirrelStartup } from "./windows-install";

const EXE = "C:\\Users\\a\\AppData\\Local\\Murmur\\app-1.0.0\\Murmur.exe";
const UPDATER = "C:\\Users\\a\\AppData\\Local\\Murmur\\Update.exe";

describe("the Windows installer's starts", () => {
  it.each([
    ["--squirrel-install", "--createShortcut"],
    ["--squirrel-updated", "--createShortcut"],
    ["--squirrel-uninstall", "--removeShortcut"],
  ])("on %s asks the updater to %s and quits", async (event, action) => {
    const run = vi.fn(async () => {});
    const work = squirrelStartup([EXE, event, "1.0.0"], EXE, run);
    expect(work).not.toBeNull();
    await work;
    expect(run).toHaveBeenCalledWith(UPDATER, [action, "Murmur.exe"]);
  });

  it("quits at once for a version being replaced", async () => {
    const run = vi.fn(async () => {});
    await squirrelStartup([EXE, "--squirrel-obsolete"], EXE, run);
    expect(run).not.toHaveBeenCalled();
  });

  it("starts as usual otherwise", () => {
    const run = vi.fn(async () => {});
    expect(squirrelStartup([EXE], EXE, run)).toBeNull();
    expect(squirrelStartup([EXE, "--squirrel-firstrun"], EXE, run)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("is looked at on Windows only", () => {
    expect(installerStartup("darwin", [EXE, "--squirrel-install"], EXE)).toBeNull();
  });
});

describe("how each OS knows the app", () => {
  it("keeps one copy running and names itself on Windows", () => {
    expect(appIdentity("win32")).toEqual({
      singleInstance: true,
      userModelId: "com.squirrel.Murmur.Murmur",
    });
    expect(appIdentity("darwin")).toEqual({ singleInstance: false, userModelId: null });
  });

  it("draws a template icon on a Mac and a coloured one on Windows", () => {
    expect(trayIcon("darwin")).toEqual({ template: true, rgb: [0, 0, 0] });
    expect(trayIcon("win32").template).toBe(false);
  });
});
