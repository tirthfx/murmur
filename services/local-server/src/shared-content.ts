import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { EffectivePolicy } from "../../../packages/shared/src/policy.ts";
import type { AuditDetail, AuditInput } from "./audit.ts";
import { fail, type Failure } from "./http.ts";
import type { Who } from "./teams.ts";

/**
 * What a team shares besides its dictionary and snippets: Skills the admins publish (NT-16) and
 * folders of shared meeting notes (NT-17). The server is the gate: a member reads a Skill and
 * duplicates it in the app but never edits the team's; a viewer reads folders and adds to none.
 *
 * Folders hold copies of notes a person chose to share, as text. Audio is never sent, and the
 * server has no field that could take it.
 */
export const SHARED_LIMITS = {
  name: 100,
  description: 500,
  skillBody: 20_000,
  folderName: 100,
  itemTitle: 200,
  // Under the server's 64 KB request limit: notes and summaries, not transcripts or audio.
  itemBody: 60_000,
  sourceRef: 200,
  members: 200,
} as const;

type Ok<T> = { ok: true } & T;

export interface SkillView {
  id: string;
  name: string;
  description: string;
  body: string;
  scope: "company" | "department";
  departmentId: string | null;
  version: number;
  updatedAt: number;
}

export interface FolderView {
  id: string;
  name: string;
  kind: "shared" | "department" | "company";
  departmentId: string | null;
  createdBy: string | null;
  mine: boolean;
  canWrite: boolean;
  canManage: boolean;
  members: { userId: string; name: string; canWrite: boolean }[];
  items: { id: string; title: string; sharedBy: string; sharedAt: number; sourceRef: string }[];
}

interface SkillRow {
  id: string;
  team_id: string;
  name: string;
  description: string;
  body: string;
  scope: "company" | "department";
  department_id: string | null;
  version: number;
  status: string;
  updated_at: number;
}

interface FolderRow {
  id: string;
  team_id: string;
  name: string;
  kind: "shared" | "department" | "company";
  department_id: string | null;
  status: string;
  created_by: string | null;
}

export interface SharedContentDeps {
  db: DatabaseSync;
  now(): number;
  audit(input: AuditInput): void;
  /** What the policy says for a person; a team that turns Notetaker off cannot publish for it. */
  effectivePolicy(
    who: Pick<Who, "userId" | "departmentId">,
    teamId: string,
  ): { policy: EffectivePolicy };
}

const isAdmin = (who: Who) => who.isServerOwner || who.role === "owner" || who.role === "admin";

const clean = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() !== "" && value.trim().length <= max
    ? value.trim()
    : null;

