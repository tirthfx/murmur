import { HttpError, orThrow, reply, type Route } from "../http.ts";
import { me, type RouteDeps } from "./context.ts";

/** Compliance mode (TM-23) and reports of views, exports and deletions. */
export function complianceRoutes({ compliance }: RouteDeps): Route[] {
  const team = (ctx: { params: Record<string, string> }) => ctx.params["teamId"]!;
  return [
    {
      method: "GET",
      path: "/v1/teams/:teamId/compliance",
      access: { action: "compliance.manage" },
      handler: (ctx) => reply(200, compliance.view(team(ctx))),
    },
    {
      method: "PUT",
      path: "/v1/teams/:teamId/compliance",
      access: { action: "compliance.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        return reply(
          200,
          orThrow(compliance.setMode(me(ctx).id, team(ctx), body["mode"])).compliance,
        );
      },
    },
    {
      // An app reports a meeting view, an export or a deletion; recorded only if the team asks.
      method: "POST",
      path: "/v1/teams/:teamId/compliance/report",
      access: { action: "policy.view" },
      async handler(ctx) {
        const body = await ctx.json();
        if (typeof body["event"] !== "string")
          throw new HttpError(400, "invalid_report", "Say which event.");
        const result = orThrow(compliance.report(me(ctx).id, team(ctx), body));
        return reply(200, { recorded: result.recorded });
      },
    },
  ];
}
