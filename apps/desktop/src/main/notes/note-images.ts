import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  formatMegabytes,
  NOTE_LIMITS,
  NOTE_MESSAGES,
  type NoteImageAdd,
  type NoteImageResult,
} from "@murmur/shared";

/** An image decoded, scaled to fit and encoded again; nothing of the original file is kept. */
export interface EncodedImage {
  data: Buffer;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

/** Decodes and re-encodes an image (the real one uses Electron's nativeImage). Null if unreadable. */
export type ImageEncoder = (input: NoteImageAdd, maxSide: number) => Promise<EncodedImage | null>;

export interface NoteImages {
  add(input: NoteImageAdd): Promise<NoteImageResult>;
  /** The image as a data URL for the editor, or null. */
  dataUrl(id: string): string | null;
  /** Bytes of every stored image. */
  usage(): number;
  /** Removes a note's image files; its rows go with the note. */
  removeFolder(noteId: string): void;
}

const ID = /^[\w-]{1,64}$/;

/** `note_images` (migration 0022) and the files under `<root>/<noteId>/`. */
export function createNoteImages(
  db: DatabaseSync,
  root: string,
  encode: ImageEncoder,
  now: () => number = Date.now,
  newId: () => string = randomUUID,
): NoteImages {
  /** Only paths inside the notes folder are ever read or removed. */
  function inside(file: string): boolean {
    const rel = path.relative(root, file);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  }

  function usage(): number {
    return (
      db.prepare("SELECT COALESCE(SUM(bytes), 0) AS n FROM note_images").get() as { n: number }
    ).n;
  }

  return {
    async add(input) {
      if (input.bytes.byteLength > NOTE_LIMITS.imageBytes) {
        return { ok: false, message: NOTE_MESSAGES.imageTooBig };
      }
      if (!ID.test(input.noteId)) return { ok: false, message: NOTE_MESSAGES.missing };
      const note = db.prepare("SELECT 1 FROM notes WHERE id = ?").get(input.noteId);
      if (!note) return { ok: false, message: NOTE_MESSAGES.missing };
      const image = await encode(input, NOTE_LIMITS.imageSide).catch(() => null);
      if (!image) return { ok: false, message: NOTE_MESSAGES.imageUnreadable };
      const used = usage();
      if (used + image.data.length > NOTE_LIMITS.imagesTotalBytes) {
        return {
          ok: false,
          message: `Scratchpad images can take up to 200 MB in all; ${formatMegabytes(used)} is used. Delete a note with images first.`,
        };
      }
      const id = newId();
      const folder = path.join(root, input.noteId);
      const file = path.join(folder, `${id}.${image.mime === "image/png" ? "png" : "jpg"}`);
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      writeFileSync(file, image.data, { mode: 0o600 });
      db.prepare(
        `INSERT INTO note_images (id, note_id, path, mime, width, height, bytes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.noteId,
        path.relative(root, file),
        image.mime,
        image.width,
        image.height,
        image.data.length,
        now(),
      );
      return {
        ok: true,
        id,
        dataUrl: `data:${image.mime};base64,${image.data.toString("base64")}`,
        width: image.width,
        height: image.height,
      };
    },
    dataUrl(id) {
      if (!ID.test(id)) return null;
      const row = db.prepare("SELECT path, mime FROM note_images WHERE id = ?").get(id) as
        { path: string; mime: string } | undefined;
      if (!row) return null;
      const file = path.join(root, row.path);
      if (!inside(file) || !existsSync(file)) return null;
      return `data:${row.mime};base64,${readFileSync(file).toString("base64")}`;
    },
    usage,
    removeFolder(noteId) {
      if (!ID.test(noteId)) return;
      const folder = path.join(root, noteId);
      if (inside(folder) && existsSync(folder)) rmSync(folder, { recursive: true, force: true });
    },
  };
}
