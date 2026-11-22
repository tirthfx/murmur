import { HttpError, reply, type Route } from "../http.ts";
import { me, type RouteDeps } from "./context.ts";

/** The IP allowlist (TM-22): for the owner of the server. */
export function networkRoutes({ network }: RouteDeps): Route[] {
  return [
    {
      method: "GET",
      path: "/v1/network/allowlist",
      access: { action: "network.manage" },
      handler: () =>
        reply(200, {
          ranges: network.allowlist(),
          note: "This machine is always allowed. Other addresses can only reach the server when it listens on the network (MURMUR_SERVER_LAN=1).",
        }),
    },
    {
      method: "PUT",
      path: "/v1/network/allowlist",
      access: { action: "network.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        const result = network.set(me(ctx).id, body["ranges"]);
        if (!result.ok) throw new HttpError(400, "invalid_allowlist", result.message);
        return reply(200, { ranges: result.ranges });
      },
    },
  ];
}
