import type { DatabaseSync } from "node:sqlite";
import { NOT_DISCUSSED, type AskSource } from "@murmur/shared";

/**
 * The search behind Ask (NT-14, ADR-0081): pieces of each meeting's transcript, summary, notes
 * and tasks in an FTS5 table, ranked with BM25. A meeting is indexed again, before a question,
 * when what it holds has changed since.
 */

/** A transcript piece is about this big (200 tokens at 3.5 characters each), with a line carried over. */
export const CHUNK_CHARS = Math.round(200 * 3.5);
const CARRY_CHARS = 180;
const EXCERPT_CHARS = 280;

export interface AskFilter {
  /** Only these meetings. */
  meetingIds?: readonly string[];
  /** Meetings that started from this moment (inclusive). */
  from?: number;
  /** Meetings that started before this moment. */
  to?: number;
  sources?: readonly AskSource[];
}

export interface AskHit {
  id: number;
  meetingId: string;
  meetingTitle: string;
  meetingStartedAt: number;
  source: AskSource;
  ref: string | null;
  startMs: number | null;
  text: string;
  /** BM25: lower is a better match. */
  score: number;
}

export interface AskIndex {
  /** Indexes the meetings in the filter that changed. Returns how many it indexed. */
  sync(filter?: AskFilter): number;
  /** The best pieces for a question, best first; none when it has no words to look for. */
  search(question: string, filter: AskFilter, limit: number): AskHit[];
  /** The meetings a filter covers. */
  meetings(filter: AskFilter): { id: string; title: string; startedAt: number }[];
}

export interface Piece {
  ref: string | null;
  startMs: number | null;
  text: string;
}

// ------------------------------------------------------------------ the pieces

/** Lines of a transcript, as pieces of about `CHUNK_CHARS`, each starting with the last line of the one before. */
export function transcriptPieces(
  lines: readonly { id: string; startMs: number; channel: "mic" | "system"; text: string }[],
): Piece[] {
  const pieces: Piece[] = [];
  let current: { id: string; startMs: number; text: string }[] = [];
  /** 1 while the first line of `current` is carried over from the piece before. */
  let carried = 0;
  let size = 0;
  const flush = () =>
    pieces.push({
      ref: current[0]!.id,
      startMs: current[0]!.startMs,
      text: current.map((line) => line.text).join("\n"),
    });
  for (const line of [...lines].sort((a, b) => a.startMs - b.startMs)) {
    const text = `${line.channel === "mic" ? "Owner" : "Remote"}: ${line.text}`;
    if (current.length > carried && size + text.length > CHUNK_CHARS) {
      flush();
      const last = current.at(-1)!;
      current = last.text.length <= CARRY_CHARS ? [last] : [];
      carried = current.length;
      size = current.reduce((total, item) => total + item.text.length, 0);
    }
    current.push({ id: line.id, startMs: line.startMs, text });
    size += text.length;
  }
  // A carried line with nothing after it is not a piece of its own.
  if (current.length > carried) flush();
  return pieces;
}

/** `[12:34](seg:id)` links and "(No source)" are for reading; the search needs only the words. */
const plain = (markdown: string) =>
  markdown
    .replace(/\[[^\]]*\]\(seg:[^)]*\)/g, "")
    .replace(/\(No source\)/g, "")
    .replace(/\*\*/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

/** One piece for each section of a summary (long ones in several), without the sections that say nothing. */
export function summaryPieces(summaryId: string, markdown: string): Piece[] {
  const pieces: Piece[] = [];
  for (const block of markdown.split(/^## /m).slice(1)) {
    const [heading, ...rest] = block.split("\n");
    const bullets = rest
      .map((line) => plain(line))
      .filter(
        (line) => line !== "" && !line.startsWith(NOT_DISCUSSED) && !line.startsWith("Not written"),
      );
    if (bullets.length === 0) continue;
    let group: string[] = [];
    let size = 0;
    const flush = () => {
      if (group.length > 0)
        pieces.push({
          ref: summaryId,
          startMs: null,
          text: `${heading!.trim()}\n${group.join("\n")}`,
        });
      group = [];
      size = 0;
    };
    for (const bullet of bullets) {
      if (group.length > 0 && size + bullet.length > CHUNK_CHARS * 2) flush();
      group.push(bullet);
      size += bullet.length;
    }
    flush();
  }
  return pieces;
}

/** The owner's notes, by paragraph, packed into pieces. */
export function notesPieces(body: string): Piece[] {
  const pieces: Piece[] = [];
  let group: string[] = [];
  let size = 0;
  const flush = () => {
    if (group.length > 0) pieces.push({ ref: null, startMs: null, text: group.join("\n\n") });
    group = [];
    size = 0;
  };
  for (const paragraph of body.split(/\n\s*\n/).map((part) => part.trim())) {
    if (paragraph === "") continue;
    if (group.length > 0 && size + paragraph.length > CHUNK_CHARS * 2) flush();
    group.push(paragraph);
    size += paragraph.length;
  }
  flush();
  return pieces;
}

export function taskPiece(task: {
  id: string;
  title: string;
  owner: string | null;
  ownerIsMe: boolean;
  dueOn: string | null;
}): Piece {
  const parts = [task.title];
  if (task.ownerIsMe) parts.push("owner: me");
  else if (task.owner) parts.push(`owner: ${task.owner}`);
  if (task.dueOn) parts.push(`due ${task.dueOn}`);
  return { ref: task.id, startMs: null, text: parts.join(", ") };
}

// ------------------------------------------------------------------- the query

const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have how i if in into is it its " +
    "me my of on or our s so than that the their them then there these they this to us was we were what when " +
    "where which who whom why will with would you your about any all also not no yes tell said say mention " +
    "meeting meetings discuss discussed talk talked"
  ).split(" "),
);

