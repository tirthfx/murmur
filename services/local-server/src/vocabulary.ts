import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AuditInput } from "./audit.ts";
import { parseCsv } from "./csv.ts";
import { fail, type Failure } from "./http.ts";
import type { TeamSettings, VocabularySettings } from "./team-settings.ts";
import type { Who } from "./teams.ts";

export type { Who };

/**
 * The shared dictionary and snippets of a team (TM-06 to TM-08): entries with a scope (the whole
 * team, or one department), who proposed and approved them, a version and a history to roll back
 * to. Whether a change goes live at once, waits for a review, or is for admins alone is the team's
 * governance mode. A person's own entries stay on their machine and win over these.
 */
export type Kind = "dictionary" | "snippet";
export type Scope = "company" | "department";
export type Status = "active" | "pending" | "rejected" | "deleted";

export const LIMITS = {
  term: 60,
  replacement: 500,
  pronunciation: 100,
  triggerMin: 2,
  trigger: 60,
  expansionBytes: 20 * 1024,
  comment: 500,
  importRows: 1000,
} as const;
const DAY_MS = 86_400_000;

export interface DictionaryPayload {
  term: string;
  replacement: string | null;
  pronunciation: string;
}
export interface SnippetPayload {
  trigger: string;
  /** Markdown when `format` is markdown, plain text otherwise. */
  expansion: string;
  format: "plain" | "markdown";
}
export type Payload = DictionaryPayload | SnippetPayload;

export interface PendingChange {
  action: "update" | "delete";
  payload?: Payload;
  by: string;
  at: number;
}

export interface VocabularyItem {
  id: string;
  kind: Kind;
  scope: Scope;
  departmentId: string | null;
  payload: Payload;
  status: Status;
  locked: boolean;
  version: number;
  proposedBy: string | null;
  approvedBy: string | null;
  /** A change to an active entry that is waiting for a review. */
  pending: PendingChange | null;
  createdAt: number;
  updatedAt: number;
}

export interface VocabularyDeps {
  db: DatabaseSync;
  now(): number;
  audit(input: AuditInput): void;
  settings: TeamSettings;
}

interface Row {
  id: string;
  team_id: string;
  kind: Kind;
  scope: Scope;
  department_id: string | null;
  key: string;
  payload_json: string;
  status: Status;
  pending_json: string | null;
  locked: number;
  proposed_by: string | null;
  approved_by: string | null;
  version: number;
  created_at: number;
  updated_at: number;
}

type Ok<T> = { ok: true } & T;
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

const isAdmin = (who: Who) => who.isServerOwner || who.role === "owner" || who.role === "admin";

