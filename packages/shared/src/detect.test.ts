import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEETING_MATCHERS,
  matchersForOs,
  meetingMatcherSchema,
  meetingMatchersSchema,
} from "./detect";

describe("matchersForOs", () => {
  it("gives a Mac helper native and web, and a Windows helper windows and web", () => {
    const mac = matchersForOs(DEFAULT_MEETING_MATCHERS, "mac");
    const win = matchersForOs(DEFAULT_MEETING_MATCHERS, "windows");
    expect(mac.map((m) => m.id)).toEqual(["zoom", "meet", "teams"]);
    expect(mac.some((m) => "windows" in m)).toBe(false);
    expect(mac.find((m) => m.id === "zoom")?.native).toBeDefined();
    expect(win.map((m) => m.id)).toEqual(["zoom", "meet", "teams"]);
    expect(win.some((m) => "native" in m)).toBe(false);
    expect(win.find((m) => m.id === "zoom")?.windows?.processes).toEqual(["Zoom.exe"]);
    expect(win.find((m) => m.id === "teams")?.web).toBeDefined();
  });

  it("drops a matcher that has nothing for the OS", () => {
    const macOnly = {
      id: "facetime",
      name: "FaceTime",
      native: { bundleIds: ["a.b"], titles: ["x"] },
    };
    expect(matchersForOs([macOnly], "windows")).toEqual([]);
    expect(matchersForOs([macOnly], "mac")).toHaveLength(1);
  });

  it("accepts a matcher that only has windows, and refuses one with nothing", () => {
    expect(
      meetingMatcherSchema.safeParse({
        id: "webex",
        name: "Webex",
        windows: { processes: ["CiscoCollabHost.exe"], titles: ["Meeting"] },
      }).success,
    ).toBe(true);
    expect(meetingMatcherSchema.safeParse({ id: "x", name: "X" }).success).toBe(false);
  });
});

describe("the built-in matchers", () => {
  it("are valid", () => {
    expect(meetingMatchersSchema.safeParse(DEFAULT_MEETING_MATCHERS).success).toBe(true);
  });
});
