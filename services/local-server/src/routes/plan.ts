import { HttpError, reply, type Route } from "../http.ts";
import { me, type RouteDeps } from "./context.ts";

/** The plan tier of the server: read by anyone signed in, changed by the owner (TM-24, TM-25). */
export function planRoutes({ plan }: RouteDeps): Route[] {
  return [
    {
      method: "GET",
      path: "/v1/plan",
      access: "signed_in",
      handler: () => reply(200, plan.view()),
    },
    {
      method: "PUT",
      path: "/v1/plan",
      access: { action: "plan.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        const result = plan.setTier(me(ctx).id, body["tier"]);
        if (!result.ok) throw new HttpError(result.status, result.code, result.message);
        return reply(200, plan.view());
      },
    },
  ];
}
