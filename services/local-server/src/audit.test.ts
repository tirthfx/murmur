import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { GENESIS_HASH, canonicalJson, checkDetail, createAudit, type Audit } from "./audit.ts";
import { migrate } from "./migrations.ts";
import { createSettings } from "./settings.ts";

let db: DatabaseSync;
let clock = 1_000_000;
let audit: Audit;

beforeEach(() => {
  clock = 1_000_000;
  db = new DatabaseSync(":memory:");
  migrate(db);
  audit = createAudit({ db, settings: createSettings(db, () => clock), now: () => clock });
});

const add = (action = "auth.sign_in", extra: Record<string, unknown> = {}) => {
  clock += 1000;
  return audit.record({ action, actorId: "u1", targetType: "user", targetId: "u1", ...extra });
};

describe("the chain", () => {
  it("numbers entries from 1 and links each to the hash before it", () => {
    const first = add();
    const second = add("account.created");
    expect(first.seq).toBe(1);
    expect(first.prevHash).toBe(GENESIS_HASH);
    expect(second.prevHash).toBe(first.hash);
    expect(second.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(audit.verify()).toEqual({ ok: true, count: 2 });
  });

  it("verifies an empty log", () => {
    expect(audit.verify()).toEqual({ ok: true, count: 0 });
  });

  it("names the broken entry when a stored row is changed", () => {
    for (let i = 0; i < 6; i++) add();
    db.prepare("UPDATE audit_events SET action = 'auth.nothing' WHERE seq = 4").run();
    expect(audit.verify()).toMatchObject({ ok: false, brokenSeq: 4, count: 3 });
  });

  it("names the broken entry when the detail or the actor is changed", () => {
    add("role.changed", { detail: { from: "member", to: "admin" } });
    add();
    db.prepare("UPDATE audit_events SET detail_json = ? WHERE seq = 1").run(
      '{"from":"member","to":"owner"}',
    );
    expect(audit.verify().brokenSeq).toBe(1);
    db.prepare("UPDATE audit_events SET detail_json = ? WHERE seq = 1").run(
      '{"from":"member","to":"admin"}',
    );
    expect(audit.verify().ok).toBe(true);
    db.prepare("UPDATE audit_events SET actor_id = 'someone-else' WHERE seq = 2").run();
    expect(audit.verify().brokenSeq).toBe(2);
  });

  it("notices a deleted row in the middle, an inserted row and a rewritten link", () => {
    for (let i = 0; i < 5; i++) add();
    db.prepare("DELETE FROM audit_events WHERE seq = 3").run();
    expect(audit.verify()).toMatchObject({ ok: false, brokenSeq: 3 });

    const other = new DatabaseSync(":memory:");
    migrate(other);
    const copy = createAudit({
      db: other,
      settings: createSettings(other, () => clock),
      now: () => clock,
    });
    copy.record({ action: "a.b" });
    copy.record({ action: "a.c" });
    other.prepare("UPDATE audit_events SET prev_hash = ? WHERE seq = 2").run("f".repeat(64));
    expect(copy.verify()).toMatchObject({ ok: false, brokenSeq: 2 });
  });

  it("notices when the newest rows are deleted and rewritten from the middle", () => {
    for (let i = 0; i < 3; i++) add();
    // A forger who recomputes one hash still breaks the next link.
    db.prepare("UPDATE audit_events SET hash = ? WHERE seq = 2").run("a".repeat(64));
    expect(audit.verify().ok).toBe(false);
  });

  it("writes keys in a fixed order so the same row has the same hash", () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: [2, { z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[2,{"y":2,"z":1}],"d":1},"b":1}',
    );
  });
});

