import path from "node:path";
import { describe, expect, it } from "vitest";
import { profilePaths } from "./profile";

const defaults = { appData: "/Users/me/Library/Application Support", userData: "/Users/me/ud" };

describe("profile paths", () => {
  it("uses the system folders by default", () => {
    expect(profilePaths({}, defaults)).toEqual({
      ...defaults,
      modelsAppData: defaults.appData,
      isOverridden: false,
    });
    expect(profilePaths({ MURMUR_PROFILE_DIR: "  " }, defaults).isOverridden).toBe(false);
  });

  it("moves everything under MURMUR_PROFILE_DIR", () => {
    expect(profilePaths({ MURMUR_PROFILE_DIR: "/tmp/clean" }, defaults)).toEqual({
      appData: path.resolve("/tmp/clean"),
      userData: path.join(path.resolve("/tmp/clean"), "electron"),
      modelsAppData: path.resolve("/tmp/clean"),
      isOverridden: true,
    });
  });

  it("can keep the models in the normal place", () => {
    const paths = profilePaths(
      { MURMUR_PROFILE_DIR: "/tmp/clean", MURMUR_SHARE_MODELS: "1" },
      defaults,
    );
    expect(paths.modelsAppData).toBe(defaults.appData);
    expect(paths.appData).toBe(path.resolve("/tmp/clean"));
  });
});
