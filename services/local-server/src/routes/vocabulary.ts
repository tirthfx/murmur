import { HttpError, orThrow, reply, text, whole, type Ctx, type Route } from "../http.ts";
import type { Kind } from "../vocabulary.ts";
import { me, type RouteDeps } from "./context.ts";

/** The shared dictionary and snippets of a team (TM-06 to TM-08). */
export function vocabularyRoutes({ teams, vocabulary, teamSettings, audit }: RouteDeps): Route[] {
  const who = (ctx: Ctx) => teams.whoIn(me(ctx), ctx.params["teamId"]!);
  const team = (ctx: Ctx) => ctx.params["teamId"]!;
  const item = (ctx: Ctx) => ctx.params["itemId"]!;

  /** The same routes for each kind: `/dictionary` and `/snippets`. */
  const listRoutes = (kind: Kind, path: string): Route[] => [
    {
      method: "GET",
      path: `/v1/teams/:teamId/${path}`,
      access: { action: "vocabulary.view" },
      handler: (ctx) => reply(200, { items: vocabulary.list(who(ctx), team(ctx), kind) }),
    },
    {
      method: "POST",
      path: `/v1/teams/:teamId/${path}`,
      access: { action: "vocabulary.propose" },
      async handler(ctx) {
        const result = orThrow(vocabulary.propose(who(ctx), team(ctx), kind, await ctx.json()));
        return reply(result.live ? 201 : 202, { item: result.item, live: result.live });
      },
    },
  ];

  return [
    ...listRoutes("dictionary", "dictionary"),
    ...listRoutes("snippet", "snippets"),

    {
      method: "POST",
      path: "/v1/teams/:teamId/dictionary/import",
      access: { action: "vocabulary.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        const result = orThrow(
          vocabulary.importCsv(who(ctx), team(ctx), text(body, "csv"), body["confirm"] === true),
        );
        return reply(200, {
          confirmed: result.confirmed,
          rows: result.rows,
          wouldImport: result.wouldImport,
          duplicates: result.duplicates,
          errors: result.errors,
          imported: result.imported,
        });
      },
    },

    // ---- one entry ----
    {
      method: "PATCH",
      path: "/v1/teams/:teamId/vocabulary/items/:itemId",
      access: { action: "vocabulary.propose" },
      async handler(ctx) {
        const result = orThrow(vocabulary.update(who(ctx), team(ctx), item(ctx), await ctx.json()));
        return reply(result.live ? 200 : 202, { item: result.item, live: result.live });
      },
    },
    {
      method: "DELETE",
      path: "/v1/teams/:teamId/vocabulary/items/:itemId",
      access: { action: "vocabulary.propose" },
      handler(ctx) {
        const result = orThrow(vocabulary.remove(who(ctx), team(ctx), item(ctx)));
        return result.live ? reply(204) : reply(202, { item: result.item, live: false });
      },
    },
    {
      method: "GET",
      path: "/v1/teams/:teamId/vocabulary/items/:itemId",
      access: { action: "vocabulary.review" },
      handler(ctx) {
        const found = orThrow(vocabulary.detail(who(ctx), team(ctx), item(ctx)));
        return reply(200, { item: found.item, comments: found.comments, versions: found.versions });
      },
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/vocabulary/items/:itemId/approve",
      access: { action: "vocabulary.review" },
      handler: (ctx) =>
        reply(200, orThrow(vocabulary.approve(who(ctx), team(ctx), item(ctx))).item),
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/vocabulary/items/:itemId/reject",
      access: { action: "vocabulary.review" },
      async handler(ctx) {
        const body = await ctx.json();
        return reply(
          200,
          orThrow(vocabulary.reject(who(ctx), team(ctx), item(ctx), text(body, "comment"))).item,
        );
      },
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/vocabulary/items/:itemId/comments",
      access: { action: "vocabulary.review" },
      async handler(ctx) {
        const body = await ctx.json();
        orThrow(vocabulary.comment(who(ctx), team(ctx), item(ctx), text(body, "body")));
        return reply(201);
      },
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/vocabulary/items/:itemId/rollback",
      access: { action: "vocabulary.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        const version = whole(body, "version");
        if (version === undefined || Number.isNaN(version))
          throw new HttpError(400, "invalid_version", "Say which version to go back to.");
        return reply(
          200,
          orThrow(vocabulary.rollback(who(ctx), team(ctx), item(ctx), version)).item,
        );
      },
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/vocabulary/items/:itemId/lock",
      access: { action: "vocabulary.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        if (typeof body["locked"] !== "boolean")
          throw new HttpError(400, "invalid_lock", "Say whether it is locked (true or false).");
        return reply(
          200,
          orThrow(vocabulary.setLocked(who(ctx), team(ctx), item(ctx), body["locked"])).item,
        );
      },
    },

    // ---- the team's vocabulary as a whole ----
    {
      method: "GET",
      path: "/v1/teams/:teamId/vocabulary/merged",
      access: { action: "vocabulary.view" },
      handler(ctx) {
        const since = ctx.url.searchParams.get("since");
        const number = since === null ? undefined : Number(since);
        return reply(
          200,
          vocabulary.merged(
            who(ctx),
            team(ctx),
            number !== undefined && Number.isInteger(number) ? number : undefined,
          ),
        );
      },
    },
    {
      method: "GET",
      path: "/v1/teams/:teamId/vocabulary/pending",
      access: { action: "vocabulary.review" },
      handler: (ctx) => reply(200, { items: vocabulary.pending(who(ctx), team(ctx)) }),
    },
    {
      method: "GET",
      path: "/v1/teams/:teamId/vocabulary/mine",
      access: { action: "vocabulary.propose" },
      handler: (ctx) =>
        reply(200, {
          items: vocabulary.mine(who(ctx), team(ctx)),
          notices: vocabulary.notices(who(ctx), team(ctx)),
        }),
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/vocabulary/notices/seen",
      access: { action: "vocabulary.propose" },
      handler: (ctx) => reply(200, { marked: vocabulary.markNoticesSeen(who(ctx), team(ctx)) }),
    },
    {
      method: "GET",
      path: "/v1/teams/:teamId/vocabulary/conflicts",
      access: { action: "vocabulary.manage" },
      handler: (ctx) => reply(200, vocabulary.conflicts(team(ctx))),
    },
    {
      method: "GET",
      path: "/v1/teams/:teamId/vocabulary/settings",
      access: { action: "vocabulary.view" },
      handler: (ctx) => reply(200, teamSettings.vocabulary(team(ctx))),
    },
    {
      method: "PUT",
      path: "/v1/teams/:teamId/vocabulary/settings",
      access: { action: "vocabulary.settings" },
      async handler(ctx) {
        const result = teamSettings.setVocabulary(team(ctx), await ctx.json());
        if (!result.ok) throw new HttpError(400, "invalid_settings", result.message);
        if (Object.keys(result.changed).length > 0) {
          vocabulary.bump(team(ctx));
          audit.record({
            actorId: me(ctx).id,
            action: "vocabulary.settings_changed",
            targetType: "team",
            targetId: team(ctx),
            detail: result.changed,
          });
        }
        return reply(200, teamSettings.vocabulary(team(ctx)));
      },
    },
  ];
}
