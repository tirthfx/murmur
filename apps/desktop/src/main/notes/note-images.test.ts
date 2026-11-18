import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { createNoteImages, type ImageEncoder } from "./note-images";
import { createNotesStore } from "./notes-store";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "note-images-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Stands in for nativeImage: scales the declared size and returns `size` bytes. */
function fakeEncoder(size = 1000, original = { width: 4000, height: 3000 }): ImageEncoder {
  return async (input, maxSide) => {
    if (input.bytes[0] === 0) return null;
    const scale = Math.min(1, maxSide / Math.max(original.width, original.height));
    return {
      data: Buffer.alloc(size, 7),
      mime: input.type === "image/png" ? "image/png" : "image/jpeg",
      width: Math.round(original.width * scale),
      height: Math.round(original.height * scale),
    };
  };
}

function setup(encoder = fakeEncoder()) {
  const db = openDatabase(":memory:");
  const notes = createNotesStore(db);
  const images = createNoteImages(db, root, encoder);
  const note = notes.create("with a picture");
  return { db, notes, images, note };
}

const photo = (bytes = 100) => new Uint8Array(bytes).fill(1);

describe("note images (HB-30)", () => {
  it("stores a large photo scaled to 2,048 px and reads it back", async () => {
    const { images, note } = setup();
    const result = await images.add({ noteId: note.id, type: "image/heic", bytes: photo() });
    expect(result).toMatchObject({ ok: true, width: 2048, height: 1536 });
    if (!result.ok) return;
    expect(result.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(images.dataUrl(result.id)).toBe(result.dataUrl);
    expect(images.usage()).toBe(1000);
  });

  it("refuses an image over 10 MB and one it cannot read", async () => {
    const { images, note } = setup();
    expect(
      await images.add({ noteId: note.id, type: "image/png", bytes: photo(11 * 1024 * 1024) }),
    ).toEqual({ ok: false, message: expect.stringContaining("10 MB") });
    expect(
      await images.add({ noteId: note.id, type: "image/png", bytes: new Uint8Array(5) }),
    ).toEqual({ ok: false, message: expect.stringContaining("could not be read") });
  });

  it("refuses going past 200 MB in all and says how much is used", async () => {
    const { images, note } = setup(fakeEncoder(90 * 1024 * 1024));
    expect((await images.add({ noteId: note.id, type: "image/png", bytes: photo() })).ok).toBe(
      true,
    );
    expect((await images.add({ noteId: note.id, type: "image/png", bytes: photo() })).ok).toBe(
      true,
    );
    const third = await images.add({ noteId: note.id, type: "image/png", bytes: photo() });
    expect(third).toEqual({ ok: false, message: expect.stringContaining("180.0 MB is used") });
  });

  it("deletes the image rows with the note, and the files with its folder", async () => {
    const { db, notes, images, note } = setup();
    const result = await images.add({ noteId: note.id, type: "image/jpeg", bytes: photo() });
    expect(existsSync(path.join(root, note.id))).toBe(true);
    notes.remove(note.id);
    images.removeFolder(note.id);
    expect(existsSync(path.join(root, note.id))).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM note_images").get()).toEqual({ n: 0 });
    expect(result.ok && images.dataUrl(result.id)).toBe(null);
  });

  it("never reads outside the notes folder", () => {
    const { images } = setup();
    expect(images.dataUrl("../../etc")).toBeNull();
    images.removeFolder("..");
    expect(existsSync(root)).toBe(true);
  });
});
