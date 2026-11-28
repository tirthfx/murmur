import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copyRuntimePackages,
  includeLlamaOptional,
  runtimeClosure,
  skipLlamaFile,
} from "./runtime-modules";

let root: string;

function install(
  location: string,
  manifest: { dependencies?: string[]; optionalDependencies?: string[] } = {},
  files: string[] = ["index.js"],
) {
  const dir = path.join(root, location);
  mkdirSync(dir, { recursive: true });
  const record = (names?: string[]) => Object.fromEntries((names ?? []).map((name) => [name, "1"]));
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      dependencies: record(manifest.dependencies),
      optionalDependencies: record(manifest.optionalDependencies),
    }),
  );
  for (const file of files) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), "x");
  }
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "murmur-pack-"));
  install("node_modules/engine", {
    dependencies: ["a", "b"],
    optionalDependencies: ["@bin/mac", "@bin/linux", "@bin/absent"],
  });
  install("node_modules/a", { dependencies: ["c"] });
  // `b` needs its own, different copy of `c`.
  install("node_modules/b", { dependencies: ["c"] });
  install("node_modules/b/node_modules/c");
  install("node_modules/c", { dependencies: ["a"] });
  install("node_modules/@bin/mac", {}, ["bins/lib.node"]);
  install("node_modules/@bin/linux");
  install("node_modules/unrelated");
  mkdirSync(path.join(root, "apps/desktop"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runtime modules", () => {
  it("collects the entry, its dependencies and theirs, nested copies included", () => {
    const packages = runtimeClosure("engine", path.join(root, "apps/desktop"), {
      includeOptional: (name) => name !== "@bin/linux",
    });
    expect(packages.map((item) => item.target)).toEqual(
      ["@bin/mac", "a", "b", "b/node_modules/c", "c", "engine"].map((target) =>
        target.split("/").join(path.sep),
      ),
    );
  });

  it("fails on a missing required dependency but not on a missing optional one", () => {
    install("node_modules/broken", { dependencies: ["nowhere"] });
    expect(() => runtimeClosure("broken", root)).toThrow("nowhere is not installed");
    expect(() => runtimeClosure("engine", root)).not.toThrow();
  });

  it("copies each package once, without nested node_modules or skipped files", () => {
    install("node_modules/engine", { dependencies: ["a"] }, ["index.js", "big/source.bundle"]);
    const target = path.join(root, "out");
    copyRuntimePackages(
      runtimeClosure("b", root).concat(runtimeClosure("engine", root)),
      target,
      (file) => file === path.join("engine", "big", "source.bundle"),
    );
    const has = (file: string) => existsSync(path.join(target, "node_modules", file));
    expect(has("engine/index.js")).toBe(true);
    expect(has("engine/big/source.bundle")).toBe(false);
    expect(has("b/node_modules/c/index.js")).toBe(true);
    expect(has("a/package.json")).toBe(true);
    expect(has("unrelated")).toBe(false);
  });

  it("keeps only this Mac's llama binaries and drops the source bundle", () => {
    expect(includeLlamaOptional("@node-llama-cpp/mac-arm64-metal")).toBe(true);
    expect(includeLlamaOptional("@node-llama-cpp/linux-x64")).toBe(false);
    expect(includeLlamaOptional("some-other-optional")).toBe(true);
    expect(skipLlamaFile(path.join("node-llama-cpp", "llama", "gitRelease.bundle"))).toBe(true);
    expect(skipLlamaFile(path.join("node-llama-cpp", "dist", "index.js"))).toBe(false);
  });
});
