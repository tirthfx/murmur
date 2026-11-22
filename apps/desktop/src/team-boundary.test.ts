import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SW-01, SW-08: which code may know a team backend. The renderer and the preload script never see
 * a backend's address, key or SDK, and in the main process only the team client folder names one.
 */
const SRC = path.dirname(new URL(import.meta.url).pathname);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx|html)$/.test(name) ? [full] : [];
  });
}

const BACKEND = /supabase|SUPABASE_|service_role|\banon key\b/i;

describe("where a team backend may be named", () => {
  it("the renderer and the preload script name no backend address, key or SDK", () => {
    const code = [...files(path.join(SRC, "renderer")), ...files(path.join(SRC, "preload"))].filter(
      (file) => !/\.test\.tsx?$/.test(file),
    );
    expect(code.length).toBeGreaterThan(50);
    const hits = code.filter((file) => BACKEND.test(readFileSync(file, "utf8")));
    expect(hits.map((file) => path.relative(SRC, file))).toEqual([]);
  });

  it("in the main process only the team client folder names a backend", () => {
    const code = files(path.join(SRC, "main")).filter(
      (file) => !/\.test\.tsx?$/.test(file) && !file.includes(`${path.sep}team${path.sep}`),
    );
    const hits = code.filter((file) => BACKEND.test(readFileSync(file, "utf8")));
    expect(hits.map((file) => path.relative(SRC, file))).toEqual([]);
  });

  it("the shared package holds no SDK import", () => {
    const shared = files(path.join(SRC, "../../../packages/shared/src")).filter(
      (file) => !/\.test\.tsx?$/.test(file),
    );
    const hits = shared.filter((file) =>
      /from "@supabase|from "supabase/.test(readFileSync(file, "utf8")),
    );
    expect(hits).toEqual([]);
  });
});
