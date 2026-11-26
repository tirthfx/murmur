import { describe, expect, it } from "vitest";
import { mentionToken, readableMentions } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createMeetingsStore } from "../meetings/meetings-store";
import { createContactsStore } from "./contacts-store";

function setup() {
  const db = openDatabase(":memory:");
  let id = 0;
  const contacts = createContactsStore(db, { now: () => 5, newId: () => `c${++id}` });
  const meetings = createMeetingsStore(db, {
    onAttendees: (attendees) => void contacts.addAttendees(attendees),
  });
  const meeting = (name: string, attendees: { name: string | null; email: string }[] = []) =>
    meetings.create({
      id: name,
      title: name,
      startedAt: 1,
      source: "ad_hoc",
      folder: `/m/${name}`,
      attendees,
    });
  const note = (meetingId: string, body: string) =>
    db
      .prepare("INSERT INTO meeting_notes (meeting_id, body_md, updated_at) VALUES (?, ?, 1)")
      .run(meetingId, body);
  const read = (meetingId: string) =>
    (
      db.prepare("SELECT body_md FROM meeting_notes WHERE meeting_id = ?").get(meetingId) as {
        body_md: string;
      }
    ).body_md;
  const added = (input: ReturnType<typeof contacts.save>) => {
    if (!input.ok) throw new Error(input.message);
    return input.contact;
  };
  return { db, contacts, meeting, note, read, added };
}

describe("contacts (NT-12)", () => {
  it("adds, searches and refuses a second contact with the same email", () => {
    const { contacts, added } = setup();
    added(contacts.save(null, { name: "Priya Rao", email: "priya@example.com" }));
    added(contacts.save(null, { name: "Sam", email: null }));
    expect(contacts.list("pri").map((c) => c.name)).toEqual(["Priya Rao"]);
    expect(contacts.list("example.com")).toHaveLength(1);
    expect(contacts.list("%")).toHaveLength(0);
    expect(contacts.save(null, { name: "Other", email: "PRIYA@example.com" })).toMatchObject({
      ok: false,
      message: "Priya Rao already has that email address.",
    });
    expect(contacts.save(null, { name: "", email: null }).ok).toBe(false);
  });

  it("renames a contact in every mention, and keeps the text when one is deleted", () => {
    const { contacts, added, meeting, note, read } = setup();
    const priya = added(contacts.save(null, { name: "Priya", email: null }));
    meeting("m1");
    note("m1", `Ask ${mentionToken(priya)} today.`);
    contacts.save(priya.id, { name: "Priya Rao", email: null });
    expect(readableMentions(read("m1"))).toBe("Ask @Priya Rao today.");
    expect(contacts.remove(priya.id)).toBe(true);
    expect(read("m1")).toBe("Ask Priya Rao today.");
    expect(contacts.list()).toEqual([]);
  });

  it("adds calendar attendees once, and renamed speakers by name", () => {
    const { contacts, meeting } = setup();
    meeting("m1", [{ name: "Priya", email: "priya@example.com" }]);
    meeting("m2", [
      { name: null, email: "sam@example.com" },
      { name: "P", email: "priya@example.com" },
    ]);
    contacts.addSpeaker("Priya");
    contacts.addSpeaker("Remote");
    contacts.addSpeaker("Lee");
    expect(contacts.list().map((c) => [c.name, c.source])).toEqual([
      ["Lee", "speaker"],
      ["Priya", "calendar"],
      ["sam", "calendar"],
    ]);
  });

  it("shows the meetings and open tasks on a card", () => {
    const { contacts, added, meeting, note, db } = setup();
    meeting("invited", [{ name: "Priya", email: "priya@example.com" }]);
    meeting("mentioned");
    meeting("other");
    const priya = contacts.list()[0]!;
    note("mentioned", `With ${mentionToken(priya)}`);
    db.prepare(
      `INSERT INTO tasks (id, title, status, source, owner_name, position, created_at, updated_at)
       VALUES ('t1', 'Send notes', 'open', 'manual', 'priya', 1, 1, 1),
              ('t2', 'Done one', 'done', 'manual', 'Priya', 2, 1, 1)`,
    ).run();
    const card = contacts.card(priya.id)!;
    expect(card.meetings.map((m) => m.id).sort()).toEqual(["invited", "mentioned"]);
    expect(card.tasks).toEqual([{ id: "t1", title: "Send notes" }]);
    expect(contacts.card("gone")).toBeNull();
    expect(added(contacts.save(priya.id, { name: "Priya R", email: priya.email })).name).toBe(
      "Priya R",
    );
  });
});
