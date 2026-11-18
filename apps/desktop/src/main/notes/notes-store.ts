import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  historyMatchQuery,
  markedParts,
  NOTE_LIMITS,
  NOTE_MESSAGES,
  noteTitle,
  plainToRich,
  richDocSchema,
  richToPlain,
  utf8Bytes,
  wordCount,
  type Note,
  type NotePinResult,
  type NoteVersion,
  type NoteVersionSave,
  type NoteVersionText,
  type NoteSave,
  type NoteSaveResult,
  type NoteSummary,
  type RichDoc,
} from "@murmur/shared";

export interface NotesStore {
  /** Pinned first, then newest first; with a query, title matches first, then by date. */
  list(query?: string): NoteSummary[];
  get(id: string): Note | null;
  /** A new note, empty or holding some text. */
  create(text?: string): Note;
  save(input: NoteSave): NoteSaveResult;
  remove(id: string): void;
  count(): number;
  /** Versions of a note, newest first (HB-28). */
  versions(noteId: string): NoteVersion[];
  /**
   * Saves a version of the note as it is now, unless it equals the latest version. `auto`
   * also waits until the latest is older than five minutes. Keeps the newest 50.
   */
  saveVersion(input: NoteVersionSave): NoteVersion | null;
  versionText(id: string): NoteVersionText | null;
  /** Puts a version's text back into its note, as a new version; returns the note. */
  restore(versionId: string): Note | null;
  /** Pins or unpins (HB-29); at most 20 pinned. */
  pin(noteId: string, pinned: boolean): NotePinResult;
  /** Moves a pinned note up (-1) or down (1) among the pinned. */
  movePin(noteId: string, step: -1 | 1): void;
}

const MARK_START = "\u0001";
const MARK_END = "\u0002";

/** Control characters never reach the database, so they cannot fake search marks. */
function clean(text: string): string {
  return text.replaceAll(MARK_START, "").replaceAll(MARK_END, "");
}

function firstLine(plain: string): string {
  return (
    plain
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim()
      .slice(0, 140) ?? ""
  );
}

