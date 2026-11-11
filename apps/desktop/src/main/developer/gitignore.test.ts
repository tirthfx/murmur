import { describe, expect, it } from "vitest";
import { isIgnored, parseGitignore } from "./gitignore";

describe(".gitignore rules", () => {
  const rules = parseGitignore(
    ["# build output", "dist/", "*.log", "!keep.log", "/secret.txt", "docs/**/*.tmp", "temp?"].join(
      "\n",
    ),
  );

  it("ignores folders, globs and anchored names as git does", () => {
    expect(isIgnored(rules, "dist", true)).toBe(true);
    expect(isIgnored(rules, "dist", false)).toBe(false);
    expect(isIgnored(rules, "src/app.log", false)).toBe(true);
    expect(isIgnored(rules, "keep.log", false)).toBe(false);
    expect(isIgnored(rules, "secret.txt", false)).toBe(true);
    expect(isIgnored(rules, "src/secret.txt", false)).toBe(false);
    expect(isIgnored(rules, "docs/a/b/c.tmp", false)).toBe(true);
    expect(isIgnored(rules, "docs/c.tmp", false)).toBe(true);
    expect(isIgnored(rules, "temp1", false)).toBe(true);
    expect(isIgnored(rules, "src/app.ts", false)).toBe(false);
  });
});
