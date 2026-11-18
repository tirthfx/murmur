import type { execFile } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { convertMacImageToPng } from "./mac-image";

describe("convertMacImageToPng", () => {
  it("asks sips for a PNG and reports how it went", async () => {
    const run = vi.fn(
      (_file: string, _args: string[], _options: object, done: (error: Error | null) => void) =>
        done(null),
    );
    await expect(
      convertMacImageToPng("/tmp/a.heic", "/tmp/a.png", run as unknown as typeof execFile),
    ).resolves.toBe(true);
    expect(run.mock.calls[0]!.slice(0, 2)).toEqual([
      "/usr/bin/sips",
      ["-s", "format", "png", "/tmp/a.heic", "--out", "/tmp/a.png"],
    ]);
    const failing = vi.fn(
      (_f: string, _a: string[], _o: object, done: (error: Error | null) => void) =>
        done(new Error("no")),
    );
    await expect(
      convertMacImageToPng("/tmp/a.heic", "/tmp/a.png", failing as unknown as typeof execFile),
    ).resolves.toBe(false);
  });
});
