import { clearedCookie, adminEligible, sessionCookie } from "../admin.ts";
import { HttpError, reply, text, type Route } from "../http.ts";
import type { RouteDeps } from "./context.ts";

/**
 * Signing in to the admin console (TM-11). It is a sign-in like any other, except that the token
 * goes into an `HttpOnly` cookie and never into the answer, so no script on the page can read it.
 * A person who is not an admin anywhere is signed out again at once and told so.
 */
export function adminRoutes({ accounts, teams, plan }: RouteDeps, now: () => number): Route[] {
  return [
    {
      method: "POST",
      path: "/v1/admin/session",
      access: "public",
      async handler(ctx) {
        const body = await ctx.json();
        const result = accounts.signIn(text(body, "email"), text(body, "password"), "admin");
        if (!result.ok) {
          const status =
            result.code === "delayed"
              ? 429
              : result.code === "deactivated" || result.code === "sso_required"
                ? 403
                : 401;
          throw new HttpError(
            status,
            result.code,
            result.message,
            result.retryAfterSeconds !== undefined
              ? { retryAfterSeconds: result.retryAfterSeconds }
              : {},
          );
        }
        const { session } = result;
        if (!adminEligible(session.user, teams)) {
          accounts.signOut(session.token);
          throw new HttpError(
            403,
            "not_admin",
            "This account is not an admin of any team, so it cannot open the console.",
          );
        }
        const missing = plan.require("adminConsole");
        if (missing) {
          accounts.signOut(session.token);
          throw new HttpError(missing.status, missing.code, missing.message);
        }
        return {
          status: 200,
          body: { user: session.user, expiresAt: session.expiresAt },
          headers: {
            "set-cookie": sessionCookie(session.token, (session.expiresAt - now()) / 1000),
          },
        };
      },
    },
    {
      method: "DELETE",
      path: "/v1/admin/session",
      access: "signed_in",
      handler(ctx) {
        accounts.signOut(ctx.token!);
        return { ...reply(204), headers: { "set-cookie": clearedCookie() } };
      },
    },
  ];
}
