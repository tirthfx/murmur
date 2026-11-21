import type { DatabaseSync } from "node:sqlite";
import {
  FOLDER_NAME_MAX,
  INBOX,
  type AudioRetention,
  type FolderSuggestion,
  type MeetingFolder,
  type TranscriptRetention,
} from "@murmur/shared";

export type FolderOutcome = { ok: true; id: string } | { ok: false; message: string };

/**
 * Folders for meetings (NT-17). A meeting is in one folder or in the Inbox (no row), so deleting
 * a folder moves its meetings to the Inbox. Suggestions are a plain weighted match, with no
 * model: attendees 0.5, title words 0.3, recency 0.2.
 */
export interface FoldersStore {
  list(): MeetingFolder[];
  get(id: string): MeetingFolder | null;
  create(name: string): FolderOutcome;
  rename(id: string, name: string): FolderOutcome;
  /** Its meetings are not deleted: they go to the Inbox. */
  remove(id: string): void;
  setDefaultSkill(id: string, skillId: string | null): void;
  setAutoExport(id: string, path: string | null): void;
  /** NT-22: a folder's own periods; null uses the ones in Settings. */
  setRetention(
    id: string,
    retention: { audio?: AudioRetention | null; transcript?: TranscriptRetention | null },
  ): void;
  /** Puts a meeting in a folder, or in the Inbox (null). */
  move(meetingId: string, folderId: string | null): FolderOutcome;
  folderOf(meetingId: string): string | null;
  /** The ids of the meetings in a folder, or in the Inbox for null. */
  meetingIds(folderId: string | null): string[];
  /** The Skill set for the folder a meeting is in, or null. */
  defaultSkillOf(meetingId: string): string | null;
  /** A folder an Inbox meeting looks like it belongs in, or null. */
  suggest(meetingId: string, attendees?: readonly string[]): FolderSuggestion | null;
  /** Stops offering this folder for meetings with the same people (or the same title words). */
  dismiss(meetingId: string, folderId: string, attendees?: readonly string[]): void;
}

const clean = (name: string) => name.replace(/\s+/g, " ").trim();

/**
 * The weights of the match (NT-17): attendees 0.5, title words 0.3, recency 0.2. A meeting that
 * was not started from a calendar event has no attendees, so that weight is left out and the
 * other two are scaled up to make 1. A folder is suggested when some title words or some people
 * match (recency alone never suggests one) and the score reaches `SUGGEST_THRESHOLD`.
 */
export const WEIGHTS = { attendees: 0.5, title: 0.3, recency: 0.2 } as const;
export const SUGGEST_THRESHOLD = 0.25;

const STOP = new Set(
  (
    "a an and are as at be by for from in is it of on or the to with meeting meetings call sync " +
    "weekly daily review update"
  ).split(" "),
);
const MONTHS = new Set(
  "jan feb mar apr may jun jul aug sep oct nov dec january february march april june july august september october november december".split(
    " ",
  ),
);

/** The words of a title that say what it is about: not numbers, months, or words every meeting has. */
export function titleWords(title: string): string[] {
  const words = (title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (word) => word.length > 2 && !/^\d+$/.test(word) && !STOP.has(word) && !MONTHS.has(word),
  );
  return [...new Set(words)];
}

const attendeeKey = (attendees: readonly string[]) =>
  [...new Set(attendees.map((name) => name.trim().toLowerCase()).filter(Boolean))].sort().join("|");

