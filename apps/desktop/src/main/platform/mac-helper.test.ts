import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMacHelperBinary } from "./mac-helper";
import { createPlatformHelper } from "./index";

const base = {
  isPackaged: false,
  resourcesPath: "/App/Contents/Resources",
  appPath: "/repo/apps/desktop",
  env: {},
};
const releasePath = "/repo/native/helper-mac/.build/release/murmur-helper";
const debugPath = "/repo/native/helper-mac/.build/debug/murmur-helper";
const packagedPath = path.join("/App/Contents/Resources", "helper", "murmur-helper");
const silent = { info() {}, warn() {}, error() {} };

describe("resolveMacHelperBinary", () => {
  it("packaged: uses Resources/helper/murmur-helper", () => {
    expect(
      resolveMacHelperBinary({ ...base, isPackaged: true, exists: (p) => p === packagedPath }),
    ).toEqual({ path: packagedPath });
  });

  it("packaged: reports a missing binary instead of throwing", () => {
    const result = resolveMacHelperBinary({ ...base, isPackaged: true, exists: () => false });
    expect(result).toMatchObject({
      path: null,
      message: expect.stringContaining("missing from this build"),
    });
  });

  it("development: prefers the release build, then the debug build", () => {
    expect(resolveMacHelperBinary({ ...base, exists: () => true })).toEqual({ path: releasePath });
    expect(resolveMacHelperBinary({ ...base, exists: (p) => p === debugPath })).toEqual({
      path: debugPath,
    });
  });

  it("development: MURMUR_HELPER_PATH wins when it exists", () => {
    const env = { MURMUR_HELPER_PATH: "/custom/helper" };
    expect(resolveMacHelperBinary({ ...base, env, exists: () => true })).toEqual({
      path: "/custom/helper",
    });
    expect(resolveMacHelperBinary({ ...base, env, exists: () => false }).path).toBeNull();
  });

  it("packaged: ignores MURMUR_HELPER_PATH", () => {
    const result = resolveMacHelperBinary({
      ...base,
      isPackaged: true,
      env: { MURMUR_HELPER_PATH: "/custom/helper" },
      exists: (p) => p === packagedPath,
    });
    expect(result).toEqual({ path: packagedPath });
  });

  it("development: explains how to build when nothing is found", () => {
    expect(resolveMacHelperBinary({ ...base, exists: () => false })).toMatchObject({
      path: null,
      message: expect.stringContaining("npm run build:helper"),
    });
  });
});

describe("createPlatformHelper", () => {
  it("returns an unavailable helper on a platform without one", async () => {
    const helper = createPlatformHelper({
      ...base,
      platform: "linux",
      appVersion: "1.0.0",
      logger: silent,
    });
    await expect(helper.start()).rejects.toMatchObject({ code: "HELPER_UNAVAILABLE" });
    expect(helper.getStatus().state).toBe("unavailable");
    expect(helper.getStatus().message).toMatch(/linux/);
  });

  it("starts a missing macOS helper as unavailable without crashing", async () => {
    const helper = createPlatformHelper({
      ...base,
      platform: "darwin",
      appVersion: "1.0.0",
      exists: () => false,
      logger: silent,
    });
    await expect(helper.start()).rejects.toThrow(/has not been built/);
    expect(helper.getStatus().state).toBe("unavailable");
  });
});
