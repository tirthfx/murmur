import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Accounts, NewAccount, SessionGrant, UserView } from "./accounts.ts";
import type { AuditInput } from "./audit.ts";
import { fail, type Failure } from "./http.ts";
import { grantableRoles, isRole, type Role } from "./permissions.ts";
import type { Settings } from "./settings.ts";
import type { Actor, Teams } from "./teams.ts";

/** TM-03: invite defaults, kept as settings so the admin console can change them. */
export const INVITE_DEFAULTS = { expiryDays: 7, maxUses: 1, approvalRequired: true } as const;
export const INVITE_LIMITS = { expiryDays: 90, maxUses: 1000 } as const;
/** A request waits this long for a decision. */
export const REQUEST_DAYS = 14;
const DAY_MS = 86_400_000;

export type InviteState = "active" | "expired" | "used_up" | "revoked";

export interface InviteView {
  id: string;
  teamId: string;
  role: Role;
  departmentId: string | null;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  uses: number;
  approvalRequired: boolean;
  state: InviteState;
}

export interface JoinRequestView {
  id: string;
  teamId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  departmentId: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: number;
  decidedAt: number | null;
}

export interface InviteInput {
  role?: string;
  departmentId?: string | null;
  expiresInDays?: number;
  maxUses?: number;
  approvalRequired?: boolean;
}

export interface RedeemResult {
  status: "joined" | "pending";
  team: { id: string; name: string };
  /** A session for the account an invite made. */
  session?: SessionGrant;
}

export interface InvitesDeps {
  db: DatabaseSync;
  now(): number;
  audit(input: AuditInput): void;
  settings: Settings;
  teams: Teams;
  accounts: Accounts;
  /** Whether an email may make an account for a team that limits sign-ups to its verified domains. */
  signupAllowed?(teamId: string, email: string): boolean;
}

interface InviteRow {
  id: string;
  team_id: string;
  role: Role;
  department_id: string | null;
  created_by: string;
  created_at: number;
  expires_at: number;
  max_uses: number;
  uses: number;
  approval_required: number;
  revoked_at: number | null;
}

type Ok<T> = { ok: true } & T;
const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