/**
 * The stem of an English word, cut crudely: "shipping" and "ships" both become "ship", so a
 * question matches the other forms of its words. Words that are not English are left as they are.
 */
export function stem(word: string): string {
  // shipp -> ship, but not "ll", "ss" or "zz" (calling -> call, passing -> pass).
  const undouble = (text: string) => (/([^aeioulsz])\1$/.test(text) ? text.slice(0, -1) : text);
  if (word.length > 6 && word.endsWith("ing")) return undouble(word.slice(0, -3));
  if (word.length > 4 && word.endsWith("ed")) return undouble(word.slice(0, -2));
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** FTS5 words for a question: the words that carry meaning, any of which may match. Null when there are none. */
export function ftsQuery(question: string): string | null {
  const words = (question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (word) => word.length > 1 && !STOPWORDS.has(word),
  );
  const stems = [...new Set(words.map(stem))].slice(0, 12);
  if (stems.length === 0) return null;
  // A stem of three letters or more also matches the words that start with it.
  return stems.map((word) => (word.length >= 3 ? `"${word}"*` : `"${word}"`)).join(" OR ");
}

// ------------------------------------------------------------------ the index

interface MeetingRow {
  id: string;
  title: string;
  started_at: number;
}

export function createAskIndex(db: DatabaseSync, deps: { now(): number }): AskIndex {
  function where(filter: AskFilter, params: (string | number)[], alias: string): string {
    const clauses: string[] = [];
    if (filter.meetingIds) {
      clauses.push(`${alias}.id IN (${filter.meetingIds.map(() => "?").join(", ") || "NULL"})`);
      params.push(...filter.meetingIds);
    }
    if (filter.from !== undefined) {
      clauses.push(`${alias}.started_at >= ?`);
      params.push(filter.from);
    }
    if (filter.to !== undefined) {
      clauses.push(`${alias}.started_at < ?`);
      params.push(filter.to);
    }
    return clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "";
  }

  const meetings = (filter: AskFilter) => {
    const params: (string | number)[] = [];
    const clause = where(filter, params, "m");
    return (
      db
        .prepare(
          `SELECT id, title, started_at FROM meetings m WHERE 1 = 1${clause} ORDER BY started_at DESC`,
        )
        .all(...params) as unknown as MeetingRow[]
    ).map((row) => ({ id: row.id, title: row.title, startedAt: row.started_at }));
  };

  /** What the meeting holds now, short: it changes when a transcript, summary, note or task does. */
  function signature(meetingId: string): string {
    const segments = db
      .prepare(
        "SELECT COUNT(*) AS n, COALESCE(MAX(end_ms), 0) AS last FROM meeting_segments WHERE meeting_id = ? AND is_dictated = 0",
      )
      .get(meetingId) as { n: number; last: number };
    const summary = db
      .prepare(
        "SELECT id FROM meeting_summaries WHERE meeting_id = ? AND quick = 0 ORDER BY version DESC LIMIT 1",
      )
      .get(meetingId) as { id: string } | undefined;
    const notes = db
      .prepare("SELECT updated_at FROM meeting_notes WHERE meeting_id = ?")
      .get(meetingId) as { updated_at: number } | undefined;
    const tasks = db
      .prepare(
        "SELECT COUNT(*) AS n, COALESCE(MAX(updated_at), 0) AS last FROM tasks WHERE meeting_id = ? AND status != 'archived'",
      )
      .get(meetingId) as { n: number; last: number };
    return [
      segments.n,
      segments.last,
      summary?.id ?? "",
      notes?.updated_at ?? 0,
      tasks.n,
      tasks.last,
    ].join("|");
  }

  function build(meetingId: string): { source: AskSource; piece: Piece }[] {
    const out: { source: AskSource; piece: Piece }[] = [];
    const segments = db
      .prepare(
        "SELECT id, channel, start_ms, text FROM meeting_segments WHERE meeting_id = ? AND is_dictated = 0 ORDER BY start_ms, id",
      )
      .all(meetingId) as {
      id: string;
      channel: "mic" | "system";
      start_ms: number;
      text: string;
    }[];
    for (const piece of transcriptPieces(
      segments.map((s) => ({ id: s.id, startMs: s.start_ms, channel: s.channel, text: s.text })),
    ))
      out.push({ source: "transcript", piece });
    const summary = db
      .prepare(
        "SELECT id, markdown FROM meeting_summaries WHERE meeting_id = ? AND quick = 0 ORDER BY version DESC LIMIT 1",
      )
      .get(meetingId) as { id: string; markdown: string } | undefined;
    if (summary)
      for (const piece of summaryPieces(summary.id, summary.markdown))
        out.push({ source: "summary", piece });
    const notes = db
      .prepare("SELECT body_md FROM meeting_notes WHERE meeting_id = ?")
      .get(meetingId) as { body_md: string } | undefined;
    if (notes) for (const piece of notesPieces(notes.body_md)) out.push({ source: "notes", piece });
    const tasks = db
      .prepare(
        "SELECT id, title, owner_name, owner_is_me, due_on FROM tasks WHERE meeting_id = ? AND status != 'archived' ORDER BY position",
      )
      .all(meetingId) as {
      id: string;
      title: string;
      owner_name: string | null;
      owner_is_me: number;
      due_on: string | null;
    }[];
    for (const task of tasks)
      out.push({
        source: "task",
        piece: taskPiece({
          id: task.id,
          title: task.title,
          owner: task.owner_name,
          ownerIsMe: task.owner_is_me === 1,
          dueOn: task.due_on,
        }),
      });
    return out.filter(({ piece }) => piece.text.trim() !== "");
  }

  return {
    meetings,

    sync(filter = {}) {
      let indexed = 0;
      for (const meeting of meetings(filter)) {
        const now = signature(meeting.id);
        const before = db
          .prepare("SELECT signature FROM ask_index WHERE meeting_id = ?")
          .get(meeting.id) as { signature: string } | undefined;
        if (before?.signature === now) continue;
        db.exec("BEGIN");
        try {
          db.prepare("DELETE FROM ask_chunks WHERE meeting_id = ?").run(meeting.id);
          const insert = db.prepare(
            "INSERT INTO ask_chunks (meeting_id, source, ref, start_ms, text) VALUES (?, ?, ?, ?, ?)",
          );
          for (const { source, piece } of build(meeting.id))
            insert.run(meeting.id, source, piece.ref, piece.startMs, piece.text);
          db.prepare(
            `INSERT INTO ask_index (meeting_id, signature, indexed_at) VALUES (?, ?, ?)
             ON CONFLICT (meeting_id) DO UPDATE SET signature = excluded.signature, indexed_at = excluded.indexed_at`,
          ).run(meeting.id, now, deps.now());
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        indexed++;
      }
      return indexed;
    },

    search(question, filter, limit) {
      const query = ftsQuery(question);
      if (!query) return [];
      const params: (string | number)[] = [query];
      let clause = where(filter, params, "m");
      if (filter.sources) {
        clause += ` AND c.source IN (${filter.sources.map(() => "?").join(", ") || "NULL"})`;
        params.push(...filter.sources);
      }
      params.push(limit);
      const rows = db
        .prepare(
          `SELECT c.id, c.meeting_id, m.title, m.started_at, c.source, c.ref, c.start_ms, c.text,
                  bm25(ask_fts) AS score
           FROM ask_fts
           JOIN ask_chunks c ON c.id = ask_fts.rowid
           JOIN meetings m ON m.id = c.meeting_id
           WHERE ask_fts MATCH ?${clause}
           ORDER BY score, c.id
           LIMIT ?`,
        )
        .all(...params) as {
        id: number;
        meeting_id: string;
        title: string;
        started_at: number;
        source: AskSource;
        ref: string | null;
        start_ms: number | null;
        text: string;
        score: number;
      }[];
      return rows.map((row) => ({
        id: row.id,
        meetingId: row.meeting_id,
        meetingTitle: row.title,
        meetingStartedAt: row.started_at,
        source: row.source,
        ref: row.ref,
        startMs: row.start_ms,
        text: row.text,
        score: row.score,
      }));
    },
  };
}

/** A source's words, cut short for a citation chip. */
export const excerpt = (text: string): string =>
  text.length <= EXCERPT_CHARS ? text : `${text.slice(0, EXCERPT_CHARS - 1).trimEnd()}…`;
