import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  noteHtmlDocument,
  noteTitle,
  richToHtml,
  richToMarkdown,
  NOTE_REWRITE_FIRST,
  type Note,
  type NoteRewriteChoice,
  type Rewrite,
} from "@murmur/shared";

/** HB-32: enabled Rewrites for a note, Clarify, Tighten and Structure first. */
export function noteRewriteChoices(enabled: readonly Rewrite[]): NoteRewriteChoice[] {
  const rank = (rewrite: Rewrite) => {
    const index = (NOTE_REWRITE_FIRST as readonly string[]).indexOf(rewrite.builtinKey ?? "");
    return index === -1 ? NOTE_REWRITE_FIRST.length : index;
  };
  return [...enabled]
    .sort((a, b) => rank(a) - rank(b) || a.sortOrder - b.sortOrder)
    .map((rewrite) => ({ id: rewrite.id, name: rewrite.name }));
}

/** A file name from a note's title, safe on every file system. */
export function noteFileName(note: Note): string {
  const base = [...noteTitle(note.title, note.plain)]
    // Control characters and the characters file systems refuse become spaces.
    .map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? " " : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return base || "Note";
}

export interface ImageFiles {
  file(id: string): { path: string; extension: "png" | "jpg" } | null;
  dataUrl(id: string): string | null;
}

/**
 * Writes a note as Markdown (HB-46, HB-27). Its images are copied into a folder beside the
 * file, named after it, and referenced relatively. Returns how many images were copied.
 */
export function writeNoteMarkdown(note: Note, target: string, images: ImageFiles): number {
  const folderName = `${path.basename(target, path.extname(target))} images`;
  const folder = path.join(path.dirname(target), folderName);
  let copied = 0;
  const markdown = richToMarkdown(note.body, (id) => {
    const source = images.file(id);
    if (!source) return null;
    mkdirSync(folder, { recursive: true });
    const name = `${id}.${source.extension}`;
    copyFileSync(source.path, path.join(folder, name));
    copied += 1;
    return `${encodeURI(folderName)}/${name}`;
  });
  const title = noteTitle(note.title, note.plain);
  const startsWithTitle = note.body.blocks[0]?.type === "heading";
  writeFileSync(target, startsWithTitle ? markdown : `# ${title}\n\n${markdown}`);
  return copied;
}

/** Writes a note as one HTML file with its images inside it as data URLs. */
export function writeNoteHtml(note: Note, target: string, images: ImageFiles): void {
  const body = richToHtml(note.body).replace(
    /<img data-image-id="([\w-]{1,64})" alt="Image">/g,
    (whole, id: string) => {
      const url = images.dataUrl(id);
      return url ? `<img src="${url}" alt="Image">` : "";
    },
  );
  writeFileSync(target, noteHtmlDocument(noteTitle(note.title, note.plain), body));
}
