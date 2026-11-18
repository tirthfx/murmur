import { describe, expect, it } from "vitest";
import { PRESET_SWITCHES, presetOf, privacyStatement } from "./privacy";

describe("privacy presets (HB-48)", () => {
  it("recognises each preset from its switches", () => {
    for (const preset of ["balanced", "minimal", "full"] as const) {
      expect(presetOf(PRESET_SWITCHES[preset])).toBe(preset);
    }
  });

  it("shows Custom once one switch differs", () => {
    expect(presetOf({ ...PRESET_SWITCHES.balanced, learnCorrections: false })).toBe("custom");
  });

  it("says that nothing leaves the Mac, with the download exception unless strict", () => {
    expect(privacyStatement(false).headline).toBe("Nothing leaves this Mac.");
    expect(privacyStatement(false).details[0]).toMatch(/model download/);
    expect(privacyStatement(true).details[0]).toMatch(/no network connection at all/);
  });
});