/** `notes` and `notes_fts` (migration 0020). */
export function createNotesStore(
  db: DatabaseSync,
  now: () => number = Date.now,
  newId: () => string = randomUUID,
): NotesStore {
  function toNote(row: Record<string, unknown>): Note {
    let body: RichDoc;
    try {
      body = richDocSchema.parse(JSON.parse(row.body_json as string));
    } catch {
      body = plainToRich(row.body_plain as string);
    }
    return {
      id: row.id as string,
      title: row.title as string,
      body,
      plain: row.body_plain as string,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      pinned: row.pinned === 1,
    };
  }

  function summary(row: Record<string, unknown>, preview?: string): NoteSummary {
    const plain = row.body_plain as string;
    return {
      id: row.id as string,
      title: noteTitle(row.title as string, plain),
      preview:
        preview !== undefined
          ? markedParts(preview)
          : [{ text: firstLine(plain), hit: false }].filter((part) => part.text !== ""),
      updatedAt: row.updated_at as number,
      pinned: row.pinned === 1,
    };
  }

  return {
    list(query = "") {
      const match = historyMatchQuery(query);
      if (!match) {
        const rows = db
          .prepare(
            `SELECT id, title, body_plain, updated_at, pinned FROM notes
            WHERE deleted_at IS NULL AND archived = 0
            ORDER BY pinned DESC, COALESCE(pin_order, 0), updated_at DESC LIMIT ?`,
          )
          .all(NOTE_LIMITS.results) as Record<string, unknown>[];
        return rows.map((row) => summary(row));
      }
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const rows = db
        .prepare(
          `SELECT n.id, n.title, n.body_plain, n.updated_at, n.pinned,
            snippet(notes_fts, 1, ?, ?, '…', 12) AS preview
          FROM notes_fts JOIN notes n ON n.rowid = notes_fts.rowid
          WHERE notes_fts MATCH ? AND n.deleted_at IS NULL AND n.archived = 0
          ORDER BY n.updated_at DESC LIMIT ?`,
        )
        .all(MARK_START, MARK_END, match, NOTE_LIMITS.results) as Record<string, unknown>[];
      // Title matches first (HB-31), each group newest first.
      const inTitle = (row: Record<string, unknown>) => {
        const title = noteTitle(row.title as string, row.body_plain as string).toLowerCase();
        return words.every((word) => title.split(/\W+/).some((part) => part.startsWith(word)));
      };
      const sorted = [...rows.filter(inTitle), ...rows.filter((row) => !inTitle(row))];
      return sorted.map((row) => {
        const preview = row.preview as string;
        return summary(row, preview.includes(MARK_START) ? preview : undefined);
      });
    },
    get(id) {
      const row = db.prepare("SELECT * FROM notes WHERE id = ? AND deleted_at IS NULL").get(id) as
        Record<string, unknown> | undefined;
      return row ? toNote(row) : null;
    },
    create(text = "") {
      const id = newId();
      const at = now();
      const body = plainToRich(clean(text));
      db.prepare(
        `INSERT INTO notes (id, title, body_json, body_plain, created_at, updated_at)
        VALUES (?, '', ?, ?, ?, ?)`,
      ).run(id, JSON.stringify(body), richToPlain(body), at, at);
      return this.get(id)!;
    },
    save({ id, title, body }) {
      const plain = clean(richToPlain(body));
      if (utf8Bytes(plain) > NOTE_LIMITS.bodyBytes) {
        return { ok: false, message: NOTE_MESSAGES.tooBig };
      }
      const at = now();
      const result = db
        .prepare(
          `UPDATE notes SET title = ?, body_json = ?, body_plain = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(clean(title).slice(0, NOTE_LIMITS.title), JSON.stringify(body), plain, at, id);
      if (Number(result.changes) === 0) return { ok: false, message: NOTE_MESSAGES.missing };
      return { ok: true, updatedAt: at };
    },
    remove(id) {
      db.prepare("DELETE FROM notes WHERE id = ?").run(id);
    },
    versions(noteId) {
      const rows = db
        .prepare(
          `SELECT id, note_id, label, words, created_at FROM note_versions
          WHERE note_id = ? ORDER BY created_at DESC, rowid DESC`,
        )
        .all(noteId) as Record<string, unknown>[];
      return rows.map((row) => ({
        id: row.id as string,
        noteId: row.note_id as string,
        label: (row.label as string | null) ?? null,
        words: row.words as number,
        createdAt: row.created_at as number,
      }));
    },
    saveVersion({ noteId, label, reason }) {
      const note = db
        .prepare(
          "SELECT title, body_json, body_plain FROM notes WHERE id = ? AND deleted_at IS NULL",
        )
        .get(noteId) as { title: string; body_json: string; body_plain: string } | undefined;
      if (!note) return null;
      const latest = db
        .prepare(
          `SELECT title, body_plain, body_json, created_at FROM note_versions WHERE note_id = ?
          ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        )
        .get(noteId) as
        { title: string; body_plain: string; body_json: string; created_at: number } | undefined;
      const at = now();
      const same =
        latest !== undefined && latest.title === note.title && latest.body_json === note.body_json;
      // A manual version with a label is kept even when nothing changed.
      if (same && !(reason === "manual" && label)) return null;
      if (
        reason === "auto" &&
        latest !== undefined &&
        at - latest.created_at < NOTE_LIMITS.versionEveryMs
      ) {
        return null;
      }
      if (reason === "auto" && latest === undefined && note.body_plain.trim() === "") return null;
      const id = newId();
      const words = wordCount(note.body_plain);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          `INSERT INTO note_versions (id, note_id, title, body_json, body_plain, label, words, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, noteId, note.title, note.body_json, note.body_plain, label || null, words, at);
        // Keep the newest 50 (HB-28).
        db.prepare(
          `DELETE FROM note_versions WHERE note_id = ? AND id NOT IN (
            SELECT id FROM note_versions WHERE note_id = ?
            ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
        ).run(noteId, noteId, NOTE_LIMITS.versions);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return { id, noteId, label: label || null, words, createdAt: at };
    },
    versionText(id) {
      const row = db
        .prepare("SELECT id, title, body_plain, created_at FROM note_versions WHERE id = ?")
        .get(id) as Record<string, unknown> | undefined;
      return row
        ? {
            id: row.id as string,
            title: row.title as string,
            plain: row.body_plain as string,
            createdAt: row.created_at as number,
          }
        : null;
    },
    restore(versionId) {
      const version = db
        .prepare(
          "SELECT note_id, title, body_json, body_plain, created_at FROM note_versions WHERE id = ?",
        )
        .get(versionId) as
        | {
            note_id: string;
            title: string;
            body_json: string;
            body_plain: string;
            created_at: number;
          }
        | undefined;
      if (!version) return null;
      // What is there now is kept first, so nothing is lost.
      this.saveVersion({ noteId: version.note_id, label: null, reason: "close" });
      db.prepare(
        "UPDATE notes SET title = ?, body_json = ?, body_plain = ?, updated_at = ? WHERE id = ?",
      ).run(version.title, version.body_json, version.body_plain, now(), version.note_id);
      const when = new Date(version.created_at).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
      this.saveVersion({
        noteId: version.note_id,
        label: `Restored from ${when}`.slice(0, NOTE_LIMITS.versionLabel),
        reason: "manual",
      });
      return this.get(version.note_id);
    },
    pin(noteId, pinned) {
      if (!pinned) {
        db.prepare("UPDATE notes SET pinned = 0, pin_order = NULL WHERE id = ?").run(noteId);
        return { ok: true };
      }
      const row = db.prepare("SELECT pinned FROM notes WHERE id = ?").get(noteId) as
        { pinned: number } | undefined;
      if (!row) return { ok: false, message: NOTE_MESSAGES.missing };
      if (row.pinned === 1) return { ok: true };
      const count = (
        db
          .prepare("SELECT COUNT(*) AS n FROM notes WHERE pinned = 1 AND deleted_at IS NULL")
          .get() as {
          n: number;
        }
      ).n;
      if (count >= NOTE_LIMITS.pins) return { ok: false, message: NOTE_MESSAGES.pins };
      const last = (
        db.prepare("SELECT COALESCE(MAX(pin_order), 0) AS n FROM notes WHERE pinned = 1").get() as {
          n: number;
        }
      ).n;
      db.prepare("UPDATE notes SET pinned = 1, pin_order = ? WHERE id = ?").run(last + 1, noteId);
      return { ok: true };
    },
    movePin(noteId, step) {
      const pinned = (
        db
          .prepare(
            "SELECT id FROM notes WHERE pinned = 1 AND deleted_at IS NULL ORDER BY pin_order, updated_at DESC",
          )
          .all() as { id: string }[]
      ).map((row) => row.id);
      const from = pinned.indexOf(noteId);
      const to = from + step;
      if (from === -1 || to < 0 || to >= pinned.length) return;
      [pinned[from], pinned[to]] = [pinned[to]!, pinned[from]!];
      const set = db.prepare("UPDATE notes SET pin_order = ? WHERE id = ?");
      db.exec("BEGIN IMMEDIATE");
      try {
        pinned.forEach((id, index) => set.run(index + 1, id));
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    count() {
      return (
        db.prepare("SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NULL").get() as {
          n: number;
        }
      ).n;
    },
  };
}
