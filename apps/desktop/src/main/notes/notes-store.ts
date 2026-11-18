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
  type Note,
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
    count() {
      return (
        db.prepare("SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NULL").get() as {
          n: number;
        }
      ).n;
    },
  };
}
