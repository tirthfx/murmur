import { describe, expect, it, vi } from "vitest";
import type { execFile } from "node:child_process";
import { activateMacApp, isBundleId } from "./mac-apps";

describe("activateMacApp", () => {
  it("accepts bundle ids only", () => {
    expect(isBundleId("com.apple.Notes")).toBe(true);
    expect(isBundleId("com.google.Chrome")).toBe(true);
    expect(isBundleId("Notes")).toBe(false);
    expect(isBundleId("-a Calculator")).toBe(false);
    expect(isBundleId("com.apple.Notes; rm -rf")).toBe(false);
  });

  it("runs open -b with the id and resolves when it ends", async () => {
    const run = vi.fn((_file, _args, _options, done: () => void) => done());
    await activateMacApp("com.apple.Notes", run as unknown as typeof execFile);
    expect(run).toHaveBeenCalledWith(
      "/usr/bin/open",
      ["-b", "com.apple.Notes"],
      { timeout: 2000 },
      expect.any(Function),
    );
  });

  it("does nothing for something that is not a bundle id", async () => {
    const run = vi.fn();
    await activateMacApp("--args", run as unknown as typeof execFile);
    expect(run).not.toHaveBeenCalled();
  });
});
