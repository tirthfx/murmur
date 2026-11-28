import { describe, expect, it } from "vitest";
import { absolutePathSchema, captureStartPayloadSchema, isAbsolutePath } from "./index";

describe("isAbsolutePath", () => {
  it("accepts an absolute path", () => {
    expect(isAbsolutePath("/Users/me/Library")).toBe(true);
  });

  it("refuses a relative path and an empty string", () => {
    for (const path of ["", "meetings/one", "./x", "~/x"]) {
      expect(isAbsolutePath(path), path).toBe(false);
    }
    expect(absolutePathSchema.safeParse("relative").success).toBe(false);
  });
});

describe("a path in a helper request", () => {
  it("capture.start needs an absolute folder", () => {
    const base = { meetingId: "m1" };
    expect(captureStartPayloadSchema.safeParse({ ...base, folder: "/tmp/m1" }).success).toBe(true);
    expect(captureStartPayloadSchema.safeParse({ ...base, folder: "m1" }).success).toBe(false);
  });
});
