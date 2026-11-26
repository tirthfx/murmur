import { describe, expect, it } from "vitest";
import { insertionMethod, insertionRules } from "./app-rules";

describe("the chosen insertion method (DC-32, DC-34)", () => {
  it("maps the choice, and the Testing page's switch wins", () => {
    expect(insertionMethod("auto")).toBe("auto");
    expect(insertionMethod("paste")).toBe("paste_cmd_v");
    expect(insertionMethod("type")).toBe("keystrokes");
    expect(insertionMethod("paste", true)).toBe("keystrokes");
  });

  it("types into remote desktops unless told to paste, plus the person's own apps", () => {
    expect(insertionRules().typeInApps).toContain("mstsc.exe");
    const rules = insertionRules({ pasteInRemoteDesktops: true, typeInApps: ["a.viewer"] });
    expect(rules.typeInApps).not.toContain("mstsc.exe");
    expect(rules.typeInApps).toContain("a.viewer");
  });
});
