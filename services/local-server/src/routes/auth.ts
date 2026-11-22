import { HttpError, reply, text, type Route } from "../http.ts";
import { SERVER_VERSION } from "../version.ts";
import { me, type RouteDeps } from "./context.ts";

/** Setup, sign-in, the signed-in person's own account, and the owner's list of accounts. */
export function authRoutes({ accounts }: RouteDeps): Route[] {
  return [
    {
      method: "GET",
      path: "/v1/health",
      access: "public",
      handler: () => reply(200, { ok: true, version: SERVER_VERSION, setUp: accounts.isSetUp() }),
    },
    {
      method: "POST",
      path: "/v1/setup",
      access: "public",
      async handler(ctx) {
        const body = await ctx.json();
        const result = accounts.setupOwner(
          {
            name: text(body, "name"),
            email: text(body, "email"),
            password: text(body, "password"),
          },
          text(body, "clientId"),
        );
        if (!result.ok)
          throw new HttpError(
            result.code === "already_set_up" ? 409 : 400,
            result.code,
            result.message,
          );
        return reply(201, result.session);
      },
    },
    {
      method: "POST",
      path: "/v1/sessions",
      access: "public",
      async handler(ctx) {
        const body = await ctx.json();
        const result = accounts.signIn(
          text(body, "email"),
          text(body, "password"),
          text(body, "clientId"),
        );
        if (!result.ok) {
          const status =
            result.code === "delayed" ? 429 : result.code === "deactivated" ? 403 : 401;
          throw new HttpError(
            status,
            result.code,
            result.message,
            result.retryAfterSeconds !== undefined
              ? { retryAfterSeconds: result.retryAfterSeconds }
              : {},
          );
        }
        return reply(200, result.session);
      },
    },
    {
      method: "DELETE",
      path: "/v1/sessions/current",
      access: "signed_in",
      handler(ctx) {
        accounts.signOut(ctx.token!);
        return reply(204);
      },
    },
    { method: "GET", path: "/v1/me", access: "signed_in", handler: (ctx) => reply(200, me(ctx)) },
    {
      method: "POST",
      path: "/v1/me/password",
      access: "signed_in",
      async handler(ctx) {
        const body = await ctx.json();
        const result = accounts.changePassword(
          me(ctx).id,
          text(body, "currentPassword"),
          text(body, "newPassword"),
          ctx.token!,
        );
        if (!result.ok) throw new HttpError(400, result.code, result.message);
        return reply(204);
      },
    },
    {
      method: "GET",
      path: "/v1/users",
      access: { action: "users.manage" },
      handler: () => reply(200, { users: accounts.listUsers() }),
    },
    {
      method: "POST",
      path: "/v1/users",
      access: { action: "users.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        const result = accounts.createAccount(
          {
            name: text(body, "name"),
            email: text(body, "email"),
            password: text(body, "password"),
          },
          me(ctx).id,
        );
        if (!result.ok)
          throw new HttpError(
            result.code === "email_taken" ? 409 : 400,
            result.code,
            result.message,
          );
        return reply(201, result.user);
      },
    },
  ];
}
