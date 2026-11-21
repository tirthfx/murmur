import { describe, expect, it, vi } from "vitest";
import { createAutoExport } from "./auto-export";

function setup(over: Record<string, unknown> = {}) {
  const writes: [string, string][] = [];
  const warn = vi.fn();
  const exporter = createAutoExport({
    folders: {
      folderOf: (id) => (id === "m-1" ? "f1" : id === "m-2" ? null : "gone"),
      get: (id) =>
        id === "f1"
          ? {
              id: "f1",
              name: "Customer calls",
              meetings: 1,
              defaultSkillId: null,
              autoExportPath: "/Users/me/Shared",
            }
          : null,
    },
    build: (id) => (id === "none" ? null : { fileName: "2026-11-21 Acme.html", html: "<html>" }),
    directoryExists: () => true,
    write: (file, text) => void writes.push([file, text]),
    logger: { info: vi.fn(), warn, error: vi.fn() } as never,
    ...over,
  });
  return { exporter, writes, warn };
}

describe("folder auto-export (NT-18)", () => {
  it("writes the file of a meeting to its folder's path", () => {
    const t = setup();
    expect(t.exporter.run("m-1")).toBe("/Users/me/Shared/2026-11-21 Acme.html");
    expect(t.writes).toEqual([["/Users/me/Shared/2026-11-21 Acme.html", "<html>"]]);
    // Again: the same file is written over.
    t.exporter.run("m-1");
    expect(t.writes.map(([file]) => file)).toEqual(
      Array(2).fill("/Users/me/Shared/2026-11-21 Acme.html"),
    );
  });

  it("does nothing for the Inbox, a folder with no path, or a folder that is gone", () => {
    const t = setup();
    expect(t.exporter.run("m-2")).toBeNull();
    expect(t.exporter.run("m-3")).toBeNull();
    expect(t.writes).toEqual([]);
    const noPath = setup({
      folders: {
        folderOf: () => "f1",
        get: () => ({
          id: "f1",
          name: "x",
          meetings: 0,
          defaultSkillId: null,
          autoExportPath: null,
        }),
      },
    });
    expect(noPath.exporter.run("m-1")).toBeNull();
  });

  it("logs and goes on when the path is gone or the write fails", () => {
    const missing = setup({ directoryExists: () => false });
    expect(missing.exporter.run("m-1")).toBeNull();
    expect(missing.warn).toHaveBeenCalledWith(expect.stringContaining("is not there"));
    const broken = setup({
      write: () => {
        throw new Error("disk full");
      },
    });
    expect(broken.exporter.run("m-1")).toBeNull();
    expect(broken.warn).toHaveBeenCalledWith(expect.stringContaining("disk full"));
  });

  it("does nothing when the meeting has no file", () => {
    const t = setup({
      folders: {
        folderOf: () => "f1",
        get: () => ({
          id: "f1",
          name: "x",
          meetings: 0,
          defaultSkillId: null,
          autoExportPath: "/p",
        }),
      },
    });
    expect(t.exporter.run("none")).toBeNull();
    expect(t.writes).toEqual([]);
  });
});
