import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { MEETING_LIMITS, utf8Bytes, type MeetingDoc } from "@murmur/shared";

export type DocResult = { ok: true; doc: MeetingDoc } | { ok: false; message: string };

/** The owner's notes on a meeting and its attached links and files (NT-10). */
export interface MeetingNotesStore {
  notes(meetingId: string): { body: string; updatedAt: number | null };
  /** Saves the notes; false when they are over the size limit. */
  saveNotes(meetingId: string, body: string): boolean;
  docs(meetingId: string): MeetingDoc[];
  addLink(meetingId: string, url: string, title: string): DocResult;
  /** Copies a file into the meeting's folder, so it stays when the original is deleted. */
  addFile(meetingId: string, folder: string, source: string): DocResult;
  /** Where a doc can be opened: its address or its copied file. */
  target(docId: string): { kind: "link" | "file"; value: string } | null;
  removeDoc(docId: string): void;
}

interface DocRow {
  id: string;
  meeting_id: string;
  kind: "link" | "file";
  title: string;
  url: string | null;
  path: string | null;
  bytes: number | null;
  added_at: number;
}

function toDoc(row: DocRow): MeetingDoc {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    kind: row.kind,
    title: row.title,
    url: row.url,
    bytes: row.bytes,
    addedAt: row.added_at,
  };
}

/** An http or https address, or null. */
export function cleanLink(text: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function createMeetingNotesStore(
  db: DatabaseSync,
  now: () => number = Date.now,
  newId: () => string = randomUUID,
): MeetingNotesStore {
  const count = (meetingId: string) =>
    (
      db.prepare("SELECT COUNT(*) AS n FROM meeting_docs WHERE meeting_id = ?").get(meetingId) as {
        n: number;
      }
    ).n;

  const insert = (doc: Omit<DocRow, "added_at"> & { sha256: string | null }): MeetingDoc => {
    const at = now();
    db.prepare(
      `INSERT INTO meeting_docs (id, meeting_id, kind, title, url, path, sha256, bytes, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      doc.id,
      doc.meeting_id,
      doc.kind,
      doc.title,
      doc.url,
      doc.path,
      doc.sha256,
      doc.bytes,
      at,
    );
    return toDoc({ ...doc, added_at: at });
  };

  return {
    notes(meetingId) {
      const row = db
        .prepare("SELECT body_md, updated_at FROM meeting_notes WHERE meeting_id = ?")
        .get(meetingId) as { body_md: string; updated_at: number } | undefined;
      return row ? { body: row.body_md, updatedAt: row.updated_at } : { body: "", updatedAt: null };
    },
    saveNotes(meetingId, body) {
      if (utf8Bytes(body) > MEETING_LIMITS.notesBytes) return false;
      db.prepare(
        `INSERT INTO meeting_notes (meeting_id, body_md, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (meeting_id) DO UPDATE SET body_md = excluded.body_md,
           updated_at = excluded.updated_at`,
      ).run(meetingId, body, now());
      return true;
    },
    docs(meetingId) {
      return (
        db
          .prepare(
            `SELECT id, meeting_id, kind, title, url, path, bytes, added_at FROM meeting_docs
             WHERE meeting_id = ? ORDER BY added_at, id`,
          )
          .all(meetingId) as unknown as DocRow[]
      ).map(toDoc);
    },
    addLink(meetingId, url, title) {
      const link = cleanLink(url);
      if (!link) return { ok: false, message: "Use a web address starting with http or https." };
      if (count(meetingId) >= MEETING_LIMITS.docsPerMeeting) {
        return {
          ok: false,
          message: `A meeting holds at most ${MEETING_LIMITS.docsPerMeeting} docs.`,
        };
      }
      const name = title.trim().slice(0, 200) || new URL(link).host;
      return {
        ok: true,
        doc: insert({
          id: newId(),
          meeting_id: meetingId,
          kind: "link",
          title: name,
          url: link,
          path: null,
          sha256: null,
          bytes: null,
        }),
      };
    },
    addFile(meetingId, folder, source) {
      if (count(meetingId) >= MEETING_LIMITS.docsPerMeeting) {
        return {
          ok: false,
          message: `A meeting holds at most ${MEETING_LIMITS.docsPerMeeting} docs.`,
        };
      }
      let size: number;
      try {
        const info = statSync(source);
        if (!info.isFile()) return { ok: false, message: "Choose a file, not a folder." };
        size = info.size;
      } catch {
        return { ok: false, message: "The file could not be read." };
      }
      if (size > MEETING_LIMITS.docFileBytes) {
        return { ok: false, message: "Files up to 50 MB can be attached." };
      }
      const id = newId();
      const name = path.basename(source).slice(0, 180);
      const target = path.join(folder, "docs", `${id}-${name}`);
      try {
        mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        copyFileSync(source, target);
        const sha256 = createHash("sha256").update(readFileSync(target)).digest("hex");
        return {
          ok: true,
          doc: insert({
            id,
            meeting_id: meetingId,
            kind: "file",
            title: name,
            url: null,
            path: target,
            sha256,
            bytes: size,
          }),
        };
      } catch {
        rmSync(target, { force: true });
        return { ok: false, message: "The file could not be copied." };
      }
    },
    target(docId) {
      const row = db.prepare("SELECT kind, url, path FROM meeting_docs WHERE id = ?").get(docId) as
        { kind: "link" | "file"; url: string | null; path: string | null } | undefined;
      if (!row) return null;
      const value = row.kind === "link" ? row.url : row.path;
      return value ? { kind: row.kind, value } : null;
    },
    removeDoc(docId) {
      const row = db.prepare("SELECT path FROM meeting_docs WHERE id = ?").get(docId) as
        { path: string | null } | undefined;
      db.prepare("DELETE FROM meeting_docs WHERE id = ?").run(docId);
      if (row?.path) rmSync(row.path, { force: true });
    },
  };
}
