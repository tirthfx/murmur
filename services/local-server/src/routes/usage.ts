import { HttpError, orThrow, reply, type Ctx, type Route } from "../http.ts";
import type { UsageFilters } from "../usage.ts";
import { me, type RouteDeps } from "./context.ts";

function filtersOf(url: URL): UsageFilters {
  const filters: UsageFilters = {};
  const get = (key: string) => url.searchParams.get(key) || undefined;
  const from = get("from");
  const to = get("to");
  const departmentId = get("department");
  const memberId = get("member");
  if (from) filters.from = from;
  if (to) filters.to = to;
  if (departmentId) filters.departmentId = departmentId;
  if (memberId) filters.memberId = memberId;
  return filters;
}

/** Usage events in, dashboards and export out, and the leaderboard (TM-09, TM-10). */
export function usageRoutes({ usage, teams, usageSettings, audit }: RouteDeps): Route[] {
  const who = (ctx: Ctx) => teams.whoIn(me(ctx), ctx.params["teamId"]!);
  const team = (ctx: Ctx) => ctx.params["teamId"]!;

  return [
    {
      // Clients send counts in batches; a batch id makes a resend harmless.
      method: "POST",
      path: "/v1/teams/:teamId/usage",
      access: { action: "usage.ingest" },
      async handler(ctx) {
        const result = orThrow(usage.ingest(who(ctx), team(ctx), await ctx.json()));
        return reply(200, { accepted: result.accepted, duplicate: result.duplicate });
      },
    },
    {
      method: "GET",
      path: "/v1/teams/:teamId/usage",
      access: { action: "usage.view" },
      handler(ctx) {
        const found = orThrow(
          usage.report(
            who(ctx),
            team(ctx),
            filtersOf(ctx.url),
            ctx.url.searchParams.get("detail") === "members",
          ),
        );
        // `ok` is the service's own marker; undefined is left out of the JSON.
        return reply(200, { ...found, ok: undefined });
      },
    },
    {
      method: "GET",
      path: "/v1/teams/:teamId/usage/export",
      access: { action: "usage.view" },
      handler(ctx) {
        const result = orThrow(
          usage.export(
            who(ctx),
            team(ctx),
            filtersOf(ctx.url),
            ctx.url.searchParams.get("format") ?? "csv",
          ),
        );
        const extension = result.type.startsWith("text/csv") ? "csv" : "json";
        return {
          status: 200,
          raw: result.body,
          headers: {
            "content-type": result.type,
            "content-disposition": `attachment; filename="murmur-usage.${extension}"`,
          },
        };
      },
    },
    {
      method: "GET",
      path: "/v1/teams/:teamId/usage/settings",
      access: { action: "usage.settings" },
      handler: (ctx) => reply(200, usageSettings.usage.get(team(ctx))),
    },
    {
      method: "PUT",
      path: "/v1/teams/:teamId/usage/settings",
      access: { action: "usage.settings" },
      async handler(ctx) {
        const result = usageSettings.usage.set(team(ctx), await ctx.json());
        if (!result.ok) throw new HttpError(400, "invalid_settings", result.message);
        if (Object.keys(result.changed).length > 0)
          audit.record({
            actorId: me(ctx).id,
            action: "usage.settings_changed",
            targetType: "team",
            targetId: team(ctx),
            detail: result.changed,
          });
        return reply(200, usageSettings.usage.get(team(ctx)));
      },
    },

    // ---- leaderboard ----
    {
      method: "GET",
      path: "/v1/teams/:teamId/leaderboard",
      access: { action: "leaderboard.view" },
      handler(ctx) {
        const found = orThrow(
          usage.leaderboard(who(ctx), team(ctx), {
            ...(ctx.url.searchParams.get("metric")
              ? { metric: ctx.url.searchParams.get("metric")! }
              : {}),
            ...(ctx.url.searchParams.get("period")
              ? { period: ctx.url.searchParams.get("period")! }
              : {}),
          }),
        );
        return reply(200, { ...found, ok: undefined });
      },
    },
    {
      // A member's own choice to be listed or not.
      method: "PUT",
      path: "/v1/teams/:teamId/leaderboard/me",
      access: { action: "leaderboard.view" },
      async handler(ctx) {
        const body = await ctx.json();
        if (typeof body["visible"] !== "boolean")
          throw new HttpError(400, "invalid_choice", "Say whether you are listed (true or false).");
        usage.setMyVisibility(who(ctx), team(ctx), body["visible"]);
        return reply(200, { visible: body["visible"] });
      },
    },
    {
      method: "PUT",
      path: "/v1/teams/:teamId/leaderboard/settings",
      access: { action: "usage.settings" },
      async handler(ctx) {
        const result = usageSettings.leaderboard.set(team(ctx), await ctx.json());
        if (!result.ok) throw new HttpError(400, "invalid_settings", result.message);
        if (Object.keys(result.changed).length > 0)
          audit.record({
            actorId: me(ctx).id,
            action: "leaderboard.settings_changed",
            targetType: "team",
            targetId: team(ctx),
            detail: result.changed,
          });
        return reply(200, usageSettings.leaderboard.get(team(ctx)));
      },
    },
  ];
}
