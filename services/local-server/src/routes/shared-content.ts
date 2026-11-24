import { HttpError, orThrow, reply, text, type Ctx, type Route } from "../http.ts";
import { me, type RouteDeps } from "./context.ts";

/** A team's published Skills and its shared folders (NT-16, NT-17). */
export function sharedContentRoutes({ teams, sharedContent }: RouteDeps): Route[] {
  const who = (ctx: Ctx) => teams.whoIn(me(ctx), ctx.params["teamId"]!);
  const team = (ctx: Ctx) => ctx.params["teamId"]!;
  const id = (ctx: Ctx) => ctx.params["id"]!;

  return [
    // What a client keeps in step with: one answer, with a revision.
    {
      method: "GET",
      path: "/v1/teams/:teamId/content",
      access: { action: "skills.view" },
      handler(ctx) {
        const since = ctx.url.searchParams.get("since");
        const parsed = since === null || since === "" ? undefined : Number(since);
        if (parsed !== undefined && !Number.isInteger(parsed))
          throw new HttpError(400, "invalid_since", "since is a revision number.");
        return reply(200, sharedContent.content(who(ctx), team(ctx), parsed));
      },
    },

    // ---- Skills ----
    {
      method: "GET",
      path: "/v1/teams/:teamId/skills",
      access: { action: "skills.view" },
      handler: (ctx) => reply(200, { skills: sharedContent.listSkills(who(ctx), team(ctx)) }),
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/skills",
      access: { action: "skills.manage" },
      async handler(ctx) {
        const result = orThrow(sharedContent.createSkill(who(ctx), team(ctx), await ctx.json()));
        return reply(201, { skill: result.skill });
      },
    },
    {
      method: "PATCH",
      path: "/v1/teams/:teamId/skills/:id",
      access: { action: "skills.manage" },
      async handler(ctx) {
        const result = orThrow(
          sharedContent.updateSkill(who(ctx), team(ctx), id(ctx), await ctx.json()),
        );
        return reply(200, { skill: result.skill, changed: result.changed });
      },
    },
    {
      method: "DELETE",
      path: "/v1/teams/:teamId/skills/:id",
      access: { action: "skills.manage" },
      handler(ctx) {
        orThrow(sharedContent.removeSkill(who(ctx), team(ctx), id(ctx)));
        return reply(204);
      },
    },
    {
      method: "GET",
      path: "/v1/teams/:teamId/skills/:id/versions",
      access: { action: "skills.view" },
      handler(ctx) {
        const result = orThrow(sharedContent.skillVersions(who(ctx), team(ctx), id(ctx)));
        return reply(200, { versions: result.versions });
      },
    },

    // ---- folders ----
    {
      method: "GET",
      path: "/v1/teams/:teamId/folders",
      access: { action: "folders.view" },
      handler: (ctx) => reply(200, { folders: sharedContent.listFolders(who(ctx), team(ctx)) }),
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/folders",
      access: { action: "folders.contribute" },
      async handler(ctx) {
        const result = orThrow(sharedContent.createFolder(who(ctx), team(ctx), await ctx.json()));
        return reply(201, { folder: result.folder });
      },
    },
    {
      method: "PATCH",
      path: "/v1/teams/:teamId/folders/:id",
      access: { action: "folders.contribute" },
      async handler(ctx) {
        const result = orThrow(
          sharedContent.renameFolder(who(ctx), team(ctx), id(ctx), await ctx.json()),
        );
        return reply(200, { folder: result.folder });
      },
    },
    {
      method: "DELETE",
      path: "/v1/teams/:teamId/folders/:id",
      access: { action: "folders.contribute" },
      handler(ctx) {
        orThrow(sharedContent.removeFolder(who(ctx), team(ctx), id(ctx)));
        return reply(204);
      },
    },
    {
      method: "PUT",
      path: "/v1/teams/:teamId/folders/:id/members/:userId",
      access: { action: "folders.contribute" },
      async handler(ctx) {
        const body = await ctx.json();
        const result = orThrow(
          sharedContent.setMember(
            who(ctx),
            team(ctx),
            id(ctx),
            ctx.params["userId"]!,
            body["canWrite"] !== false,
          ),
        );
        return reply(200, { folder: result.folder });
      },
    },
    {
      method: "DELETE",
      path: "/v1/teams/:teamId/folders/:id/members/:userId",
      access: { action: "folders.view" },
      handler(ctx) {
        orThrow(sharedContent.removeMember(who(ctx), team(ctx), id(ctx), ctx.params["userId"]!));
        return reply(204);
      },
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/folders/:id/items",
      access: { action: "folders.contribute" },
      async handler(ctx) {
        const body = await ctx.json();
        const result = orThrow(
          sharedContent.shareItem(who(ctx), team(ctx), id(ctx), {
            title: text(body, "title"),
            body: text(body, "body"),
            sourceRef: text(body, "sourceRef"),
          }),
        );
        return reply(201, { id: result.id });
      },
    },
    {
      method: "GET",
      path: "/v1/teams/:teamId/folders/:id/items/:itemId",
      access: { action: "folders.view" },
      handler(ctx) {
        const result = orThrow(
          sharedContent.readItem(who(ctx), team(ctx), id(ctx), ctx.params["itemId"]!),
        );
        return reply(200, { item: result.item });
      },
    },
    {
      method: "DELETE",
      path: "/v1/teams/:teamId/folders/:id/items/:itemId",
      access: { action: "folders.contribute" },
      handler(ctx) {
        orThrow(sharedContent.removeItem(who(ctx), team(ctx), id(ctx), ctx.params["itemId"]!));
        return reply(204);
      },
    },
  ];
}
