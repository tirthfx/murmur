import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { UserView } from "./accounts.ts";
import type { AuditInput } from "./audit.ts";
import { fail, type Failure } from "./http.ts";
import { RANK, grantableRoles, isRole, type Role } from "./permissions.ts";

export interface TeamView {
  id: string;
  name: string;
  createdAt: number;
  /** The caller's role in it. */
  myRole: Role;
  memberCount: number;
}

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  role: Role;
  departmentId: string | null;
  joinedAt: number;
}

export interface DepartmentView {
  id: string;
  teamId: string;
  name: string;
  costCenter: string;
  parentId: string | null;
}

/** Who is asking, and the role they hold in the team the request is about. */
export interface Actor {
  id: string;
  isOwner: boolean;
  role: Role | null;
}

export interface TeamsDeps {
  db: DatabaseSync;
  now(): number;
  audit(input: AuditInput): void;
}

const NAME_MAX = 100;
const COST_CENTER_MAX = 50;

type Ok<T> = { ok: true } & T;

export function createTeams(deps: TeamsDeps) {
  const { db } = deps;
  const log = (actor: Actor | string | null, input: Omit<AuditInput, "actorId">) =>
    deps.audit({
      ...input,
      actorId: typeof actor === "string" || actor === null ? actor : actor.id,
    });

  const teamRow = (id: string) =>
    db.prepare("SELECT * FROM teams WHERE id = ?").get(id) as
      { id: string; name: string; created_by: string; created_at: number } | undefined;
  const memberRow = (teamId: string, userId: string) =>
    db
      .prepare("SELECT * FROM team_members WHERE team_id = ? AND user_id = ?")
      .get(teamId, userId) as
      { role: Role; department_id: string | null; joined_at: number } | undefined;
  const departmentRow = (id: string) =>
    db.prepare("SELECT * FROM departments WHERE id = ?").get(id) as
      | { id: string; team_id: string; name: string; cost_center: string; parent_id: string | null }
      | undefined;

  const cleanName = (value: string, label: string): string | Failure => {
    const name = value.trim().replace(/\s+/g, " ");
    return name === "" || name.length > NAME_MAX
      ? fail(400, "invalid_name", `Write a ${label} of up to ${NAME_MAX} characters.`)
      : name;
  };

  const departmentView = (row: NonNullable<ReturnType<typeof departmentRow>>): DepartmentView => ({
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    costCenter: row.cost_center,
    parentId: row.parent_id,
  });

  /** The role a person holds in a team; the server owner is owner everywhere. */
  function roleOf(user: Pick<UserView, "id" | "isOwner">, teamId: string): Role | null {
    if (user.isOwner) return teamRow(teamId) ? "owner" : null;
    return memberRow(teamId, user.id)?.role ?? null;
  }

  const actorFor = (user: UserView, teamId: string): Actor => ({
    id: user.id,
    isOwner: user.isOwner,
    role: roleOf(user, teamId),
  });

  /** Whether the actor may give a role to someone, or change one that is already theirs. */
  const outranks = (actor: Actor, role: Role): boolean =>
    actor.isOwner || (actor.role !== null && RANK[actor.role] > RANK[role]);

  return {
    roleOf,
    actorFor,
    outranks,
    member: (teamId: string, userId: string) => memberRow(teamId, userId) ?? null,
    exists: (teamId: string) => teamRow(teamId) !== undefined,

    /** The teams a person is in; the server owner sees them all. */
    list(user: UserView): TeamView[] {
      const rows = db
        .prepare(
          `SELECT t.id, t.name, t.created_at,
                  (SELECT COUNT(*) FROM team_members m WHERE m.team_id = t.id) AS members
           FROM teams t ORDER BY t.created_at, t.name`,
        )
        .all() as { id: string; name: string; created_at: number; members: number }[];
      const views: TeamView[] = [];
      for (const row of rows) {
        const role = roleOf(user, row.id);
        if (role)
          views.push({
            id: row.id,
            name: row.name,
            createdAt: row.created_at,
            myRole: role,
            memberCount: row.members,
          });
      }
      return views;
    },

    get(user: UserView, teamId: string): Ok<{ team: TeamView }> | Failure {
      const found = this.list(user).find((team) => team.id === teamId);
      return found ? { ok: true, team: found } : fail(404, "not_found", "There is no such team.");
    },

    create(user: UserView, nameInput: string): Ok<{ team: TeamView }> | Failure {
      const name = cleanName(nameInput, "team name");
      if (typeof name !== "string") return name;
      const id = randomUUID();
      const now = deps.now();
      db.prepare(
        "INSERT INTO teams (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, name, user.id, now, now);
      // The person who makes a team is its owner.
      db.prepare(
        "INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
      ).run(id, user.id, now);
      log(user.id, { action: "team.created", targetType: "team", targetId: id, detail: { name } });
      return { ok: true, team: { id, name, createdAt: now, myRole: "owner", memberCount: 1 } };
    },

    rename(actor: Actor, teamId: string, nameInput: string): Ok<object> | Failure {
      if (!teamRow(teamId)) return fail(404, "not_found", "There is no such team.");
      const name = cleanName(nameInput, "team name");
      if (typeof name !== "string") return name;
      const before = teamRow(teamId)!.name;
      db.prepare("UPDATE teams SET name = ?, updated_at = ? WHERE id = ?").run(
        name,
        deps.now(),
        teamId,
      );
      log(actor, {
        action: "team.renamed",
        targetType: "team",
        targetId: teamId,
        detail: { from: before, to: name },
      });
      return { ok: true };
    },

    remove(actor: Actor, teamId: string): Ok<object> | Failure {
      const team = teamRow(teamId);
      if (!team) return fail(404, "not_found", "There is no such team.");
      db.prepare("DELETE FROM teams WHERE id = ?").run(teamId);
      log(actor, {
        action: "team.deleted",
        targetType: "team",
        targetId: teamId,
        detail: { name: team.name },
      });
      return { ok: true };
    },

    // ---- members ----

    members(teamId: string): MemberView[] {
      return (
        db
          .prepare(
            `SELECT m.user_id, m.role, m.department_id, m.joined_at, u.name, u.email
             FROM team_members m JOIN users u ON u.id = m.user_id
             WHERE m.team_id = ? ORDER BY m.joined_at, u.email`,
          )
          .all(teamId) as {
          user_id: string;
          role: Role;
          department_id: string | null;
          joined_at: number;
          name: string;
          email: string;
        }[]
      ).map((row) => ({
        userId: row.user_id,
        name: row.name,
        email: row.email,
        role: row.role,
        departmentId: row.department_id,
        joinedAt: row.joined_at,
      }));
    },

    /** Adds a person to a team (an invite or an approved request calls this). */
    addMember(
      teamId: string,
      userId: string,
      role: Role,
      departmentId: string | null,
      by: { actorId: string | null; via: string },
    ): void {
      const dept =
        departmentId && departmentRow(departmentId)?.team_id === teamId ? departmentId : null;
      db.prepare(
        "INSERT INTO team_members (team_id, user_id, role, department_id, joined_at) VALUES (?, ?, ?, ?, ?)",
      ).run(teamId, userId, role, dept, deps.now());
      log(by.actorId ?? userId, {
        action: "member.joined",
        targetType: "team",
        targetId: teamId,
        detail: { userId, role, via: by.via },
      });
    },

    change(
      actor: Actor,
      teamId: string,
      userId: string,
      patch: { role?: string; departmentId?: string | null },
    ): Ok<{ member: MemberView }> | Failure {
      const target = memberRow(teamId, userId);
      if (!target) return fail(404, "not_found", "That person is not in the team.");
      if (userId === actor.id)
        return fail(403, "forbidden", "You cannot change your own role or department.");
      if (target.role === "owner")
        return fail(403, "forbidden", "The owner of a team cannot be changed.");
      if (!outranks(actor, target.role))
        return fail(403, "forbidden", "You can only change people whose role is below yours.");

      if (patch.role !== undefined) {
        if (!isRole(patch.role) || patch.role === "owner")
          return fail(400, "invalid_role", "A role is admin, manager, member or viewer.");
        const allowed = actor.isOwner
          ? grantableRoles("owner")
          : grantableRoles(actor.role ?? "viewer");
        if (!allowed.includes(patch.role))
          return fail(403, "forbidden", "You can only give a role below your own.");
        if (patch.role !== target.role) {
          db.prepare("UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?").run(
            patch.role,
            teamId,
            userId,
          );
          log(actor, {
            action: "member.role_changed",
            targetType: "team_member",
            targetId: `${teamId}:${userId}`,
            detail: { from: target.role, to: patch.role },
          });
        }
      }
      if (patch.departmentId !== undefined) {
        if (patch.departmentId !== null && departmentRow(patch.departmentId)?.team_id !== teamId)
          return fail(400, "invalid_department", "That department is not in this team.");
        if (patch.departmentId !== target.department_id) {
          db.prepare(
            "UPDATE team_members SET department_id = ? WHERE team_id = ? AND user_id = ?",
          ).run(patch.departmentId, teamId, userId);
          log(actor, {
            action: "member.department_changed",
            targetType: "team_member",
            targetId: `${teamId}:${userId}`,
            detail: { from: target.department_id, to: patch.departmentId },
          });
        }
      }
      const member = this.members(teamId).find((entry) => entry.userId === userId)!;
      return { ok: true, member };
    },

    /** Takes a person out of a team: an admin removes someone below them, or they leave. */
    removeMember(actor: Actor, teamId: string, userId: string): Ok<object> | Failure {
      const target = memberRow(teamId, userId);
      if (!target) return fail(404, "not_found", "That person is not in the team.");
      if (target.role === "owner")
        return fail(
          403,
          "forbidden",
          "The owner of a team cannot leave it. Delete the team instead.",
        );
      const self = userId === actor.id;
      if (!self && !outranks(actor, target.role))
        return fail(403, "forbidden", "You can only remove people whose role is below yours.");
      db.prepare("DELETE FROM team_members WHERE team_id = ? AND user_id = ?").run(teamId, userId);
      log(actor, {
        action: self ? "member.left" : "member.removed",
        targetType: "team_member",
        targetId: `${teamId}:${userId}`,
        detail: { role: target.role },
      });
      return { ok: true };
    },

    // ---- departments ----

    departments(teamId: string): DepartmentView[] {
      return (
        db
          .prepare("SELECT * FROM departments WHERE team_id = ? ORDER BY name")
          .all(teamId) as unknown as NonNullable<ReturnType<typeof departmentRow>>[]
      ).map(departmentView);
    },

    department: (id: string) => {
      const row = departmentRow(id);
      return row ? departmentView(row) : null;
    },

    createDepartment(
      actor: Actor,
      teamId: string,
      input: { name: string; costCenter?: string; parentId?: string | null },
    ): Ok<{ department: DepartmentView }> | Failure {
      if (!teamRow(teamId)) return fail(404, "not_found", "There is no such team.");
      const name = cleanName(input.name, "department name");
      if (typeof name !== "string") return name;
      const costCenter = (input.costCenter ?? "").trim();
      if (costCenter.length > COST_CENTER_MAX)
        return fail(
          400,
          "invalid_cost_center",
          `A cost center has at most ${COST_CENTER_MAX} characters.`,
        );
      const parent = this.checkParent(teamId, input.parentId ?? null, null);
      if (parent !== null) return parent;
      const taken = db
        .prepare("SELECT 1 FROM departments WHERE team_id = ? AND name = ?")
        .get(teamId, name);
      if (taken) return fail(409, "name_taken", "A department with that name already exists.");
      const id = randomUUID();
      db.prepare(
        "INSERT INTO departments (id, team_id, name, cost_center, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, teamId, name, costCenter, input.parentId ?? null, deps.now());
      log(actor, {
        action: "department.created",
        targetType: "department",
        targetId: id,
        detail: { name, costCenter },
      });
      return { ok: true, department: this.department(id)! };
    },

    /** One level only: a parent must be in the team, have no parent itself, and not be the department. */
    checkParent(teamId: string, parentId: string | null, selfId: string | null): Failure | null {
      if (parentId === null) return null;
      const parent = departmentRow(parentId);
      if (!parent || parent.team_id !== teamId)
        return fail(400, "invalid_parent", "That parent department is not in this team.");
      if (parent.parent_id !== null || parentId === selfId)
        return fail(400, "invalid_parent", "Departments go one level deep.");
      if (selfId && db.prepare("SELECT 1 FROM departments WHERE parent_id = ?").get(selfId))
        return fail(
          400,
          "invalid_parent",
          "A department with sub-departments cannot have a parent.",
        );
      return null;
    },

    updateDepartment(
      actor: Actor,
      teamId: string,
      id: string,
      patch: { name?: string; costCenter?: string; parentId?: string | null },
    ): Ok<{ department: DepartmentView }> | Failure {
      const current = departmentRow(id);
      if (!current || current.team_id !== teamId)
        return fail(404, "not_found", "There is no such department.");
      let name = current.name;
      if (patch.name !== undefined) {
        const cleaned = cleanName(patch.name, "department name");
        if (typeof cleaned !== "string") return cleaned;
        name = cleaned;
        const clash = db
          .prepare("SELECT 1 FROM departments WHERE team_id = ? AND name = ? AND id != ?")
          .get(teamId, name, id);
        if (clash) return fail(409, "name_taken", "A department with that name already exists.");
      }
      const costCenter =
        patch.costCenter !== undefined ? patch.costCenter.trim() : current.cost_center;
      if (costCenter.length > COST_CENTER_MAX)
        return fail(
          400,
          "invalid_cost_center",
          `A cost center has at most ${COST_CENTER_MAX} characters.`,
        );
      const parentId = patch.parentId !== undefined ? patch.parentId : current.parent_id;
      const parent = this.checkParent(teamId, parentId, id);
      if (parent !== null) return parent;
      db.prepare(
        "UPDATE departments SET name = ?, cost_center = ?, parent_id = ? WHERE id = ?",
      ).run(name, costCenter, parentId, id);
      log(actor, {
        action: "department.updated",
        targetType: "department",
        targetId: id,
        detail: { name, costCenter },
      });
      return { ok: true, department: this.department(id)! };
    },

    removeDepartment(actor: Actor, teamId: string, id: string): Ok<object> | Failure {
      const current = departmentRow(id);
      if (!current || current.team_id !== teamId)
        return fail(404, "not_found", "There is no such department.");
      db.prepare("DELETE FROM departments WHERE id = ?").run(id);
      log(actor, {
        action: "department.deleted",
        targetType: "department",
        targetId: id,
        detail: { name: current.name },
      });
      return { ok: true };
    },
  };
}

export type Teams = ReturnType<typeof createTeams>;
