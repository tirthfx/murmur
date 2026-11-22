import { HttpError, orThrow, reply, type Route } from "../http.ts";
import { FULL_POLICY_KEYS } from "../plan-gates.ts";
import { me, type RouteDeps } from "./context.ts";

/** Team policy (TM-13 to TM-16): what an admin sets, and what a person's app downloads. */
export function policyRoutes({ policy, teams, plan }: RouteDeps): Route[] {
  const team = (ctx: { params: Record<string, string> }) => ctx.params["teamId"]!;

  return [
    {
      // Everyone in the team gets their own merged policy; the app enforces it.
      method: "GET",
      path: "/v1/teams/:teamId/policy/effective",
      access: { action: "policy.view" },
      handler: (ctx) => reply(200, policy.effective(teams.whoIn(me(ctx), team(ctx)), team(ctx))),
    },
    {
      method: "GET",
      path: "/v1/teams/:teamId/policy",
      access: { action: "policy.manage" },
      handler(ctx) {
        const found = orThrow(
          policy.read(
            team(ctx),
            ctx.url.searchParams.get("scope") ?? "team",
            ctx.url.searchParams.get("scopeId"),
          ),
        );
        return reply(200, found.layer);
      },
    },
    {
      method: "PUT",
      path: "/v1/teams/:teamId/policy",
      access: { action: "policy.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        // Retention, domains, connector limits and deletion approval are the full controls.
        const touched = [
          ...Object.keys((body["set"] as object | undefined) ?? {}),
          ...(Array.isArray(body["unset"]) ? (body["unset"] as string[]) : []),
        ];
        if (touched.some((key) => FULL_POLICY_KEYS.includes(key))) {
          const missing = plan.require("policyFull");
          if (missing) throw new HttpError(missing.status, missing.code, missing.message);
        }
        const result = orThrow(
          policy.set(
            me(ctx).id,
            team(ctx),
            {
              scope: body["scope"] ?? "team",
              scopeId: body["scopeId"],
              set: body["set"],
              unset: body["unset"],
            },
            "admin",
            me(ctx).isOwner,
          ),
        );
        return reply(200, { ...result.layer, changed: result.changed });
      },
    },
    {
      // The app says it applied a retention limit; only counts are kept.
      method: "POST",
      path: "/v1/teams/:teamId/policy/report",
      access: { action: "policy.view" },
      async handler(ctx) {
        const body = await ctx.json();
        if (body["event"] !== "retention_applied")
          throw new HttpError(400, "invalid_report", "The event is retention_applied.");
        orThrow(
          policy.reportRetention(me(ctx).id, team(ctx), {
            audio: body["audio"],
            transcripts: body["transcripts"],
          }),
        );
        return reply(204);
      },
    },
  ];
}
