import type { DatabaseSync } from "node:sqlite";
import {
  ASK_LIMITS,
  type AskClosest,
  type AskCitation,
  type AskMessage,
  type AskScope,
  type AskSource,
  type AskThread,
  type AskThreadItem,
} from "@murmur/shared";

/** What is kept of a citation; the meeting's title and whether it still exists are read when the thread is. */
interface StoredCitation {
  n: number;
  meetingId: string;
  meetingTitle: string;
  source: AskSource;
  ref: string | null;
  startMs: number | null;
  excerpt: string;
}

export interface NewMessage {
  role: "user" | "assistant";
  text: string;
  citations?: StoredCitation[];
  supported?: boolean | null;
  closest?: AskClosest[];
}

/** The threads of Ask (NT-14): each question and answer, with the sources an answer cites. */
export interface AskStore {
  createThread(question: string, scope: AskScope): string;
  setScope(threadId: string, scope: AskScope): void;
  addMessage(threadId: string, message: NewMessage): void;
  list(): AskThreadItem[];
  get(threadId: string): AskThread | null;
  remove(threadId: string): void;
}

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations_json: string;
  closest_json: string;
  supported: number | null;
  created_at: number;
}

export function createAskStore(
  db: DatabaseSync,
  deps: { now(): number; newId(): string },
): AskStore {
  const titleOf = (question: string) => {
    const one = question.replace(/\s+/g, " ").trim();
    return one.length <= ASK_LIMITS.title
      ? one
      : `${one.slice(0, ASK_LIMITS.title - 1).trimEnd()}…`;
  };

  const meetingsById = (ids: string[]) => {
    const found = new Map<string, { title: string; startedAt: number }>();
    for (const id of new Set(ids)) {
      const row = db.prepare("SELECT title, started_at FROM meetings WHERE id = ?").get(id) as
        { title: string; started_at: number } | undefined;
      if (row) found.set(id, { title: row.title, startedAt: row.started_at });
    }
    return found;
  };

  return {
    createThread(question, scope) {
      const id = deps.newId();
      const at = deps.now();
      db.prepare(
        "INSERT INTO ask_threads (id, title, scope_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, titleOf(question), JSON.stringify(scope), at, at);
      return id;
    },

    setScope(threadId, scope) {
      db.prepare("UPDATE ask_threads SET scope_json = ? WHERE id = ?").run(
        JSON.stringify(scope),
        threadId,
      );
    },

    addMessage(threadId, message) {
      const at = deps.now();
      const next = (
        db
          .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM ask_messages WHERE thread_id = ?")
          .get(threadId) as { n: number }
      ).n;
      db.prepare(
        `INSERT INTO ask_messages (id, thread_id, seq, role, text, citations_json, closest_json, supported, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        deps.newId(),
        threadId,
        next,
        message.role,
        message.text,
        JSON.stringify(message.citations ?? []),
        JSON.stringify(message.closest ?? []),
        message.supported === undefined || message.supported === null
          ? null
          : message.supported
            ? 1
            : 0,
        at,
      );
      db.prepare("UPDATE ask_threads SET updated_at = ? WHERE id = ?").run(at, threadId);
    },

    list() {
      return (
        db
          .prepare(
            "SELECT id, title, updated_at FROM ask_threads ORDER BY updated_at DESC, rowid DESC",
          )
          .all() as { id: string; title: string; updated_at: number }[]
      ).map((row) => ({ id: row.id, title: row.title, updatedAt: row.updated_at }));
    },

    get(threadId) {
      const thread = db.prepare("SELECT * FROM ask_threads WHERE id = ?").get(threadId) as
        | { id: string; title: string; scope_json: string; created_at: number; updated_at: number }
        | undefined;
      if (!thread) return null;
      const rows = db
        .prepare(
          `SELECT id, role, text, citations_json, closest_json, supported, created_at
           FROM ask_messages WHERE thread_id = ? ORDER BY seq`,
        )
        .all(threadId) as unknown as MessageRow[];
      const stored = rows.map((row) => ({
        row,
        citations: JSON.parse(row.citations_json) as StoredCitation[],
        closest: JSON.parse(row.closest_json) as AskClosest[],
      }));
      const live = meetingsById(
        stored.flatMap((item) => [
          ...item.citations.map((citation) => citation.meetingId),
          ...item.closest.map((meeting) => meeting.meetingId),
        ]),
      );
      const messages: AskMessage[] = stored.map(({ row, citations, closest }) => ({
        id: row.id,
        role: row.role,
        text: row.text,
        citations: citations.map((citation): AskCitation => ({
          ...citation,
          meetingTitle: live.get(citation.meetingId)?.title ?? citation.meetingTitle,
          gone: !live.has(citation.meetingId),
        })),
        supported: row.supported === null ? null : row.supported === 1,
        closest: closest
          .filter((meeting) => live.has(meeting.meetingId))
          .map((meeting) => ({ ...meeting, title: live.get(meeting.meetingId)!.title })),
        createdAt: row.created_at,
      }));
      return {
        id: thread.id,
        title: thread.title,
        scope: JSON.parse(thread.scope_json) as AskScope,
        createdAt: thread.created_at,
        updatedAt: thread.updated_at,
        messages,
      };
    },

    remove(threadId) {
      db.prepare("DELETE FROM ask_threads WHERE id = ?").run(threadId);
    },
  };
}
