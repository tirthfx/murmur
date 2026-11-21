import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MEETING_MATCHERS } from "@murmur/shared";
import { loadMeetingMatchers } from "./matchers-file";

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe("meeting matchers file", () => {
  it("uses the built-in matchers when there is no file", () => {
    expect(loadMeetingMatchers(() => null, logger())).toEqual(DEFAULT_MEETING_MATCHERS);
    expect(
      loadMeetingMatchers(() => {
        throw new Error("denied");
      }, logger()),
    ).toEqual(DEFAULT_MEETING_MATCHERS);
  });

  it("replaces them with a valid file", () => {
    const file = [
      {
        id: "webex",
        name: "Webex",
        native: { bundleIds: ["Cisco-Systems.Spark"], titles: ["Meeting"] },
      },
    ];
    expect(loadMeetingMatchers(() => JSON.stringify(file), logger())).toEqual(file);
  });

  it("ignores a file that is not valid and says so", () => {
    const log = logger();
    expect(loadMeetingMatchers(() => "{", log)).toEqual(DEFAULT_MEETING_MATCHERS);
    expect(loadMeetingMatchers(() => JSON.stringify([{ id: "x" }]), log)).toEqual(
      DEFAULT_MEETING_MATCHERS,
    );
    expect(log.warn).toHaveBeenCalledTimes(2);
  });
});
