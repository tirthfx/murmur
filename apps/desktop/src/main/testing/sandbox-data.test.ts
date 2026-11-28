import { describe, expect, it } from "vitest";
import { demoDictations, restartArgs, SANDBOX_SWITCH } from "./sandbox-data";

describe("the sandbox (HB-55)", () => {
  it("starts again with the switch once, or without it", () => {
    const argv = ["/app", "--flag", SANDBOX_SWITCH];
    expect(restartArgs(argv, true)).toEqual(["--flag", SANDBOX_SWITCH]);
    expect(restartArgs(argv, false)).toEqual(["--flag"]);
  });

  it("makes three weeks of dictations, none in the future", () => {
    const now = Date.UTC(2026, 10, 28);
    const records = demoDictations(now);
    expect(records.length).toBeGreaterThan(30);
    expect(records.every((record) => record.createdAt <= now)).toBe(true);
    expect(new Set(records.map((record) => record.sessionId)).size).toBe(records.length);
    expect(Math.min(...records.map((record) => record.createdAt))).toBeLessThan(
      now - 19 * 86_400_000,
    );
  });
});
