import { describe, expect, it } from "vitest";
import { codingCliRunning } from "./coding-cli";

describe("coding CLI detection", () => {
  it("finds a listed name among the processes or in the window title", () => {
    expect(codingCliRunning(["login", "-zsh", "claude"], null, ["claude"])).toBe(true);
    expect(codingCliRunning(["login", "-zsh"], "shop — claude — 120×40", ["claude"])).toBe(true);
    expect(codingCliRunning(["login", "-zsh", "vim"], "shop — vim", ["claude", "codex"])).toBe(
      false,
    );
    expect(codingCliRunning(["claude"], null, [])).toBe(false);
  });
});
