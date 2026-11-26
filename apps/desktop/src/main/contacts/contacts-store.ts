import type { DatabaseSync } from "node:sqlite";
import {
  CONTACT_LIMITS,
  contactDraftSchema,
  removeMentions,
  renameMentions,
  type Contact,
  type ContactCard,
  type ContactResult,
  type ContactSource,
  type MeetingAttendee,
} from "@murmur/shared";

/** Names a channel gives a speaker before anyone is named; never a contact. */
const CHANNEL_NAMES = new Set(["you", "remote", "me"]);

export interface ContactsStore {
  /** Contacts whose name or email holds the query, by name. */
  list(query?: string, limit?: number): Contact[];
  get(id: string): Contact | null;
  /** A new contact when `id` is null, else a change to that one. */
  save(id: string | null, draft: unknown, source?: ContactSource): ContactResult;
  /** Removes the contact; its mentions become the plain name. */
  remove(id: string): boolean;
  /** NT-12: people from a calendar event. Known emails are left as they are. */
  addAttendees(attendees: readonly MeetingAttendee[]): number;
  /** A renamed speaker becomes a contact unless one of that name exists. */
  addSpeaker(name: string): void;
  card(id: string): ContactCard | null;
}

export interface ContactsStoreDeps {
  now: () => number;
  newId: () => string;
}

/** Where mentions can be written. */
const TEXT_COLUMNS = [
  { table: "meeting_notes", key: "meeting_id", column: "body_md" },
  { table: "tasks", key: "id", column: "title" },
  { table: "tasks", key: "id", column: "notes" },
] as const;

const COLUMNS = "id, name, email, source, created_at, updated_at";

function contact(row: Record<string, unknown>): Contact {
  return {
    id: row.id as string,
    name: row.name as string,
    email: (row.email as string | null) ?? null,
    source: row.source as ContactSource,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

const like = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

export function createContactsStore(db: DatabaseSync, deps: ContactsStoreDeps): ContactsStore {
  const byId = db.prepare(`SELECT ${COLUMNS} FROM contacts WHERE id = ?`);
  const byEmail = db.prepare(`SELECT ${COLUMNS} FROM contacts WHERE email = ?`);
  const byName = db.prepare(`SELECT ${COLUMNS} FROM contacts WHERE name = ? COLLATE NOCASE`);

  function insert(name: string, email: string | null, source: ContactSource): Contact {
    const id = deps.newId();
    const at = deps.now();
    db.prepare(`INSERT INTO contacts (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`).run(
      id,
      name,
      email,
      source,
      at,
      at,
    );
    return { id, name, email, source, createdAt: at, updatedAt: at };
  }

  const full = () =>
    (db.prepare("SELECT COUNT(*) AS n FROM contacts").get() as { n: number }).n >=
    CONTACT_LIMITS.count;

  /** Rewrites every text that mentions the contact. */
  function rewrite(id: string, change: (text: string) => string): void {
    for (const { table, key, column } of TEXT_COLUMNS) {
      const rows = db
        .prepare(`SELECT ${key} AS key, ${column} AS text FROM ${table} WHERE ${column} LIKE ?`)
        .all(`%@[contact:${id}|%`) as { key: string; text: string }[];
      const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${key} = ?`);
      for (const row of rows) update.run(change(row.text), row.key);
    }
  }

  function inTransaction<T>(work: () => T): T {
    db.exec("BEGIN");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    list(query = "", limit = CONTACT_LIMITS.count) {
      const wanted = like(query.trim());
      return (
        db
          .prepare(
            `SELECT ${COLUMNS} FROM contacts
             WHERE name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'
             ORDER BY name COLLATE NOCASE LIMIT ?`,
          )
          .all(wanted, wanted, limit) as Record<string, unknown>[]
      ).map(contact);
    },
    get(id) {
      const row = byId.get(id) as Record<string, unknown> | undefined;
      return row ? contact(row) : null;
    },
    save(id, draft, source = "manual") {
      const parsed = contactDraftSchema.safeParse(draft);
      if (!parsed.success) {
        return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the contact." };
      }
      const { name, email } = parsed.data;
      const holder = email
        ? (byEmail.get(email) as Record<string, unknown> | undefined)
        : undefined;
      if (holder && holder.id !== id) {
        return { ok: false, message: `${holder.name as string} already has that email address.` };
      }
      if (id === null) {
        if (full()) return { ok: false, message: "The contact list is full." };
        return { ok: true, contact: insert(name, email, source) };
      }
      const current = this.get(id);
      if (!current) return { ok: false, message: "That contact no longer exists." };
      const at = deps.now();
      inTransaction(() => {
        db.prepare("UPDATE contacts SET name = ?, email = ?, updated_at = ? WHERE id = ?").run(
          name,
          email,
          at,
          id,
        );
        if (name !== current.name) rewrite(id, (text) => renameMentions(text, id, name));
      });
      return { ok: true, contact: { ...current, name, email, updatedAt: at } };
    },
    remove(id) {
      return inTransaction(() => {
        rewrite(id, (text) => removeMentions(text, id));
        return db.prepare("DELETE FROM contacts WHERE id = ?").run(id).changes > 0;
      });
    },
    addAttendees(attendees) {
      let added = 0;
      for (const attendee of attendees) {
        if (full()) break;
        const email = attendee.email.toLowerCase();
        const name = attendee.name?.trim() || email.split("@")[0]!;
        const draft = contactDraftSchema.safeParse({ name, email });
        if (!draft.success || byEmail.get(draft.data.email)) continue;
        insert(draft.data.name, draft.data.email, "calendar");
        added++;
      }
      return added;
    },
    addSpeaker(name) {
      const draft = contactDraftSchema.safeParse({ name, email: null });
      if (!draft.success || CHANNEL_NAMES.has(draft.data.name.toLowerCase())) return;
      if (byName.get(draft.data.name) || full()) return;
      insert(draft.data.name, null, "speaker");
    },
    card(id) {
      const person = this.get(id);
      if (!person) return null;
      const mention = `%@[contact:${id}|%`;
      const meetings = db
        .prepare(
          `SELECT id, title, started_at AS startedAt FROM meetings m WHERE
             EXISTS (SELECT 1 FROM meeting_speakers s
                     WHERE s.meeting_id = m.id AND s.name = ?1 COLLATE NOCASE)
             OR EXISTS (SELECT 1 FROM json_each(m.attendees_json) a
                        WHERE ?2 IS NOT NULL AND json_extract(a.value, '$.email') = ?2)
             OR EXISTS (SELECT 1 FROM meeting_notes n
                        WHERE n.meeting_id = m.id AND n.body_md LIKE ?3)
           ORDER BY started_at DESC LIMIT 100`,
        )
        .all(person.name, person.email, mention) as ContactCard["meetings"];
      const tasks = db
        .prepare(
          `SELECT id, title FROM tasks WHERE status IN ('suggested', 'open')
             AND (owner_name = ?1 COLLATE NOCASE OR title LIKE ?2 OR notes LIKE ?2)
           ORDER BY position LIMIT 100`,
        )
        .all(person.name, mention) as ContactCard["tasks"];
      return {
        contact: person,
        meetings: meetings.map((row) => ({ ...row })),
        tasks: tasks.map((row) => ({ ...row })),
      };
    },
  };
}
