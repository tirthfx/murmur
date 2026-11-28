import { defaultMeetingTitle } from "./meetings";
import { describe, expect, it } from "vitest";

describe("the title of a new meeting (NT-03)", () => {
  it("fills the format, and falls back when it is empty", () => {
    const at = Date.UTC(2026, 0, 5, 9, 30);
    expect(defaultMeetingTitle(at, "en-GB", "Call {date}")).toBe("Call 5 Jan 2026");
    expect(defaultMeetingTitle(at, "en-GB", "  ")).toMatch(/^Meeting, /);
  });
});