export function createFoldersStore(
  db: DatabaseSync,
  deps: { now(): number; newId(): string },
): FoldersStore {
  interface Row {
    id: string;
    name: string;
    default_skill_id: string | null;
    auto_export_path: string | null;
    retention_audio: AudioRetention | null;
    retention_transcript: TranscriptRetention | null;
    meetings: number;
  }
  const toFolder = (row: Row): MeetingFolder => ({
    id: row.id,
    name: row.name,
    meetings: row.meetings,
    defaultSkillId: row.default_skill_id,
    autoExportPath: row.auto_export_path,
    retentionAudio: row.retention_audio,
    retentionTranscript: row.retention_transcript,
  });
  const SELECT = `SELECT f.id, f.name, f.default_skill_id, f.auto_export_path, f.retention_audio, f.retention_transcript,
      (SELECT COUNT(*) FROM meetings m WHERE m.folder_id = f.id) AS meetings FROM folders f`;

  const checkName = (
    name: string,
    selfId: string | null,
  ): { ok: true; name: string } | { ok: false; message: string } => {
    const wanted = clean(name);
    if (wanted === "") return { ok: false, message: "Write a name for the folder." };
    if (wanted.length > FOLDER_NAME_MAX)
      return { ok: false, message: `A folder name can be up to ${FOLDER_NAME_MAX} characters.` };
    if (wanted.toLowerCase() === "inbox")
      return { ok: false, message: "The Inbox is always there. Choose another name." };
    const taken = db
      .prepare("SELECT id FROM folders WHERE lower(name) = lower(?) AND id IS NOT ?")
      .get(wanted, selfId) as { id: string } | undefined;
    return taken
      ? { ok: false, message: "There is a folder with that name already." }
      : { ok: true, name: wanted };
  };

  const get = (id: string): MeetingFolder | null => {
    const row = db.prepare(`${SELECT} WHERE f.id = ?`).get(id) as unknown as Row | undefined;
    return row ? toFolder(row) : null;
  };

  const meetingRow = (meetingId: string) =>
    db
      .prepare("SELECT id, title, started_at, folder_id FROM meetings WHERE id = ?")
      .get(meetingId) as
      { id: string; title: string; started_at: number; folder_id: string | null } | undefined;

  const keyOf = (meetingId: string, attendees: readonly string[]) => {
    const people = attendeeKey(attendees);
    if (people !== "") return `people:${people}`;
    const meeting = meetingRow(meetingId);
    return `title:${titleWords(meeting?.title ?? "")
      .sort()
      .join(" ")}`;
  };

  /** The emails of the people invited to a meeting, lower case (none for a meeting not from a calendar). */
  const meetingPeople = (meetingId: string): string[] => {
    const row = db.prepare("SELECT attendees_json FROM meetings WHERE id = ?").get(meetingId) as
      { attendees_json: string } | undefined;
    try {
      return [
        ...new Set(
          (JSON.parse(row?.attendees_json ?? "[]") as { email: string }[]).map((a) => a.email),
        ),
      ];
    } catch {
      return [];
    }
  };
  /** Everyone invited to the other meetings in a folder. */
  const peopleIn = (folderId: string, exceptMeeting: string): Set<string> => {
    const out = new Set<string>();
    for (const row of db
      .prepare("SELECT id FROM meetings WHERE folder_id = ? AND id != ?")
      .all(folderId, exceptMeeting) as { id: string }[])
      for (const email of meetingPeople(row.id)) out.add(email);
    return out;
  };

  return {
    list() {
      return (db.prepare(`${SELECT} ORDER BY lower(f.name)`).all() as unknown as Row[]).map(
        toFolder,
      );
    },
    get,

    create(name) {
      const checked = checkName(name, null);
      if (!checked.ok) return checked;
      const id = deps.newId();
      const at = deps.now();
      db.prepare("INSERT INTO folders (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
        id,
        checked.name,
        at,
        at,
      );
      return { ok: true, id };
    },

    rename(id, name) {
      if (!get(id)) return { ok: false, message: "That folder is gone." };
      const checked = checkName(name, id);
      if (!checked.ok) return checked;
      db.prepare("UPDATE folders SET name = ?, updated_at = ? WHERE id = ?").run(
        checked.name,
        deps.now(),
        id,
      );
      return { ok: true, id };
    },

    remove(id) {
      // ON DELETE SET NULL puts its meetings in the Inbox.
      db.prepare("DELETE FROM folders WHERE id = ?").run(id);
    },

    setDefaultSkill(id, skillId) {
      db.prepare("UPDATE folders SET default_skill_id = ?, updated_at = ? WHERE id = ?").run(
        skillId,
        deps.now(),
        id,
      );
    },

    setRetention(id, retention) {
      if (retention.audio !== undefined)
        db.prepare("UPDATE folders SET retention_audio = ?, updated_at = ? WHERE id = ?").run(
          retention.audio,
          deps.now(),
          id,
        );
      if (retention.transcript !== undefined)
        db.prepare("UPDATE folders SET retention_transcript = ?, updated_at = ? WHERE id = ?").run(
          retention.transcript,
          deps.now(),
          id,
        );
    },

    setAutoExport(id, path) {
      db.prepare("UPDATE folders SET auto_export_path = ?, updated_at = ? WHERE id = ?").run(
        path,
        deps.now(),
        id,
      );
    },

    move(meetingId, folderId) {
      if (!meetingRow(meetingId)) return { ok: false, message: "That meeting is gone." };
      if (folderId !== null && !get(folderId))
        return { ok: false, message: "That folder is gone." };
      db.prepare("UPDATE meetings SET folder_id = ? WHERE id = ?").run(folderId, meetingId);
      return { ok: true, id: folderId ?? INBOX };
    },

    folderOf: (meetingId) => meetingRow(meetingId)?.folder_id ?? null,

    meetingIds(folderId) {
      return (
        folderId === null
          ? db
              .prepare("SELECT id FROM meetings WHERE folder_id IS NULL ORDER BY started_at DESC")
              .all()
          : db
              .prepare("SELECT id FROM meetings WHERE folder_id = ? ORDER BY started_at DESC")
              .all(folderId)
      ).map((row) => (row as { id: string }).id);
    },

    defaultSkillOf(meetingId) {
      const row = db
        .prepare(
          `SELECT f.default_skill_id AS skill FROM meetings m JOIN folders f ON f.id = m.folder_id
           WHERE m.id = ?`,
        )
        .get(meetingId) as { skill: string | null } | undefined;
      return row?.skill ?? null;
    },

    suggest(meetingId, given = []) {
      const meeting = meetingRow(meetingId);
      if (!meeting || meeting.folder_id !== null) return null;
      // The people invited, when the meeting was started from a calendar event (NT-02).
      const invited = meetingPeople(meetingId);
      const attendees = given.length > 0 ? given : invited;
      const words = titleWords(meeting.title);
      const dismissedKey = keyOf(meetingId, attendees);
      const dismissed = new Set(
        (
          db
            .prepare("SELECT folder_id FROM folder_suggestion_dismissals WHERE key = ?")
            .all(dismissedKey) as {
            folder_id: string;
          }[]
        ).map((row) => row.folder_id),
      );
      // The folder of the meeting just before this one counts for recency.
      const before = db
        .prepare(
          "SELECT folder_id FROM meetings WHERE started_at < ? AND id != ? ORDER BY started_at DESC LIMIT 1",
        )
        .get(meeting.started_at, meeting.id) as { folder_id: string | null } | undefined;
      let best: { id: string; name: string; score: number } | null = null;
      for (const folder of db.prepare("SELECT id, name FROM folders").all() as {
        id: string;
        name: string;
      }[]) {
        if (dismissed.has(folder.id)) continue;
        const inFolder = new Set(
          (
            db
              .prepare("SELECT title FROM meetings WHERE folder_id = ? AND id != ?")
              .all(folder.id, meeting.id) as { title: string }[]
          ).flatMap((row) => titleWords(row.title)),
        );
        const title =
          words.length === 0 ? 0 : words.filter((word) => inFolder.has(word)).length / words.length;
        const recency = before?.folder_id === folder.id ? 1 : 0;
        // With people invited, all three weights count: the share of them who were at meetings
        // in this folder. Without, the other two are scaled up to make 1.
        const people =
          invited.length === 0
            ? 0
            : invited.filter((email) => peopleIn(folder.id, meeting.id).has(email)).length /
              invited.length;
        const score =
          invited.length > 0
            ? WEIGHTS.attendees * people + WEIGHTS.title * title + WEIGHTS.recency * recency
            : (WEIGHTS.title * title + WEIGHTS.recency * recency) /
              (WEIGHTS.title + WEIGHTS.recency);
        if (
          (title > 0 || people > 0) &&
          score >= SUGGEST_THRESHOLD &&
          (!best || score > best.score)
        )
          best = { id: folder.id, name: folder.name, score };
      }
      return best ? { folderId: best.id, folderName: best.name } : null;
    },

    dismiss(meetingId, folderId, given = []) {
      const attendees = given.length > 0 ? given : meetingPeople(meetingId);
      db.prepare(
        `INSERT OR IGNORE INTO folder_suggestion_dismissals (key, folder_id, created_at)
         VALUES (?, ?, ?)`,
      ).run(keyOf(meetingId, attendees), folderId, deps.now());
    },
  };
}