export function createSharedContent(deps: SharedContentDeps) {
  const { db } = deps;

  const bump = (teamId: string) =>
    db
      .prepare(
        `INSERT INTO team_revisions (team_id, revision, content_revision) VALUES (?, 0, 1)
         ON CONFLICT (team_id) DO UPDATE SET content_revision = content_revision + 1`,
      )
      .run(teamId);

  const revision = (teamId: string): number =>
    (
      db.prepare("SELECT content_revision FROM team_revisions WHERE team_id = ?").get(teamId) as
        { content_revision: number } | undefined
    )?.content_revision ?? 0;

  const log = (who: Who, action: string, id: string, detail: AuditDetail = {}) =>
    deps.audit({ actorId: who.userId, action, targetType: "shared_content", targetId: id, detail });

  // ---- Skills ----

  const skillRow = (id: string, teamId: string) =>
    db
      .prepare("SELECT * FROM team_skills WHERE id = ? AND team_id = ? AND status = 'active'")
      .get(id, teamId) as unknown as SkillRow | undefined;

  const toSkill = (r: SkillRow): SkillView => ({
    id: r.id,
    name: r.name,
    description: r.description,
    body: r.body,
    scope: r.scope,
    departmentId: r.department_id,
    version: r.version,
    updatedAt: r.updated_at,
  });

  const skillVisible = (who: Who, r: SkillRow) =>
    isAdmin(who) || r.scope === "company" || r.department_id === who.departmentId;

  /** Admins publish anywhere; a manager only to their own department. */
  const mayPublish = (who: Who, scope: string, departmentId: string | null) =>
    isAdmin(who) ||
    (who.role === "manager" && scope === "department" && departmentId === who.departmentId);

  function checkSkill(
    input: Record<string, unknown>,
  ): Ok<{ name: string; description: string; body: string }> | Failure {
    const name = clean(input["name"], SHARED_LIMITS.name);
    if (!name) return fail(400, "invalid_name", "A Skill has a name of 1 to 100 characters.");
    const description =
      input["description"] === undefined || input["description"] === ""
        ? ""
        : clean(input["description"], SHARED_LIMITS.description);
    if (description === null)
      return fail(400, "invalid_description", "That description is too long.");
    const body = typeof input["body"] === "string" ? input["body"] : "";
    if (body.trim() === "") return fail(400, "invalid_body", "A Skill needs its prompt.");
    if (Buffer.byteLength(body) > SHARED_LIMITS.skillBody)
      return fail(400, "invalid_body", "That Skill is too long.");
    return { ok: true, name, description, body };
  }

  function duplicateSkill(
    teamId: string,
    scope: string,
    departmentId: string | null,
    name: string,
    exceptId: string,
  ): boolean {
    return (
      db
        .prepare(
          `SELECT 1 FROM team_skills WHERE team_id = ? AND scope = ? AND COALESCE(department_id, '') = ?
             AND lower(name) = lower(?) AND status = 'active' AND id != ?`,
        )
        .get(teamId, scope, departmentId ?? "", name, exceptId) !== undefined
    );
  }

  // ---- Folders ----

  const folderRow = (id: string, teamId: string) =>
    db
      .prepare("SELECT * FROM shared_folders WHERE id = ? AND team_id = ? AND status = 'active'")
      .get(id, teamId) as unknown as FolderRow | undefined;

  const memberRow = (folderId: string, userId: string) =>
    db
      .prepare("SELECT can_write FROM folder_members WHERE folder_id = ? AND user_id = ?")
      .get(folderId, userId) as { can_write: number } | undefined;

  const folderVisible = (who: Who, f: FolderRow): boolean =>
    isAdmin(who) ||
    f.kind === "company" ||
    (f.kind === "department" && f.department_id === who.departmentId) ||
    (f.kind === "shared" && memberRow(f.id, who.userId) !== undefined);

  const folderWritable = (who: Who, f: FolderRow): boolean => {
    if (who.role === "viewer" || !folderVisible(who, f)) return false;
    if (f.kind !== "shared") return true;
    return isAdmin(who) || memberRow(f.id, who.userId)?.can_write === 1;
  };

  const folderManageable = (who: Who, f: FolderRow): boolean =>
    isAdmin(who) ||
    f.created_by === who.userId ||
    (f.kind === "department" && who.role === "manager" && f.department_id === who.departmentId);

  const isTeamMember = (teamId: string, userId: string): boolean =>
    db
      .prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?")
      .get(teamId, userId) !== undefined;

  function toFolder(who: Who, f: FolderRow): FolderView {
    const members = db
      .prepare(
        `SELECT m.user_id, m.can_write, u.name FROM folder_members m JOIN users u ON u.id = m.user_id
         WHERE m.folder_id = ? ORDER BY u.name`,
      )
      .all(f.id) as { user_id: string; can_write: number; name: string }[];
    const items = db
      .prepare(
        `SELECT i.id, i.title, i.source_ref, i.shared_at, COALESCE(u.name, '') AS who
         FROM folder_items i LEFT JOIN users u ON u.id = i.shared_by
         WHERE i.folder_id = ? ORDER BY i.shared_at DESC, i.id`,
      )
      .all(f.id) as {
      id: string;
      title: string;
      source_ref: string;
      shared_at: number;
      who: string;
    }[];
    return {
      id: f.id,
      name: f.name,
      kind: f.kind,
      departmentId: f.department_id,
      createdBy: f.created_by,
      mine: f.created_by === who.userId,
      canWrite: folderWritable(who, f),
      canManage: folderManageable(who, f),
      members: members.map((m) => ({
        userId: m.user_id,
        name: m.name,
        canWrite: m.can_write === 1,
      })),
      items: items.map((i) => ({
        id: i.id,
        title: i.title,
        sharedBy: i.who,
        sharedAt: i.shared_at,
        sourceRef: i.source_ref,
      })),
    };
  }

  return {
    revision,

    /** What a client keeps in step with: the Skills and folders this person can see. */
    content(who: Who, teamId: string, since?: number) {
      const rev = revision(teamId);
      if (since !== undefined && since === rev) return { revision: rev, unchanged: true as const };
      return {
        revision: rev,
        unchanged: false as const,
        skills: this.listSkills(who, teamId),
        folders: this.listFolders(who, teamId),
      };
    },

    // ---- Skills ----

    listSkills(who: Who, teamId: string): SkillView[] {
      return (
        db
          .prepare(
            "SELECT * FROM team_skills WHERE team_id = ? AND status = 'active' ORDER BY lower(name), id",
          )
          .all(teamId) as unknown as SkillRow[]
      )
        .filter((r) => skillVisible(who, r))
        .map(toSkill);
    },

    createSkill(
      who: Who,
      teamId: string,
      input: Record<string, unknown>,
    ): Ok<{ skill: SkillView }> | Failure {
      const scope = input["scope"] === "department" ? "department" : "company";
      if (
        input["scope"] !== undefined &&
        input["scope"] !== "company" &&
        input["scope"] !== "department"
      )
        return fail(400, "invalid_scope", "The scope is company or department.");
      const departmentId =
        scope === "department"
          ? typeof input["departmentId"] === "string"
            ? input["departmentId"]
            : who.departmentId
          : null;
      if (scope === "department" && departmentId === null)
        return fail(400, "no_department", "Choose a department, or publish to the whole team.");
      if (departmentId !== null) {
        const dept = db
          .prepare("SELECT team_id FROM departments WHERE id = ?")
          .get(departmentId) as { team_id: string } | undefined;
        if (!dept || dept.team_id !== teamId)
          return fail(400, "invalid_department", "That department is not in this team.");
      }
      if (!mayPublish(who, scope, departmentId))
        return fail(403, "forbidden", "You can publish only to your own department.");
      const checked = checkSkill(input);
      if (!checked.ok) return checked;
      if (deps.effectivePolicy(who, teamId).policy.features["notetaker"] === false)
        return fail(
          403,
          "blocked_by_policy",
          "This team's policy turns Notetaker off, so a Skill cannot be published.",
        );
      if (duplicateSkill(teamId, scope, departmentId, checked.name, ""))
        return fail(409, "duplicate", "A Skill with that name is already published here.");
      const id = randomUUID();
      const now = deps.now();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          `INSERT INTO team_skills (id, team_id, name, description, body, scope, department_id, version, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        ).run(
          id,
          teamId,
          checked.name,
          checked.description,
          checked.body,
          scope,
          departmentId,
          who.userId,
          now,
          now,
        );
        db.prepare(
          "INSERT INTO team_skill_versions (skill_id, version, name, body, changed_by, changed_at) VALUES (?, 1, ?, ?, ?, ?)",
        ).run(id, checked.name, checked.body, who.userId, now);
        bump(teamId);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      log(who, "skill.published", id, { scope, version: 1 });
      return { ok: true, skill: toSkill(skillRow(id, teamId)!) };
    },

    /** A changed Skill is a new version; members see the version number go up. */
    updateSkill(
      who: Who,
      teamId: string,
      id: string,
      input: Record<string, unknown>,
    ): Ok<{ skill: SkillView; changed: boolean }> | Failure {
      const r = skillRow(id, teamId);
      if (!r || !skillVisible(who, r)) return fail(404, "not_found", "There is no such Skill.");
      if (!mayPublish(who, r.scope, r.department_id))
        return fail(
          403,
          "forbidden",
          "Only an admin, or the department's manager, changes this Skill.",
        );
      const checked = checkSkill({
        name: input["name"] ?? r.name,
        description: input["description"] ?? r.description,
        body: input["body"] ?? r.body,
      });
      if (!checked.ok) return checked;
      if (
        checked.name === r.name &&
        checked.description === r.description &&
        checked.body === r.body
      )
        return { ok: true, skill: toSkill(r), changed: false };
      if (duplicateSkill(teamId, r.scope, r.department_id, checked.name, id))
        return fail(409, "duplicate", "A Skill with that name is already published here.");
      const version = r.version + 1;
      const now = deps.now();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          "UPDATE team_skills SET name = ?, description = ?, body = ?, version = ?, updated_at = ? WHERE id = ?",
        ).run(checked.name, checked.description, checked.body, version, now, id);
        db.prepare(
          "INSERT INTO team_skill_versions (skill_id, version, name, body, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, version, checked.name, checked.body, who.userId, now);
        bump(teamId);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      log(who, "skill.updated", id, { scope: r.scope, version });
      return { ok: true, skill: toSkill(skillRow(id, teamId)!), changed: true };
    },

    removeSkill(who: Who, teamId: string, id: string): Ok<object> | Failure {
      const r = skillRow(id, teamId);
      if (!r || !skillVisible(who, r)) return fail(404, "not_found", "There is no such Skill.");
      if (!mayPublish(who, r.scope, r.department_id))
        return fail(
          403,
          "forbidden",
          "Only an admin, or the department's manager, removes this Skill.",
        );
      db.prepare("UPDATE team_skills SET status = 'deleted', updated_at = ? WHERE id = ?").run(
        deps.now(),
        id,
      );
      bump(teamId);
      log(who, "skill.removed", id, { scope: r.scope });
      return { ok: true };
    },

    skillVersions(who: Who, teamId: string, id: string) {
      const r = skillRow(id, teamId);
      if (!r || !skillVisible(who, r)) return fail(404, "not_found", "There is no such Skill.");
      const rows = db
        .prepare(
          `SELECT v.version, v.name, v.body, v.changed_at, COALESCE(u.name, '') AS who
           FROM team_skill_versions v LEFT JOIN users u ON u.id = v.changed_by
           WHERE v.skill_id = ? ORDER BY v.version DESC`,
        )
        .all(id) as {
        version: number;
        name: string;
        body: string;
        changed_at: number;
        who: string;
      }[];
      return {
        ok: true as const,
        versions: rows.map((v) => ({
          version: v.version,
          name: v.name,
          body: v.body,
          changedAt: v.changed_at,
          changedBy: v.who,
        })),
      };
    },

    // ---- folders ----

    listFolders(who: Who, teamId: string): FolderView[] {
      return (
        db
          .prepare(
            "SELECT * FROM shared_folders WHERE team_id = ? AND status = 'active' ORDER BY lower(name), id",
          )
          .all(teamId) as unknown as FolderRow[]
      )
        .filter((f) => folderVisible(who, f))
        .map((f) => toFolder(who, f));
    },

    createFolder(
      who: Who,
      teamId: string,
      input: Record<string, unknown>,
    ): Ok<{ folder: FolderView }> | Failure {
      const kind = input["kind"];
      if (kind !== "shared" && kind !== "department" && kind !== "company")
        return fail(400, "invalid_kind", "A folder is shared, department or company.");
      const name = clean(input["name"], SHARED_LIMITS.folderName);
      if (!name) return fail(400, "invalid_name", "A folder has a name of 1 to 100 characters.");
      let departmentId: string | null = null;
      if (kind === "department") {
        departmentId =
          typeof input["departmentId"] === "string" ? input["departmentId"] : who.departmentId;
        if (departmentId === null)
          return fail(400, "no_department", "Choose the department the folder is for.");
        const dept = db
          .prepare("SELECT team_id FROM departments WHERE id = ?")
          .get(departmentId) as { team_id: string } | undefined;
        if (!dept || dept.team_id !== teamId)
          return fail(400, "invalid_department", "That department is not in this team.");
        if (!isAdmin(who) && !(who.role === "manager" && departmentId === who.departmentId))
          return fail(
            403,
            "forbidden",
            "Only an admin, or the department's manager, makes a department folder.",
          );
      }
      if (kind === "company" && !isAdmin(who))
        return fail(403, "forbidden", "Only an admin makes a folder for the whole company.");
      const people = Array.isArray(input["members"]) ? (input["members"] as unknown[]) : [];
      if (kind !== "shared" && people.length > 0)
        return fail(400, "invalid_members", "Only a shared folder has named people.");
      if (people.length > SHARED_LIMITS.members)
        return fail(
          400,
          "invalid_members",
          `A folder has at most ${SHARED_LIMITS.members} people.`,
        );
      for (const person of people)
        if (typeof person !== "string" || !isTeamMember(teamId, person))
          return fail(400, "invalid_members", "Everyone in a folder must be in this team.");
      const taken = db
        .prepare(
          "SELECT 1 FROM shared_folders WHERE team_id = ? AND kind = ? AND COALESCE(department_id, '') = ? AND lower(name) = lower(?) AND status = 'active'",
        )
        .get(teamId, kind, departmentId ?? "", name);
      if (taken) return fail(409, "duplicate", "A folder with that name is already there.");
      const id = randomUUID();
      const now = deps.now();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          "INSERT INTO shared_folders (id, team_id, name, kind, department_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(id, teamId, name, kind, departmentId, who.userId, now);
        if (kind === "shared") {
          const add = db.prepare(
            "INSERT OR IGNORE INTO folder_members (folder_id, user_id, can_write, added_by, added_at) VALUES (?, ?, 1, ?, ?)",
          );
          for (const person of new Set([who.userId, ...(people as string[])]))
            add.run(id, person, who.userId, now);
        }
        bump(teamId);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      log(who, "folder.created", id, { kind });
      return { ok: true, folder: toFolder(who, folderRow(id, teamId)!) };
    },

    renameFolder(
      who: Who,
      teamId: string,
      id: string,
      input: Record<string, unknown>,
    ): Ok<{ folder: FolderView }> | Failure {
      const f = folderRow(id, teamId);
      if (!f || !folderVisible(who, f)) return fail(404, "not_found", "There is no such folder.");
      if (!folderManageable(who, f))
        return fail(403, "forbidden", "You cannot change this folder.");
      const name = clean(input["name"], SHARED_LIMITS.folderName);
      if (!name) return fail(400, "invalid_name", "A folder has a name of 1 to 100 characters.");
      db.prepare("UPDATE shared_folders SET name = ? WHERE id = ?").run(name, id);
      bump(teamId);
      log(who, "folder.renamed", id, { kind: f.kind });
      return { ok: true, folder: toFolder(who, folderRow(id, teamId)!) };
    },

    /** The notes in it are removed with it: they were copies. */
    removeFolder(who: Who, teamId: string, id: string): Ok<object> | Failure {
      const f = folderRow(id, teamId);
      if (!f || !folderVisible(who, f)) return fail(404, "not_found", "There is no such folder.");
      if (!folderManageable(who, f))
        return fail(403, "forbidden", "You cannot remove this folder.");
      db.prepare("UPDATE shared_folders SET status = 'deleted' WHERE id = ?").run(id);
      db.prepare("DELETE FROM folder_items WHERE folder_id = ?").run(id);
      bump(teamId);
      log(who, "folder.removed", id, { kind: f.kind });
      return { ok: true };
    },

    setMember(
      who: Who,
      teamId: string,
      id: string,
      userId: string,
      canWrite: boolean,
    ): Ok<{ folder: FolderView }> | Failure {
      const f = folderRow(id, teamId);
      if (!f || !folderVisible(who, f)) return fail(404, "not_found", "There is no such folder.");
      if (f.kind !== "shared")
        return fail(
          400,
          "invalid_members",
          "A department or company folder follows the team; it has no named people.",
        );
      if (!folderManageable(who, f))
        return fail(403, "forbidden", "You cannot change who is in this folder.");
      if (!isTeamMember(teamId, userId))
        return fail(400, "invalid_members", "That person is not in this team.");
      const count = (
        db.prepare("SELECT COUNT(*) AS n FROM folder_members WHERE folder_id = ?").get(id) as {
          n: number;
        }
      ).n;
      if (!memberRow(id, userId) && count >= SHARED_LIMITS.members)
        return fail(
          400,
          "invalid_members",
          `A folder has at most ${SHARED_LIMITS.members} people.`,
        );
      db.prepare(
        `INSERT INTO folder_members (folder_id, user_id, can_write, added_by, added_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (folder_id, user_id) DO UPDATE SET can_write = excluded.can_write`,
      ).run(id, userId, canWrite ? 1 : 0, who.userId, deps.now());
      bump(teamId);
      log(who, "folder.member_set", id, { canWrite });
      return { ok: true, folder: toFolder(who, folderRow(id, teamId)!) };
    },

    removeMember(who: Who, teamId: string, id: string, userId: string): Ok<object> | Failure {
      const f = folderRow(id, teamId);
      if (!f || !folderVisible(who, f)) return fail(404, "not_found", "There is no such folder.");
      // A person may leave; managing is for those who can.
      if (!folderManageable(who, f) && userId !== who.userId)
        return fail(403, "forbidden", "You cannot change who is in this folder.");
      if (!memberRow(id, userId))
        return fail(404, "not_found", "That person is not in this folder.");
      db.prepare("DELETE FROM folder_members WHERE folder_id = ? AND user_id = ?").run(id, userId);
      bump(teamId);
      log(who, "folder.member_removed", id, {});
      return { ok: true };
    },

    shareItem(
      who: Who,
      teamId: string,
      id: string,
      input: Record<string, unknown>,
    ): Ok<{ id: string }> | Failure {
      const f = folderRow(id, teamId);
      if (!f || !folderVisible(who, f)) return fail(404, "not_found", "There is no such folder.");
      if (!folderWritable(who, f)) return fail(403, "forbidden", "You cannot add to this folder.");
      const title = clean(input["title"], SHARED_LIMITS.itemTitle);
      if (!title)
        return fail(400, "invalid_title", "A shared note has a title of 1 to 200 characters.");
      const body = typeof input["body"] === "string" ? input["body"] : "";
      if (body.trim() === "") return fail(400, "invalid_body", "There is nothing to share.");
      if (Buffer.byteLength(body) > SHARED_LIMITS.itemBody)
        return fail(400, "invalid_body", "That is too long to share (60 KB at most).");
      const ref =
        typeof input["sourceRef"] === "string"
          ? input["sourceRef"].slice(0, SHARED_LIMITS.sourceRef)
          : "";
      const itemId = randomUUID();
      db.prepare(
        "INSERT INTO folder_items (id, folder_id, title, body_md, source_ref, shared_by, shared_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(itemId, id, title, body, ref, who.userId, deps.now());
      bump(teamId);
      log(who, "folder.item_shared", itemId, { kind: f.kind });
      return { ok: true, id: itemId };
    },

    readItem(who: Who, teamId: string, id: string, itemId: string) {
      const f = folderRow(id, teamId);
      if (!f || !folderVisible(who, f)) return fail(404, "not_found", "There is no such folder.");
      const row = db
        .prepare(
          `SELECT i.id, i.title, i.body_md, i.source_ref, i.shared_at, COALESCE(u.name, '') AS who
           FROM folder_items i LEFT JOIN users u ON u.id = i.shared_by WHERE i.id = ? AND i.folder_id = ?`,
        )
        .get(itemId, id) as
        | {
            id: string;
            title: string;
            body_md: string;
            source_ref: string;
            shared_at: number;
            who: string;
          }
        | undefined;
      if (!row) return fail(404, "not_found", "There is no such note in this folder.");
      return {
        ok: true as const,
        item: {
          id: row.id,
          title: row.title,
          body: row.body_md,
          sourceRef: row.source_ref,
          sharedBy: row.who,
          sharedAt: row.shared_at,
        },
      };
    },

    removeItem(who: Who, teamId: string, id: string, itemId: string): Ok<object> | Failure {
      const f = folderRow(id, teamId);
      if (!f || !folderVisible(who, f)) return fail(404, "not_found", "There is no such folder.");
      const row = db
        .prepare("SELECT shared_by FROM folder_items WHERE id = ? AND folder_id = ?")
        .get(itemId, id) as { shared_by: string | null } | undefined;
      if (!row) return fail(404, "not_found", "There is no such note in this folder.");
      if (row.shared_by !== who.userId && !folderManageable(who, f))
        return fail(
          403,
          "forbidden",
          "Only the person who shared it, or the folder's managers, remove a note.",
        );
      db.prepare("DELETE FROM folder_items WHERE id = ?").run(itemId);
      bump(teamId);
      log(who, "folder.item_removed", itemId, { kind: f.kind });
      return { ok: true };
    },
  };
}

export type SharedContent = ReturnType<typeof createSharedContent>;
