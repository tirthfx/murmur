import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogFile } from "./log-file";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "murmur-logs-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const NOW = Date.UTC(2026, 10, 28, 12);

describe("the log files (HB-49)", () => {
  it("writes a line a time into the day's file", () => {
    const log = createLogFile({ dir: path.join(dir, "logs"), now: () => NOW });
    log.write("info", "[a] started");
    log.write("warn", "[b] slow");
    expect(readFileSync(path.join(dir, "logs", "murmur-2026-11-28.log"), "utf8")).toBe(
      "2026-11-28T12:00:00.000Z info [a] started\n2026-11-28T12:00:00.000Z warn [b] slow\n",
    );
  });

  it("keeps seven days and leaves other files alone", () => {
    for (const name of ["murmur-2026-11-21.log", "murmur-2026-11-22.log", "notes.txt"])
      writeFileSync(path.join(dir, name), "x");
    createLogFile({ dir, now: () => NOW }).write("info", "now");
    expect(readdirSync(dir).sort()).toEqual([
      "murmur-2026-11-22.log",
      "murmur-2026-11-28.log",
      "notes.txt",
    ]);
  });

  it("does not stop the app when it cannot write", () => {
    const file = path.join(dir, "taken");
    writeFileSync(file, "a file, not a folder");
    expect(() => createLogFile({ dir: file, now: () => NOW }).write("info", "x")).not.toThrow();
  });
});
