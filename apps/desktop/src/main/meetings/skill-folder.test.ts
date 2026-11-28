import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSkillFiles } from "./skill-folder";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "skills-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a folder of Skills (NT-16)", () => {
  it("reads its small Markdown files, by name, and nothing deeper", () => {
    writeFileSync(path.join(dir, "b.md"), "B");
    writeFileSync(path.join(dir, "a.MARKDOWN"), "A");
    writeFileSync(path.join(dir, "notes.txt"), "no");
    writeFileSync(path.join(dir, "huge.md"), "x".repeat(100_001));
    mkdirSync(path.join(dir, "sub.md"));
    expect(readSkillFiles(dir)).toEqual([
      { name: "a.MARKDOWN", text: "A" },
      { name: "b.md", text: "B" },
    ]);
  });
});
