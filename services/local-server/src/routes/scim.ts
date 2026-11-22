import { readJson, type Ctx, type Reply, type Route } from "../http.ts";
import { ScimError } from "../scim.ts";
import type { RouteDeps } from "./context.ts";

const scimReply = (status: number, body?: unknown): Reply =>
  body === undefined
    ? { status }
    : { status, body, headers: { "content-type": "application/scim+json; charset=utf-8" } };

/** SCIM 2.0 users and groups for the team a token belongs to (TM-19), a simulation. */
export function scimRoutes({ scim }: RouteDeps): Route[] {
  const team = (ctx: Ctx) => {
    if (!ctx.scimTeamId) throw new ScimError(401, "A SCIM token is needed.");
    return ctx.scimTeamId;
  };

  return [
    {
      method: "GET",
      path: "/scim/v2/ServiceProviderConfig",
      access: "scim",
      handler: () => scimReply(200, scim.serviceProviderConfig()),
    },
    {
      method: "GET",
      path: "/scim/v2/Users",
      access: "scim",
      handler: (ctx) => scimReply(200, scim.listUsers(team(ctx), ctx.url.searchParams, ctx.host)),
    },
    {
      method: "POST",
      path: "/scim/v2/Users",
      access: "scim",
      async handler(ctx) {
        return scimReply(201, scim.createUser(team(ctx), await readJson(ctx.req), ctx.host));
      },
    },
    {
      method: "GET",
      path: "/scim/v2/Users/:id",
      access: "scim",
      handler: (ctx) => scimReply(200, scim.getUser(team(ctx), ctx.params["id"]!, ctx.host)),
    },
    {
      method: "PUT",
      path: "/scim/v2/Users/:id",
      access: "scim",
      async handler(ctx) {
        return scimReply(
          200,
          scim.replaceUser(team(ctx), ctx.params["id"]!, await readJson(ctx.req), ctx.host),
        );
      },
    },
    {
      method: "PATCH",
      path: "/scim/v2/Users/:id",
      access: "scim",
      async handler(ctx) {
        return scimReply(
          200,
          scim.patchUser(team(ctx), ctx.params["id"]!, await readJson(ctx.req), ctx.host),
        );
      },
    },
    {
      method: "DELETE",
      path: "/scim/v2/Users/:id",
      access: "scim",
      handler(ctx) {
        scim.deleteUser(team(ctx), ctx.params["id"]!);
        return scimReply(204);
      },
    },
    {
      method: "GET",
      path: "/scim/v2/Groups",
      access: "scim",
      handler: (ctx) => scimReply(200, scim.listGroups(team(ctx), ctx.url.searchParams, ctx.host)),
    },
    {
      method: "POST",
      path: "/scim/v2/Groups",
      access: "scim",
      async handler(ctx) {
        return scimReply(201, scim.createGroup(team(ctx), await readJson(ctx.req), ctx.host));
      },
    },
    {
      method: "GET",
      path: "/scim/v2/Groups/:id",
      access: "scim",
      handler: (ctx) => scimReply(200, scim.getGroup(team(ctx), ctx.params["id"]!, ctx.host)),
    },
    {
      method: "PUT",
      path: "/scim/v2/Groups/:id",
      access: "scim",
      async handler(ctx) {
        return scimReply(
          200,
          scim.replaceGroup(team(ctx), ctx.params["id"]!, await readJson(ctx.req), ctx.host),
        );
      },
    },
    {
      method: "PATCH",
      path: "/scim/v2/Groups/:id",
      access: "scim",
      async handler(ctx) {
        return scimReply(
          200,
          scim.patchGroup(team(ctx), ctx.params["id"]!, await readJson(ctx.req), ctx.host),
        );
      },
    },
    {
      method: "DELETE",
      path: "/scim/v2/Groups/:id",
      access: "scim",
      handler(ctx) {
        scim.deleteGroup(team(ctx), ctx.params["id"]!);
        return scimReply(204);
      },
    },
  ];
}