export function createInvites(deps: InvitesDeps) {
  const { db, teams } = deps;
  const log = (actorId: string | null, input: Omit<AuditInput, "actorId">) =>
    deps.audit({ ...input, actorId });

  const stateOf = (row: InviteRow): InviteState =>
    row.revoked_at !== null
      ? "revoked"
      : row.expires_at <= deps.now()
        ? "expired"
        : row.uses >= row.max_uses
          ? "used_up"
          : "active";

  const view = (row: InviteRow): InviteView => ({
    id: row.id,
    teamId: row.team_id,
    role: row.role,
    departmentId: row.department_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    uses: row.uses,
    approvalRequired: row.approval_required === 1,
    state: stateOf(row),
  });

  /** Requests nobody decided in 14 days are marked expired. */
  function expireStale(): void {
    db.prepare(
      "UPDATE join_requests SET status = 'expired' WHERE status = 'pending' AND created_at <= ?",
    ).run(deps.now() - REQUEST_DAYS * DAY_MS);
  }

  const requestRows = (where: string, ...args: (string | number)[]) =>
    (
      db
        .prepare(
          `SELECT r.*, u.name, u.email FROM join_requests r JOIN users u ON u.id = r.user_id
           WHERE ${where} ORDER BY r.created_at DESC`,
        )
        .all(...args) as {
        id: string;
        team_id: string;
        user_id: string;
        name: string;
        email: string;
        role: Role;
        department_id: string | null;
        status: JoinRequestView["status"];
        created_at: number;
        decided_at: number | null;
      }[]
    ).map((row): JoinRequestView => ({
      id: row.id,
      teamId: row.team_id,
      userId: row.user_id,
      name: row.name,
      email: row.email,
      role: row.role,
      departmentId: row.department_id,
      status: row.status,
      createdAt: row.created_at,
      decidedAt: row.decided_at,
    }));

  return {
    /** Makes an invite. The code is returned once; only its hash is kept. */
    create(
      actor: Actor,
      teamId: string,
      input: InviteInput,
    ): Ok<{ invite: InviteView; code: string }> | Failure {
      if (!teams.exists(teamId)) return fail(404, "not_found", "There is no such team.");
      const role = input.role ?? "member";
      if (!isRole(role) || role === "owner")
        return fail(400, "invalid_role", "A role is admin, manager, member or viewer.");
      const allowed = actor.isOwner
        ? grantableRoles("owner")
        : grantableRoles(actor.role ?? "viewer");
      if (!allowed.includes(role))
        return fail(403, "forbidden", "You can only invite people to a role below your own.");
      if (input.departmentId && teams.department(input.departmentId)?.teamId !== teamId)
        return fail(400, "invalid_department", "That department is not in this team.");

      const days =
        input.expiresInDays ??
        deps.settings.get("team.invite.expiryDays", INVITE_DEFAULTS.expiryDays);
      const maxUses =
        input.maxUses ?? deps.settings.get("team.invite.maxUses", INVITE_DEFAULTS.maxUses);
      const approvalRequired =
        input.approvalRequired ??
        deps.settings.get("team.invite.approvalRequired", INVITE_DEFAULTS.approvalRequired);
      if (!Number.isInteger(days) || days < 1 || days > INVITE_LIMITS.expiryDays)
        return fail(
          400,
          "invalid_expiry",
          `An invite lasts 1 to ${INVITE_LIMITS.expiryDays} days.`,
        );
      if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > INVITE_LIMITS.maxUses)
        return fail(
          400,
          "invalid_uses",
          `An invite can be used 1 to ${INVITE_LIMITS.maxUses} times.`,
        );

      const id = randomUUID();
      const code = `inv_${randomBytes(24).toString("base64url")}`;
      const now = deps.now();
      db.prepare(
        `INSERT INTO invites (id, team_id, code_hash, role, department_id, created_by, created_at,
                              expires_at, max_uses, approval_required)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        teamId,
        hashCode(code),
        role,
        input.departmentId ?? null,
        actor.id,
        now,
        now + days * DAY_MS,
        maxUses,
        approvalRequired ? 1 : 0,
      );
      log(actor.id, {
        action: "invite.created",
        targetType: "invite",
        targetId: id,
        detail: { teamId, role, maxUses, expiresInDays: days, approvalRequired },
      });
      return {
        ok: true,
        invite: view(
          db.prepare("SELECT * FROM invites WHERE id = ?").get(id) as unknown as InviteRow,
        ),
        code,
      };
    },

    list(teamId: string): InviteView[] {
      return (
        db
          .prepare("SELECT * FROM invites WHERE team_id = ? ORDER BY created_at DESC")
          .all(teamId) as unknown as InviteRow[]
      ).map(view);
    },

    revoke(actor: Actor, teamId: string, inviteId: string): Ok<object> | Failure {
      const row = db
        .prepare("SELECT * FROM invites WHERE id = ? AND team_id = ?")
        .get(inviteId, teamId) as unknown as InviteRow | undefined;
      if (!row) return fail(404, "not_found", "There is no such invite.");
      if (row.revoked_at === null) {
        db.prepare("UPDATE invites SET revoked_at = ? WHERE id = ?").run(deps.now(), inviteId);
        log(actor.id, {
          action: "invite.revoked",
          targetType: "invite",
          targetId: inviteId,
          detail: { teamId },
        });
      }
      return { ok: true };
    },

    /**
     * Uses an invite code. A signed-in person joins (or asks to). Someone with no account gives a
     * name, an email and a password, and the invite makes the account.
     */
    redeem(input: {
      code: string;
      user: UserView | null;
      account?: NewAccount;
      clientId?: string;
    }): Ok<RedeemResult> | Failure {
      expireStale();
      const row = db
        .prepare("SELECT * FROM invites WHERE code_hash = ?")
        .get(hashCode(input.code.trim())) as unknown as InviteRow | undefined;
      if (!row) return fail(404, "invalid_code", "That invite code is not valid.");
      const state = stateOf(row);
      if (state === "revoked") return fail(410, "revoked", "This invite was withdrawn.");
      if (state === "expired") return fail(410, "expired", "This invite has expired.");
      if (state === "used_up") return fail(410, "already_used", "This invite was already used.");
      const team = db.prepare("SELECT id, name FROM teams WHERE id = ?").get(row.team_id) as
        { id: string; name: string } | undefined;
      if (!team) return fail(404, "invalid_code", "That invite code is not valid.");

      let user = input.user;
      let session: SessionGrant | undefined;
      if (user) {
        if (teams.member(team.id, user.id))
          return fail(409, "already_member", "You are already in this team.");
        const pending = db
          .prepare(
            "SELECT 1 FROM join_requests WHERE team_id = ? AND user_id = ? AND status = 'pending'",
          )
          .get(team.id, user.id);
        if (pending) return fail(409, "request_pending", "You already asked to join this team.");
      } else {
        if (!input.account)
          return fail(
            401,
            "sign_in_needed",
            "Sign in, or give a name, an email and a password to make an account.",
          );
        if (
          deps.signupAllowed &&
          !deps.signupAllowed(team.id, input.account.email.trim().toLowerCase())
        )
          return fail(
            403,
            "domain_not_allowed",
            "This team only accepts sign-ups from its own email domains.",
          );
        const made = deps.accounts.createAccount(input.account, null, input.clientId ?? "");
        if (!made.ok)
          return fail(
            made.code === "email_taken" ? 409 : 400,
            made.code,
            made.code === "email_taken"
              ? "That email already has an account. Sign in, then use the invite."
              : made.message,
          );
        user = made.user;
        session = deps.accounts.startSession(made.user.id, input.clientId ?? "") ?? undefined;
      }

      db.prepare("UPDATE invites SET uses = uses + 1 WHERE id = ?").run(row.id);
      log(user.id, {
        action: "invite.redeemed",
        targetType: "invite",
        targetId: row.id,
        detail: { teamId: team.id, newAccount: session !== undefined },
        ...(input.clientId ? { clientId: input.clientId } : {}),
      });

      if (row.approval_required === 1) {
        const id = randomUUID();
        db.prepare(
          `INSERT INTO join_requests (id, team_id, invite_id, user_id, role, department_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, team.id, row.id, user.id, row.role, row.department_id, deps.now());
        log(user.id, {
          action: "join_request.created",
          targetType: "join_request",
          targetId: id,
          detail: { teamId: team.id, role: row.role },
        });
        return { ok: true, status: "pending", team, ...(session ? { session } : {}) };
      }
      teams.addMember(team.id, user.id, row.role, row.department_id, {
        actorId: user.id,
        via: "invite",
      });
      return { ok: true, status: "joined", team, ...(session ? { session } : {}) };
    },

    requests(teamId: string, status?: string): JoinRequestView[] {
      expireStale();
      return status
        ? requestRows("r.team_id = ? AND r.status = ?", teamId, status)
        : requestRows("r.team_id = ?", teamId);
    },

    /** What a person asked for, and how it stands. */
    mine(userId: string): JoinRequestView[] {
      expireStale();
      return requestRows("r.user_id = ?", userId);
    },

    decide(
      actor: Actor,
      teamId: string,
      requestId: string,
      approve: boolean,
    ): Ok<{ request: JoinRequestView }> | Failure {
      expireStale();
      const request = requestRows("r.id = ? AND r.team_id = ?", requestId, teamId)[0];
      if (!request) return fail(404, "not_found", "There is no such request.");
      if (request.status !== "pending")
        return fail(409, "already_decided", `That request is ${request.status}.`);
      if (approve) {
        if (!teams.outranks(actor, request.role))
          return fail(403, "forbidden", "Only someone above that role can approve it.");
        if (!teams.member(teamId, request.userId))
          teams.addMember(teamId, request.userId, request.role, request.departmentId, {
            actorId: actor.id,
            via: "approved_request",
          });
      }
      db.prepare(
        "UPDATE join_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?",
      ).run(approve ? "approved" : "rejected", actor.id, deps.now(), requestId);
      log(actor.id, {
        action: approve ? "join_request.approved" : "join_request.rejected",
        targetType: "join_request",
        targetId: requestId,
        detail: { teamId, userId: request.userId },
      });
      return { ok: true, request: requestRows("r.id = ?", requestId)[0]! };
    },
  };
}

export type Invites = ReturnType<typeof createInvites>;
