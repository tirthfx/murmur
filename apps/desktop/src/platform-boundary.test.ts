import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SW-09: the app knows which OS it runs on in one place, the platform adapter in
 * `main/platform`. Everything else asks the adapter a question, so a Windows helper adds code
 * there and changes nothing elsewhere. The renderer and the preload script never read it.
 */
const SRC = path.dirname(new URL(import.meta.url).pathname);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/** The file's code without comments, so a mention in a comment is not a use. */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PLATFORM_READ = /process\.platform|\bos\.platform\(|\bplatform\(\)\s*===/;
const ADAPTER = path.join(SRC, "main", "platform");

describe("where the operating system is read", () => {
  it("only the platform adapter reads process.platform", () => {
    const code = files(SRC).filter((file) => !file.startsWith(`${ADAPTER}${path.sep}`));
    expect(code.length).toBeGreaterThan(100);
    const hits = code.filter((file) => PLATFORM_READ.test(codeOf(file)));
    expect(hits.map((file) => path.relative(SRC, file))).toEqual([]);
  });

  it("the adapter does read it, so the check above looks at the right thing", () => {
    const hits = files(ADAPTER).filter((file) => PLATFORM_READ.test(codeOf(file)));
    expect(hits.map((file) => path.basename(file))).toEqual(["index.ts"]);
  });

  it("the shared package never reads it", () => {
    const shared = files(path.join(SRC, "../../../packages/shared/src"));
    const hits = shared.filter((file) => PLATFORM_READ.test(codeOf(file)));
    expect(hits).toEqual([]);
  });
});
