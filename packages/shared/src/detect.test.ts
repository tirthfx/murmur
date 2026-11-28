import { describe, expect, it } from "vitest";
import { DEFAULT_MEETING_MATCHERS, meetingMatcherSchema, meetingMatchersSchema } from "./detect";

describe("meeting matchers", () => {
  it("need something to match", () => {
    expect(meetingMatcherSchema.safeParse({ id: "x", name: "X" }).success).toBe(false);
    expect(
      meetingMatcherSchema.safeParse({
        id: "facetime",
        name: "FaceTime",
        native: { bundleIds: ["a.b"], titles: ["x"] },
      }).success,
    ).toBe(true);
  });

  it("built in are valid", () => {
    expect(meetingMatchersSchema.safeParse(DEFAULT_MEETING_MATCHERS).success).toBe(true);
  });
});
