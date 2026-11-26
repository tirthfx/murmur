import { describe, expect, it } from "vitest";
import { codingCliRunning, TERMINALS } from "../developer/coding-cli";
import { TAG_EDITORS } from "../developer/workspace";
import { insertionRules, isTerminalApp } from "../insertion/app-rules";
import { BROWSERS, DEFAULT_APP_CATEGORIES, resolveCategory } from "../styles/app-categories";
import { appKey, WINDOWS_TERMINALS } from "./app-id";

describe("app ids", () => {
  it("ignores case for Windows program names only", () => {
    expect(appKey("WINWORD.EXE")).toBe("winword.exe");
    expect(appKey("com.apple.Notes")).toBe("com.apple.Notes");
  });

  it("writes every Windows entry the way it is looked up", () => {
    const ids = [
      ...Object.keys(DEFAULT_APP_CATEGORIES),
      ...BROWSERS,
      ...TERMINALS,
      ...TAG_EDITORS,
      ...WINDOWS_TERMINALS,
    ];
    for (const id of ids) expect(appKey(id)).toBe(id);
  });

  it("knows Windows apps by their program name", () => {
    const category = (bundleId: string, windowTitle: string | null = null) =>
      resolveCategory({ bundleId, windowTitle }, new Map()).category;
    expect(category("OUTLOOK.EXE")).toBe("email");
    expect(category("slack.exe")).toBe("work");
    expect(category("Code.exe")).toBe("developer");
    expect(category("msedge.exe", "Inbox - Gmail")).toBe("email");
    expect(isTerminalApp("WindowsTerminal.exe")).toBe(true);
    expect(TERMINALS.has(appKey("pwsh.exe"))).toBe(true);
    expect(codingCliRunning(["pwsh", "claude"], null, ["claude"])).toBe(true);
  });

  it("types into remote desktops and terminals that do not take Ctrl+V", () => {
    const rules = insertionRules();
    expect(rules.typeInApps).toEqual(expect.arrayContaining(["mstsc.exe", "putty.exe"]));
    expect(rules.typeInApps).not.toContain("windowsterminal.exe");
    expect(rules.trimTrailingNewlinesInApps).toEqual(
      expect.arrayContaining(["windowsterminal.exe", "putty.exe"]),
    );
  });
});
