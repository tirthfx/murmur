import { HttpError, orThrow, reply, text, whole, type Json, type Route } from "../http.ts";
import type { InviteInput } from "../invites.ts";
import { me, type RouteDeps } from "./context.ts";

const optionalText = (body: Json, key: string): string | undefined =>
  typeof body[key] === "string" ? (body[key] as string) : undefined;

/** `departmentId` in a body: a string, null to clear it, or left out. */
function departmentField(body: Json): string | null | undefined {
  if (!("departmentId" in body)) return undefined;
  const value = body["departmentId"];
  if (value === null || typeof value === "string") return value;
  throw new HttpError(400, "invalid_department", "A department is an id or null.");
}

function parentField(body: Json): string | null | undefined {
  if (!("parentId" in body)) return undefined;
  const value = body["parentId"];
  if (value === null || typeof value === "string") return value;
  throw new HttpError(400, "invalid_parent", "A parent is a department id or null.");
}

/** Teams, members, departments, invites and join requests (TM-02 to TM-05). */
export function teamRoutes({ teams, invites }: RouteDeps): Route[] {
  const actor = (ctx: { user: ReturnType<typeof me> | null; params: Record<string, string> }) =>
    teams.actorFor(ctx.user!, ctx.params["teamId"]!);

  return [
    // ---- teams ----
    {
      method: "GET",
      path: "/v1/teams",
      access: "signed_in",
      handler: (ctx) => reply(200, { teams: teams.list(me(ctx)) }),
    },
    {
      method: "POST",
      path: "/v1/teams",
      access: { action: "team.create" },
      async handler(ctx) {
        const body = await ctx.json();
        return reply(201, orThrow(teams.create(me(ctx), text(body, "name"))).team);
      },
    },
    {
      method: "GET",
      path: "/v1/teams/:teamId",
      access: { action: "team.view" },
      handler: (ctx) => reply(200, orThrow(teams.get(me(ctx), ctx.params["teamId"]!)).team),
    },
    {
      method: "PATCH",
      path: "/v1/teams/:teamId",
      access: { action: "team.update" },
      async handler(ctx) {
        const body = await ctx.json();
        orThrow(teams.rename(actor(ctx), ctx.params["teamId"]!, text(body, "name")));
        return reply(200, orThrow(teams.get(me(ctx), ctx.params["teamId"]!)).team);
      },
    },
    {
      method: "DELETE",
      path: "/v1/teams/:teamId",
      access: { action: "team.delete" },
      handler(ctx) {
        orThrow(teams.remove(actor(ctx), ctx.params["teamId"]!));
        return reply(204);
      },
    },

    // ---- members ----
    {
      method: "GET",
      path: "/v1/teams/:teamId/members",
      access: { action: "members.list" },
      handler: (ctx) => reply(200, { members: teams.members(ctx.params["teamId"]!) }),
    },
    {
      method: "PATCH",
      path: "/v1/teams/:teamId/members/:userId",
      access: { action: "members.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        const patch: { role?: string; departmentId?: string | null } = {};
        const role = optionalText(body, "role");
        if (role !== undefined) patch.role = role;
        const departmentId = departmentField(body);
        if (departmentId !== undefined) patch.departmentId = departmentId;
        const result = orThrow(
          teams.change(actor(ctx), ctx.params["teamId"]!, ctx.params["userId"]!, patch),
        );
        return reply(200, result.member);
      },
    },
    {
      method: "DELETE",
      path: "/v1/teams/:teamId/members/:userId",
      access: { action: "members.manage" },
      handler(ctx) {
        orThrow(teams.removeMember(actor(ctx), ctx.params["teamId"]!, ctx.params["userId"]!));
        return reply(204);
      },
    },
    {
      // Leaving is the person's own right; a role is not needed.
      method: "POST",
      path: "/v1/teams/:teamId/leave",
      access: "signed_in",
      handler(ctx) {
        const user = me(ctx);
        const teamId = ctx.params["teamId"]!;
        if (!teams.member(teamId, user.id))
          throw new HttpError(404, "not_found", "You are not in that team.");
        orThrow(teams.removeMember(teams.actorFor(user, teamId), teamId, user.id));
        return reply(204);
      },
    },

    // ---- departments ----
    {
      method: "GET",
      path: "/v1/teams/:teamId/departments",
      access: { action: "departments.list" },
      handler: (ctx) => reply(200, { departments: teams.departments(ctx.params["teamId"]!) }),
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/departments",
      access: { action: "departments.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        const parentId = parentField(body);
        const result = orThrow(
          teams.createDepartment(actor(ctx), ctx.params["teamId"]!, {
            name: text(body, "name"),
            costCenter: text(body, "costCenter"),
            ...(parentId !== undefined ? { parentId } : {}),
          }),
        );
        return reply(201, result.department);
      },
    },
    {
      method: "PATCH",
      path: "/v1/teams/:teamId/departments/:departmentId",
      access: { action: "departments.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        const patch: { name?: string; costCenter?: string; parentId?: string | null } = {};
        const name = optionalText(body, "name");
        const costCenter = optionalText(body, "costCenter");
        const parentId = parentField(body);
        if (name !== undefined) patch.name = name;
        if (costCenter !== undefined) patch.costCenter = costCenter;
        if (parentId !== undefined) patch.parentId = parentId;
        const result = orThrow(
          teams.updateDepartment(
            actor(ctx),
            ctx.params["teamId"]!,
            ctx.params["departmentId"]!,
            patch,
          ),
        );
        return reply(200, result.department);
      },
    },
    {
      method: "DELETE",
      path: "/v1/teams/:teamId/departments/:departmentId",
      access: { action: "departments.manage" },
      handler(ctx) {
        orThrow(
          teams.removeDepartment(actor(ctx), ctx.params["teamId"]!, ctx.params["departmentId"]!),
        );
        return reply(204);
      },
    },

    // ---- invites and requests ----
    {
      method: "GET",
      path: "/v1/teams/:teamId/invites",
      access: { action: "invites.manage" },
      handler: (ctx) => reply(200, { invites: invites.list(ctx.params["teamId"]!) }),
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/invites",
      access: { action: "invites.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        const input: InviteInput = {};
        const role = optionalText(body, "role");
        if (role !== undefined) input.role = role;
        const departmentId = departmentField(body);
        if (departmentId !== undefined) input.departmentId = departmentId;
        const days = whole(body, "expiresInDays");
        if (days !== undefined) input.expiresInDays = days;
        const uses = whole(body, "maxUses");
        if (uses !== undefined) input.maxUses = uses;
        if (typeof body["approvalRequired"] === "boolean")
          input.approvalRequired = body["approvalRequired"];
        const result = orThrow(invites.create(actor(ctx), ctx.params["teamId"]!, input));
        // The code is shown here and never again; only its hash is kept.
        return reply(201, {
          invite: result.invite,
          code: result.code,
          link: `http://${ctx.host}/join?code=${encodeURIComponent(result.code)}`,
        });
      },
    },
    {
      method: "DELETE",
      path: "/v1/teams/:teamId/invites/:inviteId",
      access: { action: "invites.manage" },
      handler(ctx) {
        orThrow(invites.revoke(actor(ctx), ctx.params["teamId"]!, ctx.params["inviteId"]!));
        return reply(204);
      },
    },
    {
      method: "POST",
      path: "/v1/invites/redeem",
      access: "optional",
      async handler(ctx) {
        const body = await ctx.json();
        const hasAccount = ctx.user !== null;
        const result = orThrow(
          invites.redeem({
            code: text(body, "code"),
            user: ctx.user,
            clientId: text(body, "clientId"),
            ...(!hasAccount
              ? {
                  account: {
                    name: text(body, "name"),
                    email: text(body, "email"),
                    password: text(body, "password"),
                  },
                }
              : {}),
          }),
        );
        return reply(result.status === "pending" ? 202 : 201, {
          status: result.status,
          team: result.team,
          ...(result.session ? { session: result.session } : {}),
        });
      },
    },
    {
      method: "GET",
      path: "/v1/teams/:teamId/requests",
      access: { action: "requests.manage" },
      handler: (ctx) =>
        reply(200, {
          requests: invites.requests(
            ctx.params["teamId"]!,
            ctx.url.searchParams.get("status") ?? undefined,
          ),
        }),
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/requests/:requestId/approve",
      access: { action: "requests.manage" },
      handler: (ctx) =>
        reply(
          200,
          orThrow(invites.decide(actor(ctx), ctx.params["teamId"]!, ctx.params["requestId"]!, true))
            .request,
        ),
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/requests/:requestId/reject",
      access: { action: "requests.manage" },
      handler: (ctx) =>
        reply(
          200,
          orThrow(
            invites.decide(actor(ctx), ctx.params["teamId"]!, ctx.params["requestId"]!, false),
          ).request,
        ),
    },
    {
      method: "GET",
      path: "/v1/me/join-requests",
      access: "signed_in",
      handler: (ctx) => reply(200, { requests: invites.mine(me(ctx).id) }),
    },
  ];
}
