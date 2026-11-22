import { describe, expect, it } from "vitest";
import { openDatabase } from "../../db/database";
import { createConnectorStore } from "../connector-store";
import { createAutomationsStore } from "./automations-store";

function setup() {
  const db = openDatabase(":memory:");
  const connectors = createConnectorStore(db);
  connectors.upsertAccount({
    id: "a1",
    connector: "gmail",
    email: "me@example.com",
    scopes: [],
    at: 1,
  });
  return { db, connectors, store: createAutomationsStore(db) };
}

const draft = (id: string, at: number, sourceId = "t1") => ({
  id,
  accountId: "a1",
  sourceKind: "task" as const,
  sourceId,
  to: "dana@example.com",
  subject: `Subject ${id}`,
  draftId: `draft-${id}`,
  openUrl: `https://mail.google.com/mail/u/me@example.com/#drafts?compose=m-${id}`,
  at,
});

describe("automations store (NT-27)", () => {
  it("records a draft with the reference to it and lists the drafts of a source, newest first", () => {
    const t = setup();
    t.store.addEmailDraft(draft("x1", 10));
    t.store.addEmailDraft(draft("x2", 20));
    t.store.addEmailDraft(draft("x3", 30, "t2"));
    const list = t.store.listEmailDrafts({ kind: "task", id: "t1" });
    expect(list.map((row) => row.id)).toEqual(["x2", "x1"]);
    expect(list[0]).toMatchObject({
      draftId: "draft-x2",
      to: "dana@example.com",
      subject: "Subject x2",
      sourceKind: "task",
    });
    expect(t.store.listEmailDrafts({ kind: "meeting", id: "t1" })).toEqual([]);
  });

  it("never keeps the text of a draft", () => {
    const t = setup();
    t.store.addEmailDraft(draft("x1", 10));
    const row = t.db.prepare("SELECT * FROM automations").get() as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toMatch(/body/i);
    expect(row.action_kind).toBe("draft_email");
    expect(row.result_ref).toBe("draft-x1");
  });

  it("keeps the rows when the account is disconnected", () => {
    const t = setup();
    t.store.addEmailDraft(draft("x1", 10));
    t.connectors.remove("a1");
    expect(t.store.listEmailDrafts({ kind: "task", id: "t1" })).toHaveLength(1);
    const row = t.db.prepare("SELECT account_id FROM automations").get() as {
      account_id: string | null;
    };
    expect(row.account_id).toBeNull();
  });

  it("removes a record and nothing else", () => {
    const t = setup();
    t.store.addEmailDraft(draft("x1", 10));
    expect(t.store.remove("x1")).toBe(true);
    expect(t.store.remove("x1")).toBe(false);
  });

  it("records a calendar event with its id and address, apart from the drafts", () => {
    const t = setup();
    t.store.addEmailDraft(draft("x1", 10));
    t.store.addCalendarEvent({
      id: "e1",
      accountId: "a1",
      sourceKind: "task",
      sourceId: "t1",
      title: "Review",
      startMs: 5000,
      eventId: "ev-1",
      openUrl: "https://www.google.com/calendar/event?eid=1",
      at: 20,
    });
    const events = t.store.listCalendarEvents({ kind: "task", id: "t1" });
    expect(events).toEqual([
      {
        id: "e1",
        sourceKind: "task",
        sourceId: "t1",
        title: "Review",
        startMs: 5000,
        eventId: "ev-1",
        openUrl: "https://www.google.com/calendar/event?eid=1",
        createdAt: 20,
      },
    ]);
    expect(t.store.listEmailDrafts({ kind: "task", id: "t1" }).map((row) => row.id)).toEqual([
      "x1",
    ]);
    const row = t.db.prepare("SELECT action_kind FROM automations WHERE id = 'e1'").get() as {
      action_kind: string;
    };
    expect(row.action_kind).toBe("create_calendar_event");
  });
});