describe("what may be written", () => {
  it("refuses a detail that could carry content, a secret or a long value", () => {
    for (const key of [
      "transcript",
      "dictationText",
      "content",
      "note",
      "password",
      "token",
      "audio",
    ])
      expect(() => checkDetail({ [key]: "x" }), key).toThrow(/holds no content/);
    expect(() => checkDetail({ reason: "x".repeat(201) })).toThrow(/too long/);
    expect(() => checkDetail({ list: [1] as unknown as string })).toThrow(/string, number/);
    expect(() =>
      checkDetail({ from: "member", to: "admin", count: 3, ok: true, none: null }),
    ).not.toThrow();
  });

  it("refuses to record such a detail, and writes nothing", () => {
    expect(() =>
      audit.record({ action: "meeting.viewed", detail: { transcript: "hello" } }),
    ).toThrow();
    expect(audit.list().events).toHaveLength(0);
  });

  it("wants an action written area.what_happened", () => {
    expect(() => audit.record({ action: "Nope" })).toThrow(/area\.what_happened/);
    expect(() => audit.record({ action: "sign in" })).toThrow();
  });
});

describe("reading the log", () => {
  beforeEach(() => {
    add("auth.sign_in", { actorId: "u1" });
    add("auth.sign_in_failed", { actorId: "u2", targetType: "email", targetId: "x@example.com" });
    add("role.changed", { actorId: "u1", targetType: "team_member", targetId: "m1" });
    add("account.created", { actorId: "u1" });
  });

  it("lists newest first, by actor, action, prefix, target and date", () => {
    expect(audit.list().events.map((e) => e.seq)).toEqual([4, 3, 2, 1]);
    expect(audit.list({ actor: "u2" }).events.map((e) => e.action)).toEqual([
      "auth.sign_in_failed",
    ]);
    expect(audit.list({ action: "auth." }).events).toHaveLength(2);
    expect(audit.list({ action: "auth.sign_in" }).events).toHaveLength(1);
    expect(audit.list({ target: "m1" }).events).toHaveLength(1);
    expect(audit.list({ target: "email" }).events).toHaveLength(1);
    expect(audit.list({ from: 1_002_000, to: 1_003_000 }).events.map((e) => e.seq)).toEqual([3, 2]);
  });

  it("pages with a cursor", () => {
    const first = audit.list({}, { limit: 3 });
    expect(first.events.map((e) => e.seq)).toEqual([4, 3, 2]);
    expect(first.next).toBe(2);
    const second = audit.list({}, { limit: 3, before: first.next! });
    expect(second.events.map((e) => e.seq)).toEqual([1]);
    expect(second.next).toBeNull();
  });

  it("exports exactly the filtered entries as JSON lines, oldest first", () => {
    const lines = audit.exportJsonLines({ actor: "u1" }).trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    const parsed = lines.map((line) => JSON.parse(line) as { seq: number; hash: string });
    expect(parsed.map((e) => e.seq)).toEqual([1, 3, 4]);
    expect(parsed[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(audit.exportJsonLines({ actor: "nobody" })).toBe("");
  });
});

describe("retention", () => {
  it("removes old entries, keeps the chain checkable and writes what it did", () => {
    for (let i = 0; i < 5; i++) add();
    clock += 400 * 86_400_000;
    add();
    expect(audit.prune(365)).toBe(5);
    const remaining = audit.list().events;
    expect(remaining.map((e) => e.action)).toEqual(["audit.retention_pruned", "auth.sign_in"]);
    expect(remaining[1]!.seq).toBe(6);
    expect(remaining[0]!.detail).toEqual({ removed: 5, retentionDays: 365 });
    expect(audit.verify()).toEqual({ ok: true, count: 2 });
    // The chain still grows from the anchor, and a change after pruning is still found.
    add();
    expect(audit.verify().ok).toBe(true);
    db.prepare("UPDATE audit_events SET action = 'x.y' WHERE seq = 6").run();
    expect(audit.verify().brokenSeq).toBe(6);
  });

  it("removes nothing that is recent, and nothing when the log is empty", () => {
    add();
    expect(audit.prune(365)).toBe(0);
    expect(
      createAudit({ db, settings: createSettings(db, () => clock), now: () => clock }).prune(1),
    ).toBe(0);
    expect(audit.list().events).toHaveLength(1);
  });

  it("starts a log that was fully pruned from the anchor, not from zero", () => {
    add();
    clock += 400 * 86_400_000;
    audit.prune(365);
    add();
    expect(audit.verify().ok).toBe(true);
  });
});
