import { describe, expect, it } from "vitest";
import { CATALOGUES, translate } from "./catalogue";

describe("catalogue (HB-23)", () => {
  it("fills in values", () => {
    expect(translate("en", "notify.milestone.title", { name: "1,000 words" })).toBe(
      "Milestone: 1,000 words",
    );
  });

  it("falls back to English for a missing language or key, never showing a key", () => {
    expect(translate("xx", "tray.quit")).toBe("Quit Murmur");
    const saved = CATALOGUES.en["tray.quit"];
    delete (CATALOGUES.en as Record<string, string>)["tray.quit"];
    try {
      expect(translate("en", "tray.quit")).toBe("Quit Murmur");
    } finally {
      (CATALOGUES.en as Record<string, string>)["tray.quit"] = saved!;
    }
  });
});
