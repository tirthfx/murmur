import { describe, expect, it } from "vitest";
import {
  SETUP_STEPS,
  blockerLines,
  formatBytes,
  isPermissionStep,
  modelProgress,
} from "./setup-steps";

describe("setup steps", () => {
  it("runs in the agreed order", () => {
    expect(SETUP_STEPS).toEqual([
      "welcome",
      "microphone",
      "accessibility",
      "inputMonitoring",
      "model",
      "shortcut",
      "try",
      "done",
    ]);
  });

  it("knows which steps are permissions", () => {
    expect(SETUP_STEPS.filter(isPermissionStep)).toEqual([
      "microphone",
      "accessibility",
      "inputMonitoring",
    ]);
  });

  it("formats sizes and progress", () => {
    expect(formatBytes(648_000_000)).toBe("648 MB");
    expect(formatBytes(2_497_281_120)).toBe("2.5 GB");
    const model = { state: "downloading" as const, label: "x", message: null };
    expect(modelProgress({ ...model, totalBytes: 1000, downloadedBytes: 255 })).toBe(25);
    expect(modelProgress({ ...model, totalBytes: 1000, downloadedBytes: 1000 })).toBe(100);
    expect(modelProgress({ ...model, totalBytes: 0, downloadedBytes: 0 })).toBe(0);
  });

  it("writes one sentence per missing piece", () => {
    expect(blockerLines(["microphone", "speechModel"])).toEqual([
      "Microphone access is not granted.",
      "The speech model is not downloaded or still loading.",
    ]);
    expect(blockerLines([])).toEqual([]);
  });
});
