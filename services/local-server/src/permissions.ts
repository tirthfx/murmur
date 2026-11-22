import matrix from "./permissions.json" with { type: "json" };

/**
 * Who may do what (TM-04), from one file that the server tests and the admin console both read.
 * The server checks it on every request; a client only hides controls.
 *
 * - `scope: "team"` actions are for a role in that team. The server owner counts as owner in every
 *   team.
 * - `scope: "server"` actions have no team; they are for the server owner.
 */
export const ROLES = matrix.roles as readonly Role[];
export type Role = "owner" | "admin" | "manager" | "member" | "viewer";
export type ActionName = keyof typeof matrix.actions;

interface ActionRule {
  scope: "team" | "server";
  roles: readonly Role[];
}

export const ACTIONS = matrix.actions as Record<ActionName, ActionRule>;

/** Higher is more. Only a role below your own can be given or changed by you. */
export const RANK: Record<Role, number> = { owner: 5, admin: 4, manager: 3, member: 2, viewer: 1 };

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isAction(value: string): value is ActionName {
  return Object.hasOwn(ACTIONS, value);
}

/** A role's right to an action; `isServerOwner` is the account that owns the server. */
export function allows(
  action: ActionName,
  who: { role: Role | null; isServerOwner: boolean },
): boolean {
  const rule = ACTIONS[action];
  if (rule.scope === "server") return who.isServerOwner;
  const role = who.isServerOwner ? "owner" : who.role;
  return role !== null && rule.roles.includes(role);
}

/**
 * The roles an actor may hand out: any role below their own. Nobody gives the owner role: it
 * belongs to whoever made the team.
 */
export function grantableRoles(actor: Role): Role[] {
  return ROLES.filter((role) => role !== "owner" && RANK[role] < RANK[actor]);
}
