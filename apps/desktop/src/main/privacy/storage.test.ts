import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sizeOf } from "./storage";

describe("sizeOf", () => {
  it("adds up a folder, and is 0 for a missing one", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "size-"));
    try {
      mkdirSync(path.join(dir, "a"));
      writeFileSync(path.join(dir, "a", "x"), "12345");
      writeFileSync(path.join(dir, "y"), "12");
      expect(sizeOf(dir)).toBe(7);
      expect(sizeOf(path.join(dir, "missing"))).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
