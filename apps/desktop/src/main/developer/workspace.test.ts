import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createWorkspaceIndexer,
  findWorkspace,
  indexWorkspace,
  matchFile,
  tagFiles,
} from "./workspace";

const base = mkdtempSync(path.join(os.tmpdir(), "murmur-ws-"));
const outside = mkdtempSync(path.join(os.tmpdir(), "murmur-out-"));
afterAll(() => {
  rmSync(base, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function file(rel: string, text = "") {
  const full = path.join(base, "shop", rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
}
file(".gitignore", "dist/\n*.log\n");
file("src/auth/session.ts");
file("src/auth/session.test.ts");
file("src/app/session.ts.bak");
file("server/session.ts");
file("dist/bundle.js");
file("debug.log");
file("node_modules/x/index.js");
file("lib/.gitignore", "generated/\n");
file("lib/generated/out.ts");
file("lib/util.ts");
writeFileSync(path.join(outside, "secret.ts"), "");
symlinkSync(outside, path.join(base, "shop", "linked"));

describe("workspace index", () => {
  it("lists files under the root, following .gitignore files, never links or node_modules", async () => {
    const files = await indexWorkspace(path.join(base, "shop"));
    expect(files.sort()).toEqual(
      [
        ".gitignore",
        "lib/.gitignore",
        "lib/util.ts",
        "server/session.ts",
        "src/app/session.ts.bak",
        "src/auth/session.test.ts",
        "src/auth/session.ts",
      ].sort(),
    );
    expect(files.some((name) => name.includes("secret"))).toBe(false);
    expect(await indexWorkspace(path.join(base, "shop"), 2)).toHaveLength(2);
  });

  it("finds the workspace from the editor title by folder name or full path", async () => {
    const home = path.dirname(base);
    expect(await findWorkspace("session.ts — shop", [base], undefined, home)).toBe(
      path.join(base, "shop"),
    );
    expect(
      await findWorkspace(`session.ts — ${path.join(base, "shop")}`, [], undefined, home),
    ).toBe(path.join(base, "shop"));
    expect(await findWorkspace("session.ts — elsewhere", [base], undefined, home)).toBeNull();
    expect(await findWorkspace("session.ts — /etc", [], undefined, home)).toBeNull();
    expect(await findWorkspace(null, [base])).toBeNull();
  });

  it("reuses an index for a minute", async () => {
    let time = 0;
    let builds = 0;
    const indexer = createWorkspaceIndexer(
      () => time,
      async () => {
        builds++;
        return ["a.ts"];
      },
    );
    await indexer.prepare("/w");
    time = 59_000;
    await indexer.prepare("/w");
    expect(builds).toBe(1);
    time = 61_000;
    await indexer.prepare("/w");
    expect(builds).toBe(2);
  });
});

describe("file tags", () => {
  const files = ["src/auth/session.ts", "server/session.ts", "src/app.ts", "README.md"];

  it("matches by file name, then path suffix, shortest first", () => {
    expect(matchFile("app.ts", files)).toBe("src/app.ts");
    expect(matchFile("session.ts", files)).toBe("server/session.ts");
    expect(matchFile("auth/session.ts", files)).toBe("src/auth/session.ts");
    expect(matchFile("readme.md", files)).toBe("README.md");
    expect(matchFile("nope.ts", files)).toBeNull();
  });

  it("turns 'at' and a known file into a tag, and leaves the rest as text", () => {
    expect(tagFiles("look at auth/session.ts and at app.ts.", files)).toBe(
      "look @src/auth/session.ts and @src/app.ts.",
    );
    expect(tagFiles("at session.ts", ["src/auth/session.ts"])).toBe("@src/auth/session.ts");
    expect(tagFiles("look at missing.ts", files)).toBe("look at missing.ts");
    expect(tagFiles("meet at noon", files)).toBe("meet at noon");
    expect(tagFiles("at app.ts", [])).toBe("at app.ts");
  });
});
