import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { markdownToRich, type Note, type Rewrite } from "@murmur/shared";
import { noteFileName, noteRewriteChoices, writeNoteHtml, writeNoteMarkdown } from "./note-files";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "note-files-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const note: Note = {
  id: "n1",
  title: "Trip: plan/2",
  body: {
    blocks: [
      { type: "paragraph", inlines: [{ text: "Pack light" }] },
      { type: "image", imageId: "img-1" },
    ],
  },
  plain: "Pack light",
  createdAt: 1,
  updatedAt: 2,
  pinned: false,
};

function images() {
  const source = path.join(dir, "stored.jpg");
  writeFileSync(source, "jpeg");
  return {
    file: (id: string) => (id === "img-1" ? { path: source, extension: "jpg" as const } : null),
    dataUrl: (id: string) => (id === "img-1" ? "data:image/jpeg;base64,anBlZw==" : null),
  };
}

describe("note files", () => {
  it("names files safely", () => {
    expect(noteFileName(note)).toBe("Trip plan 2");
  });

  it("writes Markdown with a title and its images in a folder beside it", () => {
    const target = path.join(dir, "Trip.md");
    expect(writeNoteMarkdown(note, target, images())).toBe(1);
    const text = readFileSync(target, "utf8");
    expect(text).toBe("# Trip: plan/2\n\nPack light\n\n![Image](Trip%20images/img-1.jpg)\n");
    expect(existsSync(path.join(dir, "Trip images", "img-1.jpg"))).toBe(true);
    // The exported note comes back with its text and heading.
    const back = markdownToRich(text);
    expect(back.blocks[0]).toEqual({
      type: "heading",
      level: 1,
      inlines: [{ text: "Trip: plan/2" }],
    });
    expect(back.blocks[1]).toEqual({ type: "paragraph", inlines: [{ text: "Pack light" }] });
  });

  it("writes one HTML file with the images inside it", () => {
    const target = path.join(dir, "Trip.html");
    writeNoteHtml(note, target, images());
    const html = readFileSync(target, "utf8");
    expect(html).toContain("<title>Trip: plan/2</title>");
    expect(html).toContain('<img src="data:image/jpeg;base64,anBlZw==" alt="Image">');
  });

  it("offers Clarify, Tighten and Structure first", () => {
    const rewrite = (id: string, builtinKey: Rewrite["builtinKey"], sortOrder: number) =>
      ({ id, name: id, builtinKey, sortOrder }) as Rewrite;
    const choices = noteRewriteChoices([
      rewrite("mine", null, 0),
      rewrite("reorder", "reorder", 1),
      rewrite("structure", "structure", 2),
      rewrite("clarify", "clarify", 3),
      rewrite("concise", "concise", 4),
    ]);
    expect(choices.map((choice) => choice.id)).toEqual([
      "clarify",
      "concise",
      "structure",
      "mine",
      "reorder",
    ]);
  });
});