export function createVocabulary(deps: VocabularyDeps) {
  const { db } = deps;

  const row = (id: string, teamId: string) =>
    db.prepare("SELECT * FROM vocabulary_items WHERE id = ? AND team_id = ?").get(id, teamId) as
      Row | undefined;

  const toItem = (r: Row): VocabularyItem => ({
    id: r.id,
    kind: r.kind,
    scope: r.scope,
    departmentId: r.department_id,
    payload: JSON.parse(r.payload_json) as Payload,
    status: r.status,
    locked: r.locked === 1,
    version: r.version,
    proposedBy: r.proposed_by,
    approvedBy: r.approved_by,
    pending: r.pending_json ? (JSON.parse(r.pending_json) as PendingChange) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  const bump = (teamId: string) =>
    db
      .prepare(
        `INSERT INTO team_revisions (team_id, revision) VALUES (?, 1)
         ON CONFLICT (team_id) DO UPDATE SET revision = revision + 1`,
      )
      .run(teamId);

  const revision = (teamId: string): number =>
    (
      db.prepare("SELECT revision FROM team_revisions WHERE team_id = ?").get(teamId) as
        { revision: number } | undefined
    )?.revision ?? 0;

  const log = (
    who: Who | string | null,
    action: string,
    id: string,
    detail: Record<string, string | number | boolean>,
  ) =>
    deps.audit({
      actorId: typeof who === "object" && who !== null ? who.userId : who,
      action,
      targetType: "vocabulary_item",
      targetId: id,
      detail,
    });

  const history = (
    id: string,
    version: number,
    action: string,
    payloadJson: string,
    status: Status,
    by: string | null,
  ) =>
    db
      .prepare(
        `INSERT INTO vocabulary_versions (item_id, version, action, payload_json, status, changed_by, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, version, action, payloadJson, status, by, deps.now());

  // ---- rules ----

  /** Admins approve anything; a Manager approves what is shared with their own department. */
  const canApprove = (who: Who, scope: Scope, departmentId: string | null): boolean =>
    isAdmin(who) ||
    (who.role === "manager" &&
      scope === "department" &&
      departmentId !== null &&
      departmentId === who.departmentId);

  const locked = (who: Who, settings: VocabularySettings): Failure | null =>
    settings.governanceMode === "locked" && !isAdmin(who)
      ? fail(403, "locked", "This team's vocabulary is locked: only admins change it.")
      : null;

  function validate(
    kind: Kind,
    input: Record<string, unknown>,
    settings: VocabularySettings,
  ): Ok<{ payload: Payload; key: string }> | Failure {
    if (kind === "dictionary") {
      const term = typeof input["term"] === "string" ? oneLine(input["term"]) : "";
      if (term === "" || term.length > LIMITS.term)
        return fail(400, "invalid_term", `A term is 1 to ${LIMITS.term} characters.`);
      const replacementRaw = input["replacement"];
      if (
        replacementRaw !== undefined &&
        replacementRaw !== null &&
        typeof replacementRaw !== "string"
      )
        return fail(400, "invalid_replacement", "A replacement is text, or left out.");
      const replacement = typeof replacementRaw === "string" ? replacementRaw.trim() : "";
      if (replacement.length > LIMITS.replacement)
        return fail(
          400,
          "invalid_replacement",
          `A replacement has at most ${LIMITS.replacement} characters.`,
        );
      const pronunciation =
        typeof input["pronunciation"] === "string" ? oneLine(input["pronunciation"]) : "";
      if (pronunciation.length > LIMITS.pronunciation)
        return fail(
          400,
          "invalid_pronunciation",
          `A pronunciation hint has at most ${LIMITS.pronunciation} characters.`,
        );
      return {
        ok: true,
        payload: { term, replacement: replacement === "" ? null : replacement, pronunciation },
        key: term.toLowerCase(),
      };
    }

    const trigger = typeof input["trigger"] === "string" ? oneLine(input["trigger"]) : "";
    if (trigger.length < LIMITS.triggerMin || trigger.length > LIMITS.trigger)
      return fail(
        400,
        "invalid_trigger",
        `A trigger is ${LIMITS.triggerMin} to ${LIMITS.trigger} characters.`,
      );
    const expansion = typeof input["expansion"] === "string" ? input["expansion"] : "";
    if (expansion.trim() === "")
      return fail(400, "invalid_expansion", "A snippet needs text to insert.");
    if (Buffer.byteLength(expansion) > LIMITS.expansionBytes)
      return fail(400, "invalid_expansion", "That snippet is too long.");
    const format = input["format"] ?? "plain";
    if (format !== "plain" && format !== "markdown")
      return fail(400, "invalid_format", "The format is plain or markdown.");
    if (format === "markdown" && !settings.allowRichText)
      return fail(400, "rich_text_off", "This team's snippets are plain text only.");
    for (const match of expansion.matchAll(/\{\{([^{}]*)\}\}/g)) {
      const name = (match[1] ?? "").trim().toLowerCase();
      if (!(settings.allowVariables as readonly string[]).includes(name))
        return fail(
          400,
          "variable_not_allowed",
          `{{${name}}} is not allowed. This team allows: ${settings.allowVariables.map((v) => `{{${v}}}`).join(", ") || "no variables"}.`,
        );
    }
    return { ok: true, payload: { trigger, expansion, format }, key: trigger.toLowerCase() };
  }

  const duplicate = (
    teamId: string,
    kind: Kind,
    scope: Scope,
    departmentId: string | null,
    key: string,
    exceptId: string | null,
  ): boolean =>
    db
      .prepare(
        `SELECT 1 FROM vocabulary_items
         WHERE team_id = ? AND kind = ? AND scope = ? AND COALESCE(department_id, '') = ? AND key = ?
           AND status IN ('active', 'pending') AND id != ?`,
      )
      .get(teamId, kind, scope, departmentId ?? "", key, exceptId ?? "") !== undefined;

  /** Where a new entry goes, and whether this person may put it there. */
  function placeFor(
    who: Who,
    teamId: string,
    input: Record<string, unknown>,
    settings: VocabularySettings,
  ): Ok<{ scope: Scope; departmentId: string | null }> | Failure {
    const asked = input["scope"];
    if (asked !== undefined && asked !== "company" && asked !== "department")
      return fail(400, "invalid_scope", "The scope is company or department.");
    let scope: Scope = (asked as Scope | undefined) ?? settings.defaultScope;
    let departmentId: string | null = null;
    if (scope === "department") {
      departmentId =
        typeof input["departmentId"] === "string" ? input["departmentId"] : who.departmentId;
      // Left to the default, a person with no department adds to the whole team.
      if (departmentId === null && asked === undefined) scope = "company";
      else if (departmentId === null)
        return fail(400, "no_department", "Choose a department, or add it to the whole team.");
    }
    if (departmentId !== null) {
      const dept = db.prepare("SELECT team_id FROM departments WHERE id = ?").get(departmentId) as
        { team_id: string } | undefined;
      if (!dept || dept.team_id !== teamId)
        return fail(400, "invalid_department", "That department is not in this team.");
      if (!isAdmin(who) && departmentId !== who.departmentId)
        return fail(
          403,
          "forbidden",
          "You can only add to your own department or to the whole team.",
        );
    }
    return { ok: true, scope, departmentId };
  }

  /** Whether this person can see an entry: the whole team's, their department's, or any as admin. */
  const visible = (who: Who, r: Row): boolean =>
    isAdmin(who) || r.scope === "company" || r.department_id === who.departmentId;

  function applyPayload(r: Row, payload: Payload, key: string, who: Who, action: string): number {
    const version = r.version + 1;
    const json = JSON.stringify(payload);
    db.prepare(
      `UPDATE vocabulary_items SET payload_json = ?, key = ?, version = ?, status = 'active', pending_json = NULL,
              approved_by = ?, updated_at = ? WHERE id = ?`,
    ).run(json, key, version, who.userId, deps.now(), r.id);
    history(r.id, version, action, json, "active", who.userId);
    return version;
  }

  function summary(kind: Kind, payload: Payload): string {
    return kind === "dictionary"
      ? (payload as DictionaryPayload).term
      : (payload as SnippetPayload).trigger;
  }

  function notify(r: Row, userId: string | null, kind: string, note: string): void {
    if (!userId) return;
    db.prepare(
      `INSERT INTO vocabulary_notices (id, team_id, user_id, item_id, kind, summary, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      r.team_id,
      userId,
      r.id,
      kind,
      summary(r.kind, JSON.parse(r.payload_json) as Payload).slice(0, 100),
      note.slice(0, LIMITS.comment),
      deps.now(),
    );
  }

  // ---- the operations ----

  function propose(
    who: Who,
    teamId: string,
    kind: Kind,
    input: Record<string, unknown>,
  ): Ok<{ item: VocabularyItem; live: boolean }> | Failure {
    const settings = deps.settings.vocabulary(teamId);
    const closed = locked(who, settings);
    if (closed) return closed;
    const place = placeFor(who, teamId, input, settings);
    if (!place.ok) return place;
    const checked = validate(kind, input, settings);
    if (!checked.ok) return checked;
    if (duplicate(teamId, kind, place.scope, place.departmentId, checked.key, null))
      return fail(409, "duplicate", "That is already in the shared list for this scope.");

    const live =
      settings.governanceMode === "open" || canApprove(who, place.scope, place.departmentId);
    const id = randomUUID();
    const now = deps.now();
    const json = JSON.stringify(checked.payload);
    db.prepare(
      `INSERT INTO vocabulary_items
         (id, team_id, kind, scope, department_id, key, payload_json, status, proposed_by, approved_by,
          version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      id,
      teamId,
      kind,
      place.scope,
      place.departmentId,
      checked.key,
      json,
      live ? "active" : "pending",
      who.userId,
      live ? who.userId : null,
      now,
      now,
    );
    if (live) {
      history(id, 1, "created", json, "active", who.userId);
      bump(teamId);
    }
    log(who, live ? "vocabulary.created" : "vocabulary.proposed", id, {
      kind,
      scope: place.scope,
      action: "create",
    });
    return { ok: true, item: toItem(row(id, teamId)!), live };
  }

  function change(
    who: Who,
    teamId: string,
    id: string,
    action: "update" | "delete",
    input: Record<string, unknown>,
  ): Ok<{ item: VocabularyItem; live: boolean }> | Failure {
    const r = row(id, teamId);
    if (!r || !visible(who, r) || (r.status !== "active" && r.status !== "pending"))
      return fail(404, "not_found", "There is no such entry.");
    const settings = deps.settings.vocabulary(teamId);
    const closed = locked(who, settings);
    if (closed) return closed;
    if (r.locked === 1 && !isAdmin(who))
      return fail(403, "locked", "This entry is locked. Only an admin can change it.");
    if (!isAdmin(who) && r.scope === "department" && r.department_id !== who.departmentId)
      return fail(403, "forbidden", "That belongs to another department.");
    const current = JSON.parse(r.payload_json) as Payload;
    const reviewer = canApprove(who, r.scope, r.department_id);

    // An entry that was never approved: its maker or a reviewer edits or withdraws it in place.
    if (r.status === "pending") {
      if (r.proposed_by !== who.userId && !reviewer)
        return fail(
          403,
          "forbidden",
          "Only the person who proposed it, or a reviewer, can change it.",
        );
      if (action === "delete") {
        db.prepare(
          "UPDATE vocabulary_items SET status = 'deleted', updated_at = ? WHERE id = ?",
        ).run(deps.now(), id);
        log(who, "vocabulary.withdrawn", id, { kind: r.kind, scope: r.scope });
        return { ok: true, item: toItem(row(id, teamId)!), live: false };
      }
      const checked = validate(r.kind, { ...current, ...input }, settings);
      if (!checked.ok) return checked;
      if (duplicate(teamId, r.kind, r.scope, r.department_id, checked.key, id))
        return fail(409, "duplicate", "That is already in the shared list for this scope.");
      db.prepare(
        "UPDATE vocabulary_items SET payload_json = ?, key = ?, updated_at = ? WHERE id = ?",
      ).run(JSON.stringify(checked.payload), checked.key, deps.now(), id);
      log(who, "vocabulary.proposal_edited", id, { kind: r.kind, scope: r.scope });
      return { ok: true, item: toItem(row(id, teamId)!), live: false };
    }

    if (r.pending_json)
      return fail(409, "change_pending", "A change to this entry is already waiting for a review.");
    let next: Payload | undefined;
    let key = r.key;
    if (action === "update") {
      const checked = validate(r.kind, { ...current, ...input }, settings);
      if (!checked.ok) return checked;
      if (duplicate(teamId, r.kind, r.scope, r.department_id, checked.key, id))
        return fail(409, "duplicate", "That is already in the shared list for this scope.");
      next = checked.payload;
      key = checked.key;
    }

    const live = settings.governanceMode === "open" || reviewer;
    if (!live) {
      const pending: PendingChange = {
        action,
        ...(next ? { payload: next } : {}),
        by: who.userId,
        at: deps.now(),
      };
      db.prepare("UPDATE vocabulary_items SET pending_json = ? WHERE id = ?").run(
        JSON.stringify(pending),
        id,
      );
      log(who, "vocabulary.proposed", id, { kind: r.kind, scope: r.scope, action });
      return { ok: true, item: toItem(row(id, teamId)!), live: false };
    }
    if (action === "update") {
      const version = applyPayload(r, next!, key, who, "updated");
      log(who, "vocabulary.updated", id, { kind: r.kind, scope: r.scope, version });
    } else {
      const version = r.version + 1;
      db.prepare(
        "UPDATE vocabulary_items SET status = 'deleted', version = ?, approved_by = ?, updated_at = ? WHERE id = ?",
      ).run(version, who.userId, deps.now(), id);
      history(id, version, "deleted", r.payload_json, "deleted", who.userId);
      log(who, "vocabulary.deleted", id, { kind: r.kind, scope: r.scope, version });
    }
    bump(teamId);
    return { ok: true, item: toItem(row(id, teamId)!), live: true };
  }

  /** What a reviewer may act on: the row, if it waits for a decision and is theirs to decide. */
  function reviewable(who: Who, teamId: string, id: string): Ok<{ r: Row }> | Failure {
    const r = row(id, teamId);
    if (!r || (r.status !== "pending" && !r.pending_json))
      return fail(404, "not_found", "Nothing is waiting for review there.");
    if (!canApprove(who, r.scope, r.department_id))
      return fail(403, "forbidden", "You can only review what is shared with your own department.");
    return { ok: true, r };
  }

  function approve(who: Who, teamId: string, id: string): Ok<{ item: VocabularyItem }> | Failure {
    const found = reviewable(who, teamId, id);
    if (!found.ok) return found;
    const r = found.r;
    if (r.status === "pending") {
      db.prepare(
        "UPDATE vocabulary_items SET status = 'active', approved_by = ?, updated_at = ? WHERE id = ?",
      ).run(who.userId, deps.now(), id);
      history(id, r.version, "created", r.payload_json, "active", who.userId);
      log(who, "vocabulary.approved", id, { kind: r.kind, scope: r.scope, action: "create" });
    } else {
      const pending = JSON.parse(r.pending_json!) as PendingChange;
      if (pending.action === "delete") {
        const version = r.version + 1;
        db.prepare(
          "UPDATE vocabulary_items SET status = 'deleted', pending_json = NULL, version = ?, approved_by = ?, updated_at = ? WHERE id = ?",
        ).run(version, who.userId, deps.now(), id);
        history(id, version, "deleted", r.payload_json, "deleted", who.userId);
      } else {
        const payload = pending.payload!;
        const key = kindKey(r.kind, payload).toLowerCase();
        if (duplicate(teamId, r.kind, r.scope, r.department_id, key, id))
          return fail(409, "duplicate", "That is already in the shared list for this scope.");
        applyPayload(r, payload, key, who, "updated");
      }
      log(who, "vocabulary.approved", id, { kind: r.kind, scope: r.scope, action: pending.action });
    }
    bump(teamId);
    return { ok: true, item: toItem(row(id, teamId)!) };
  }

  function reject(
    who: Who,
    teamId: string,
    id: string,
    comment: string,
  ): Ok<{ item: VocabularyItem }> | Failure {
    const found = reviewable(who, teamId, id);
    if (!found.ok) return found;
    const r = found.r;
    const note = comment.trim().slice(0, LIMITS.comment);
    let proposer = r.proposed_by;
    if (r.status === "pending") {
      db.prepare(
        "UPDATE vocabulary_items SET status = 'rejected', updated_at = ? WHERE id = ?",
      ).run(deps.now(), id);
    } else {
      proposer = (JSON.parse(r.pending_json!) as PendingChange).by;
      db.prepare(
        "UPDATE vocabulary_items SET pending_json = NULL, updated_at = ? WHERE id = ?",
      ).run(deps.now(), id);
    }
    if (note !== "")
      db.prepare(
        "INSERT INTO vocabulary_comments (id, item_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(randomUUID(), id, who.userId, note, deps.now());
    notify(r, proposer, "rejected", note);
    log(who, "vocabulary.rejected", id, { kind: r.kind, scope: r.scope });
    return { ok: true, item: toItem(row(id, teamId)!) };
  }

  function comment(who: Who, teamId: string, id: string, body: string): Ok<object> | Failure {
    const r = row(id, teamId);
    if (!r || !visible(who, r)) return fail(404, "not_found", "There is no such entry.");
    if (!canApprove(who, r.scope, r.department_id))
      return fail(403, "forbidden", "You can only comment on what you review.");
    const text = body.trim();
    if (text === "" || text.length > LIMITS.comment)
      return fail(400, "invalid_comment", `A comment is 1 to ${LIMITS.comment} characters.`);
    db.prepare(
      "INSERT INTO vocabulary_comments (id, item_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(randomUUID(), id, who.userId, text, deps.now());
    log(who, "vocabulary.commented", id, { kind: r.kind, scope: r.scope });
    return { ok: true };
  }

  function rollback(
    who: Who,
    teamId: string,
    id: string,
    version: number,
  ): Ok<{ item: VocabularyItem }> | Failure {
    const r = row(id, teamId);
    if (!r) return fail(404, "not_found", "There is no such entry.");
    if (r.status === "pending" || r.status === "rejected")
      return fail(
        409,
        "never_active",
        "That entry was never approved, so there is nothing to roll back.",
      );
    const old = db
      .prepare(
        "SELECT action, payload_json FROM vocabulary_versions WHERE item_id = ? AND version = ?",
      )
      .get(id, version) as { action: string; payload_json: string } | undefined;
    if (!old) return fail(404, "no_such_version", "That version is not kept (or never existed).");
    if (old.action === "deleted")
      return fail(400, "invalid_version", "That version is the deletion.");
    const payload = JSON.parse(old.payload_json) as Payload;
    const key = kindKey(r.kind, payload).toLowerCase();
    if (duplicate(teamId, r.kind, r.scope, r.department_id, key, id))
      return fail(409, "duplicate", "That is now used by another entry in this scope.");
    const newVersion = applyPayload(r, payload, key, who, "rolled_back");
    bump(teamId);
    log(who, "vocabulary.rolled_back", id, {
      kind: r.kind,
      scope: r.scope,
      from: r.version,
      to: version,
      version: newVersion,
    });
    return { ok: true, item: toItem(row(id, teamId)!) };
  }

  const kindKey = (kind: Kind, payload: Payload): string =>
    kind === "dictionary"
      ? (payload as DictionaryPayload).term
      : (payload as SnippetPayload).trigger;

  function setLocked(
    who: Who,
    teamId: string,
    id: string,
    lock: boolean,
  ): Ok<{ item: VocabularyItem }> | Failure {
    const r = row(id, teamId);
    if (!r || (r.status !== "active" && r.status !== "pending"))
      return fail(404, "not_found", "There is no such entry.");
    if (r.kind !== "snippet") return fail(400, "not_a_snippet", "Only snippets can be locked.");
    if ((r.locked === 1) !== lock) {
      db.prepare("UPDATE vocabulary_items SET locked = ?, updated_at = ? WHERE id = ?").run(
        lock ? 1 : 0,
        deps.now(),
        id,
      );
      bump(teamId);
      log(who, "vocabulary.lock_changed", id, { kind: r.kind, scope: r.scope, locked: lock });
    }
    return { ok: true, item: toItem(row(id, teamId)!) };
  }

  // ---- reading ----

  const itemsWhere = (teamId: string, kind: Kind | null, status: string) =>
    db
      .prepare(
        `SELECT * FROM vocabulary_items WHERE team_id = ? AND status = ? ${kind ? "AND kind = ?" : ""} ORDER BY key`,
      )
      .all(teamId, status, ...(kind ? [kind] : [])) as unknown as Row[];

  /** The context a client needs to fill in `{{me}}` and `{{team}}`. */
  const context = (teamId: string, who: Who) => ({
    me: who.name,
    team:
      (
        db.prepare("SELECT name FROM teams WHERE id = ?").get(teamId) as
          { name: string } | undefined
      )?.name ?? "",
  });

  return {
    propose,
    update: (who: Who, teamId: string, id: string, input: Record<string, unknown>) =>
      change(who, teamId, id, "update", input),
    remove: (who: Who, teamId: string, id: string) => change(who, teamId, id, "delete", {}),
    approve,
    reject,
    comment,
    rollback,
    setLocked,
    revision,
    bump,
    canApprove,

    /** The active entries of one kind that this person can see. */
    list(who: Who, teamId: string, kind: Kind): VocabularyItem[] {
      return itemsWhere(teamId, kind, "active")
        .filter((r) => visible(who, r))
        .map(toItem);
    },

    /** One entry with its review comments and its versions: for reviewers. */
    detail(who: Who, teamId: string, id: string) {
      const r = row(id, teamId);
      if (!r || !visible(who, r)) return fail(404, "not_found", "There is no such entry.");
      if (!canApprove(who, r.scope, r.department_id))
        return fail(403, "forbidden", "You can only look at the history of what you review.");
      return {
        ok: true as const,
        item: toItem(r),
        comments: (
          db
            .prepare(
              `SELECT c.id, c.author_id, u.name AS author, c.body, c.created_at
               FROM vocabulary_comments c JOIN users u ON u.id = c.author_id WHERE c.item_id = ? ORDER BY c.created_at`,
            )
            .all(id) as {
            id: string;
            author_id: string;
            author: string;
            body: string;
            created_at: number;
          }[]
        ).map((c) => ({
          id: c.id,
          authorId: c.author_id,
          author: c.author,
          body: c.body,
          createdAt: c.created_at,
        })),
        versions: (
          db
            .prepare(
              `SELECT v.version, v.action, v.payload_json, v.status, v.changed_by, u.name AS changer, v.changed_at
               FROM vocabulary_versions v LEFT JOIN users u ON u.id = v.changed_by
               WHERE v.item_id = ? ORDER BY v.version DESC, v.id DESC`,
            )
            .all(id) as {
            version: number;
            action: string;
            payload_json: string;
            status: string;
            changed_by: string | null;
            changer: string | null;
            changed_at: number;
          }[]
        ).map((v) => ({
          version: v.version,
          action: v.action,
          payload: JSON.parse(v.payload_json) as Payload,
          status: v.status,
          changedBy: v.changed_by,
          changedByName: v.changer,
          changedAt: v.changed_at,
        })),
      };
    },

    /** The review queue: new entries and changes waiting for a decision, in the reviewer's scope. */
    pending(who: Who, teamId: string): (VocabularyItem & { proposerName: string | null })[] {
      const rows = db
        .prepare(
          `SELECT * FROM vocabulary_items WHERE team_id = ? AND (status = 'pending' OR pending_json IS NOT NULL)
           ORDER BY updated_at, created_at`,
        )
        .all(teamId) as unknown as Row[];
      return rows
        .filter((r) => canApprove(who, r.scope, r.department_id))
        .map((r) => {
          const item = toItem(r);
          const by = item.pending?.by ?? r.proposed_by;
          const name = by
            ? ((
                db.prepare("SELECT name FROM users WHERE id = ?").get(by) as
                  { name: string } | undefined
              )?.name ?? null)
            : null;
          return { ...item, proposerName: name };
        });
    },

    /** What a person proposed that is still waiting or was turned down. */
    mine(who: Who, teamId: string): VocabularyItem[] {
      return (
        db
          .prepare(
            `SELECT * FROM vocabulary_items WHERE team_id = ?
             AND ((proposed_by = ? AND status IN ('pending', 'rejected')) OR pending_json LIKE ?)
             ORDER BY updated_at DESC`,
          )
          .all(teamId, who.userId, `%"by":"${who.userId}"%`) as unknown as Row[]
      ).map(toItem);
    },

    /** Rejections a person has not been told about yet. */
    notices(who: Who, teamId: string) {
      return (
        db
          .prepare(
            "SELECT id, item_id, kind, summary, note, created_at FROM vocabulary_notices WHERE team_id = ? AND user_id = ? AND seen_at IS NULL ORDER BY created_at",
          )
          .all(teamId, who.userId) as {
          id: string;
          item_id: string;
          kind: string;
          summary: string;
          note: string;
          created_at: number;
        }[]
      ).map((n) => ({
        id: n.id,
        itemId: n.item_id,
        kind: n.kind,
        summary: n.summary,
        note: n.note,
        createdAt: n.created_at,
      }));
    },

    markNoticesSeen(who: Who, teamId: string): number {
      return Number(
        db
          .prepare(
            "UPDATE vocabulary_notices SET seen_at = ? WHERE team_id = ? AND user_id = ? AND seen_at IS NULL",
          )
          .run(deps.now(), teamId, who.userId).changes,
      );
    },

    /**
     * What a client applies: the team's entries and the person's department's, the department's
     * winning when both have the same term. A person's own entries (on their machine) win over
     * these. `since` is the revision the client already has.
     */
    merged(who: Who, teamId: string, since?: number) {
      const current = revision(teamId);
      const settings = deps.settings.vocabulary(teamId);
      if (since !== undefined && since === current)
        return { revision: current, unchanged: true as const, syncMinutes: settings.syncMinutes };
      const pick = (kind: Kind) => {
        const winners = new Map<string, Row>();
        for (const r of itemsWhere(teamId, kind, "active")) {
          if (r.scope === "department" && r.department_id !== who.departmentId) continue;
          const seen = winners.get(r.key);
          if (!seen || (seen.scope === "company" && r.scope === "department"))
            winners.set(r.key, r);
        }
        return [...winners.values()].map(toItem);
      };
      return {
        revision: current,
        unchanged: false as const,
        syncMinutes: settings.syncMinutes,
        context: context(teamId, who),
        dictionary: pick("dictionary").map((item) => ({
          id: item.id,
          scope: item.scope,
          version: item.version,
          ...(item.payload as DictionaryPayload),
        })),
        snippets: pick("snippet").map((item) => ({
          id: item.id,
          scope: item.scope,
          version: item.version,
          locked: item.locked,
          ...(item.payload as SnippetPayload),
        })),
      };
    },

    /** Terms in several places, and snippet triggers that clash with the dictionary. */
    conflicts(teamId: string) {
      const dictionary = itemsWhere(teamId, "dictionary", "active").map(toItem);
      const snippets = itemsWhere(teamId, "snippet", "active").map(toItem);
      const byKey = new Map<string, VocabularyItem[]>();
      for (const item of dictionary) {
        const key = (item.payload as DictionaryPayload).term.toLowerCase();
        byKey.set(key, [...(byKey.get(key) ?? []), item]);
      }
      const spoken = new Map<string, VocabularyItem>();
      for (const item of dictionary) {
        const payload = item.payload as DictionaryPayload;
        spoken.set(payload.term.toLowerCase(), item);
        if (payload.replacement) spoken.set(payload.replacement.toLowerCase(), item);
      }
      return {
        terms: [...byKey.entries()]
          .filter(([, items]) => items.length > 1)
          .map(([term, items]) => ({
            term,
            entries: items.map((item) => ({
              id: item.id,
              scope: item.scope,
              departmentId: item.departmentId,
            })),
          })),
        snippetTriggers: snippets
          .map((snippet) => {
            const trigger = (snippet.payload as SnippetPayload).trigger.toLowerCase();
            const clash = spoken.get(trigger);
            return clash ? { trigger, snippetId: snippet.id, dictionaryId: clash.id } : null;
          })
          .filter(
            (entry): entry is { trigger: string; snippetId: string; dictionaryId: string } =>
              entry !== null,
          ),
      };
    },

    /**
     * Adds many dictionary entries from CSV (`term,replacement,scope`). Without `confirm` it only
     * reports: what would go in, each duplicate and each bad row. With it, the new rows go in
     * and the duplicates are skipped.
     */
    importCsv(who: Who, teamId: string, csv: string, confirm: boolean) {
      const rows = parseCsv(csv);
      if (rows.length > 0 && (rows[0]![0] ?? "").trim().toLowerCase() === "term") rows.shift();
      if (rows.length === 0) return fail(400, "empty_csv", "The file has no rows.");
      if (rows.length > LIMITS.importRows)
        return fail(400, "too_many_rows", `Import at most ${LIMITS.importRows} rows at a time.`);
      const settings = deps.settings.vocabulary(teamId);
      const departments = new Map(
        (
          db.prepare("SELECT id, name FROM departments WHERE team_id = ?").all(teamId) as {
            id: string;
            name: string;
          }[]
        ).map((d) => [d.name.toLowerCase(), d.id]),
      );

      const valid: {
        line: number;
        scope: Scope;
        departmentId: string | null;
        payload: Payload;
        key: string;
      }[] = [];
      const duplicates: {
        line: number;
        term: string;
        scope: string;
        reason: "in_file" | "exists";
      }[] = [];
      const errors: { line: number; message: string }[] = [];
      const inFile = new Set<string>();

      rows.forEach((cells, index) => {
        const line = index + 1;
        const scopeCell = (cells[2] ?? "").trim();
        let scope: Scope = "company";
        let departmentId: string | null = null;
        if (scopeCell !== "" && scopeCell.toLowerCase() !== "company") {
          const id = departments.get(scopeCell.toLowerCase());
          if (!id)
            return void errors.push({
              line,
              message: `There is no department called "${scopeCell}".`,
            });
          scope = "department";
          departmentId = id;
        }
        const checked = validate(
          "dictionary",
          { term: cells[0] ?? "", replacement: cells[1] ?? "" },
          settings,
        );
        if (!checked.ok) return void errors.push({ line, message: checked.message });
        const placeKey = `${scope}:${departmentId ?? ""}:${checked.key}`;
        const term = (checked.payload as DictionaryPayload).term;
        if (inFile.has(placeKey))
          return void duplicates.push({
            line,
            term,
            scope: scopeCell || "company",
            reason: "in_file",
          });
        inFile.add(placeKey);
        if (duplicate(teamId, "dictionary", scope, departmentId, checked.key, null))
          return void duplicates.push({
            line,
            term,
            scope: scopeCell || "company",
            reason: "exists",
          });
        valid.push({ line, scope, departmentId, payload: checked.payload, key: checked.key });
      });

      let imported = 0;
      if (confirm && valid.length > 0) {
        for (const entry of valid) {
          const id = randomUUID();
          const now = deps.now();
          const json = JSON.stringify(entry.payload);
          db.prepare(
            `INSERT INTO vocabulary_items
               (id, team_id, kind, scope, department_id, key, payload_json, status, proposed_by, approved_by, version, created_at, updated_at)
             VALUES (?, ?, 'dictionary', ?, ?, ?, ?, 'active', ?, ?, 1, ?, ?)`,
          ).run(
            id,
            teamId,
            entry.scope,
            entry.departmentId,
            entry.key,
            json,
            who.userId,
            who.userId,
            now,
            now,
          );
          history(id, 1, "created", json, "active", who.userId);
          imported++;
        }
        bump(teamId);
        log(who, "vocabulary.imported", teamId, {
          kind: "dictionary",
          imported,
          duplicates: duplicates.length,
          errors: errors.length,
        });
      }
      return {
        ok: true as const,
        confirmed: confirm,
        rows: rows.length,
        wouldImport: valid.map((entry) => ({
          line: entry.line,
          term: (entry.payload as DictionaryPayload).term,
          scope: entry.scope,
        })),
        duplicates,
        errors,
        imported,
      };
    },

    /** Removes versions older than each team's rollback time, always keeping the newest of an entry. */
    pruneHistory(): number {
      let removed = 0;
      const teams = db.prepare("SELECT id FROM teams").all() as { id: string }[];
      for (const team of teams) {
        const days = deps.settings.vocabulary(team.id).rollbackRetentionDays;
        const cutoff = deps.now() - days * DAY_MS;
        removed += Number(
          db
            .prepare(
              `DELETE FROM vocabulary_versions WHERE changed_at < ?
                 AND item_id IN (SELECT id FROM vocabulary_items WHERE team_id = ?)
                 AND id NOT IN (SELECT MAX(id) FROM vocabulary_versions GROUP BY item_id)`,
            )
            .run(cutoff, team.id).changes,
        );
      }
      return removed;
    },
  };
}

export type Vocabulary = ReturnType<typeof createVocabulary>;
