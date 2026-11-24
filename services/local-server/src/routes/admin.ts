import { clearedCookie, adminEligible, sessionCookie } from "../admin.ts";
import { HttpError, reply, text, type Json, type Route } from "../http.ts";
import { me, type RouteDeps } from "./context.ts";

/**
 * Signing in to the admin console (TM-11). It is a sign-in like any other, except that the token
 * goes into an `HttpOnly` cookie and never into the answer, so no script on the page can read it.
 * A person who is not an admin anywhere is signed out again at once and told so.
 *
 * A second step (a time-based code, see `mfa.ts`) is asked for when the account has set one up,
 * and every console account must have one when the owner turns `team.admin.requireMfa` on.
 */
export const REQUIRE_MFA = "team.admin.requireMfa";

export function adminRoutes(
  { accounts, teams, plan, mfa, settings, audit }: RouteDeps,
  now: () => number,
): Route[] {
  /** A password check that makes no lasting session: the sign-in rules, then the session ends. */
  function verified(body: Json, clientId: string) {
    const result = accounts.signIn(text(body, "email"), text(body, "password"), clientId);
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
    return result.session;
  }

  /** The person behind a password, who must be allowed in the console at all. */
  function adminFromPassword(body: Json) {
    const session = verified(body, "admin-mfa");
    accounts.signOut(session.token);
    if (!adminEligible(session.user, teams))
      throw new HttpError(
        403,
        "not_admin",
        "This account is not an admin of any team, so it cannot open the console.",
      );
    return session.user;
  }

  const required = () => settings.get<boolean>(REQUIRE_MFA, false) === true;

  return [
    {
      method: "POST",
      path: "/v1/admin/session",
      access: "public",
      async handler(ctx) {
        const body = await ctx.json();
        const session = verified(body, "admin");
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
        if (mfa.enrolled(session.user.id)) {
          const code = typeof body["code"] === "string" ? body["code"].trim() : "";
          if (code === "") {
            accounts.signOut(session.token);
            throw new HttpError(
              401,
              "mfa_required",
              "Enter the code from your authenticator app, or a recovery code.",
            );
          }
          const checked = mfa.check(session.user.id, code);
          if (!checked.ok) {
            accounts.signOut(session.token);
            throw new HttpError(
              checked.code === "delayed" ? 429 : 401,
              checked.code,
              checked.code === "delayed"
                ? "Too many wrong codes. Wait a little and try again."
                : "That code is not right.",
              checked.retryAfterSeconds !== undefined
                ? { retryAfterSeconds: checked.retryAfterSeconds }
                : {},
            );
          }
        } else if (required()) {
          accounts.signOut(session.token);
          throw new HttpError(
            403,
            "mfa_enrollment_required",
            "This server requires a second step for the console. Set up an authenticator app first.",
          );
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

    // Setting up a second step. These ask for the password, not a session, because a person who
    // must have a second step cannot get a session until they have one.
    {
      method: "POST",
      path: "/v1/admin/mfa/begin",
      access: "public",
      async handler(ctx) {
        const user = adminFromPassword(await ctx.json());
        if (mfa.enrolled(user.id))
          throw new HttpError(409, "already_enrolled", "A second step is already set up.");
        const started = mfa.begin(user.id, user.email);
        audit.record({
          actorId: user.id,
          action: "mfa.enrollment_started",
          targetType: "user",
          targetId: user.id,
        });
        // The secret is shown once, to the person who is setting up.
        return reply(200, { secret: started.secret, uri: started.uri });
      },
    },
    {
      method: "POST",
      path: "/v1/admin/mfa/confirm",
      access: "public",
      async handler(ctx) {
        const body = await ctx.json();
        const user = adminFromPassword(body);
        const done = mfa.confirm(user.id, text(body, "code"));
        if (!done.ok)
          throw new HttpError(
            400,
            "mfa_invalid",
            "That code is not right. Check the clock on your phone and try the next one.",
          );
        audit.record({
          actorId: user.id,
          action: "mfa.enrolled",
          targetType: "user",
          targetId: user.id,
        });
        return reply(200, { recovery: done.recovery });
      },
    },
    {
      method: "POST",
      path: "/v1/admin/mfa/disable",
      access: "public",
      async handler(ctx) {
        const body = await ctx.json();
        const user = adminFromPassword(body);
        if (!mfa.enrolled(user.id))
          throw new HttpError(409, "not_enrolled", "There is no second step to turn off.");
        if (required())
          throw new HttpError(
            403,
            "mfa_required_by_owner",
            "This server requires a second step. Ask the owner.",
          );
        const checked = mfa.check(user.id, text(body, "code"));
        if (!checked.ok)
          throw new HttpError(
            checked.code === "delayed" ? 429 : 401,
            checked.code,
            "That code is not right.",
          );
        mfa.remove(user.id);
        audit.record({
          actorId: user.id,
          action: "mfa.disabled",
          targetType: "user",
          targetId: user.id,
        });
        return reply(204);
      },
    },

    // What the server owner decides: whether every console account needs a second step.
    {
      method: "GET",
      path: "/v1/admin/mfa-policy",
      access: { action: "users.manage" },
      handler: () => reply(200, { requireMfa: required() }),
    },
    {
      method: "PUT",
      path: "/v1/admin/mfa-policy",
      access: { action: "users.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        if (typeof body["requireMfa"] !== "boolean")
          throw new HttpError(400, "invalid_policy", "Send requireMfa as true or false.");
        const owner = me(ctx);
        // The owner must have one first, or turning it on would lock the owner out.
        if (body["requireMfa"] && !mfa.enrolled(owner.id))
          throw new HttpError(
            409,
            "enroll_first",
            "Set up your own second step first, or you would be locked out.",
          );
        settings.set(REQUIRE_MFA, body["requireMfa"]);
        audit.record({
          actorId: owner.id,
          action: "admin.mfa_policy_changed",
          detail: { required: body["requireMfa"] },
        });
        return reply(200, { requireMfa: required() });
      },
    },
    // A lost phone and no recovery codes: the owner turns the person's second step off so they
    // can set up again.
    {
      method: "POST",
      path: "/v1/users/:userId/mfa/reset",
      access: { action: "users.manage" },
      handler(ctx) {
        const target = accounts.findById(ctx.params["userId"] ?? "");
        if (!target) throw new HttpError(404, "not_found", "There is no such account.");
        mfa.remove(target.id);
        audit.record({
          actorId: me(ctx).id,
          action: "mfa.reset",
          targetType: "user",
          targetId: target.id,
        });
        return reply(204);
      },
    },
  ];
}
