import { describe, expect, it } from "vitest";
import { absolutePathSchema, captureStartPayloadSchema, isAbsolutePath } from "./index";

describe("isAbsolutePath", () => {
  it("accepts POSIX, Windows drive and network share paths", () => {
    for (const path of [
      "/Users/me/Library",
      "C:\\Users\\me\\AppData",
      "d:/data/meetings",
      "\\\\server\\share\\folder",
    ]) {
      expect(isAbsolutePath(path), path).toBe(true);
    }
  });

  it("refuses a relative path, a bare drive and an empty string", () => {
    for (const path of ["", "meetings/one", "./x", "..\\x", "C:", "C:folder", "\\rooted", "~/x"]) {
      expect(isAbsolutePath(path), path).toBe(false);
    }
    expect(absolutePathSchema.safeParse("relative").success).toBe(false);
  });
});

describe("a path in a helper request", () => {
  it("capture.start takes a Windows folder as well as a POSIX one", () => {
    const base = { meetingId: "m1" };
    expect(captureStartPayloadSchema.safeParse({ ...base, folder: "/tmp/m1" }).success).toBe(true);
    expect(captureStartPayloadSchema.safeParse({ ...base, folder: "C:\\m\\m1" }).success).toBe(
      true,
    );
    expect(captureStartPayloadSchema.safeParse({ ...base, folder: "m1" }).success).toBe(false);
  });
});
