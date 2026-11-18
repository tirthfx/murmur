import { describe, expect, it } from "vitest";
import { SAMPLE_SETTINGS } from "../../renderer/hub/test-api";
import { diagnosticsReport } from "./diagnostics";

describe("diagnostics report (HB-53, HB-55)", () => {
  it("leaves out the name, the signature and the wake phrase", () => {
    const settings = structuredClone(SAMPLE_SETTINGS.settings);
    settings.profile = { displayName: "Sam Private", showOnHome: true };
    settings.email = { ...settings.email, signature: "Sam Private\\n555 0100" };
    const report = diagnosticsReport({
      app: { name: "Murmur", version: "1.0.0", electron: "1", node: "1" },
      system: { platform: "darwin", release: "25", arch: "arm64" },
      helper: { state: "ready", helperVersion: "0.1.0", message: null },
      settings,
      counts: { categories: [{ category: "dictations", count: 4, bytes: 0 }], failedFiles: 0 },
      retention: { lastRunAt: null, nextRunAt: null, removed: {} },
      now: 0,
    });
    const text = JSON.stringify(report);
    expect(text).not.toContain("Sam Private");
    expect(text).not.toContain("555 0100");
    expect(report.counts).toEqual({ dictations: 4 });
  });
});
