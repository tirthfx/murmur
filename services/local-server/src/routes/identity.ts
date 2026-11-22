import { HttpError, orThrow, reply, text, type Route } from "../http.ts";
import { me, type RouteDeps } from "./context.ts";

/** Single sign-on, SCIM and domain settings, and the sign-in itself (TM-18 to TM-20), all simulations. */
export function identityRoutes({ identity }: RouteDeps): Route[] {
  const team = (ctx: { params: Record<string, string> }) => ctx.params["teamId"]!;

  return [
    {
      method: "GET",
      path: "/v1/teams/:teamId/identity",
      access: { action: "identity.manage" },
      handler: (ctx) =>
        reply(200, {
          simulation: identity.SIMULATION,
          sso: identity.sso(team(ctx), ctx.host),
          scim: identity.scim(team(ctx), ctx.host),
          domains: identity.domains(team(ctx)).domains,
        }),
    },

    // ---- single sign-on ----
    {
      method: "PUT",
      path: "/v1/teams/:teamId/identity/sso",
      access: { action: "identity.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        const input: {
          metadataXml?: string;
          enabled?: boolean;
          jitCreate?: boolean;
          enforce?: boolean;
        } = {};
        if (typeof body["metadataXml"] === "string") input.metadataXml = body["metadataXml"];
        for (const key of ["enabled", "jitCreate", "enforce"] as const)
          if (typeof body[key] === "boolean") input[key] = body[key];
        orThrow(identity.configureSso(me(ctx).id, team(ctx), input));
        return reply(200, identity.sso(team(ctx), ctx.host));
      },
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/identity/sso/test",
      access: { action: "identity.manage" },
      handler: (ctx) => {
        const result = identity.testSso(team(ctx));
        return reply(200, {
          simulation: result.simulation,
          checks: result.checks,
          passed: result.passed,
        });
      },
    },
    {
      // Anyone can start a sign-in for a team that has it on; the answer must come back for it.
      method: "POST",
      path: "/v1/teams/:teamId/identity/sso/start",
      access: "public",
      handler(ctx) {
        const started = orThrow(identity.startSso(team(ctx), ctx.host));
        return reply(200, {
          requestId: started.requestId,
          redirectUrl: started.redirectUrl,
          simulation: started.simulation,
        });
      },
    },
    {
      method: "POST",
      path: "/v1/sso/acs",
      access: "public",
      async handler(ctx) {
        const body = await ctx.json();
        const result = orThrow(
          identity.consumeAssertion(text(body, "samlResponse"), text(body, "clientId")),
        );
        return reply(200, {
          ...result.session,
          teamId: result.teamId,
          created: result.created,
          simulation: result.simulation,
        });
      },
    },
    {
      method: "GET",
      path: "/dev-idp/metadata",
      access: "public",
      handler(ctx) {
        const xml = identity.devMetadata(ctx.host);
        if (xml === null)
          throw new HttpError(404, "not_found", "There is nothing at that address.");
        return {
          status: 200,
          raw: xml,
          headers: { "content-type": "application/xml; charset=utf-8" },
        };
      },
    },
    {
      method: "POST",
      path: "/dev-idp/authorize",
      access: "public",
      async handler(ctx) {
        const body = await ctx.json();
        const result = orThrow(
          identity.devAuthorize(ctx.host, {
            requestId: text(body, "requestId"),
            email: text(body, "email"),
            name: text(body, "name"),
          }),
        );
        return reply(200, {
          samlResponse: result.samlResponse,
          acsUrl: result.acsUrl,
          simulation: result.simulation,
        });
      },
    },

    // ---- SCIM settings ----
    {
      method: "PUT",
      path: "/v1/teams/:teamId/identity/scim",
      access: { action: "identity.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        const input: { enabled?: boolean; groupMap?: unknown } = {};
        if (typeof body["enabled"] === "boolean") input.enabled = body["enabled"];
        if ("groupMap" in body) input.groupMap = body["groupMap"];
        const result = orThrow(identity.configureScim(me(ctx).id, team(ctx), input));
        // The token is in this answer and in no other.
        return reply(200, {
          ...identity.scim(team(ctx), ctx.host),
          ...(result.token ? { token: result.token } : {}),
        });
      },
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/identity/scim/token",
      access: { action: "identity.manage" },
      handler(ctx) {
        const result = orThrow(identity.rotateScimToken(me(ctx).id, team(ctx)));
        return reply(200, { ...identity.scim(team(ctx), ctx.host), token: result.token });
      },
    },

    // ---- domains ----
    {
      method: "GET",
      path: "/v1/teams/:teamId/identity/domains",
      access: { action: "identity.manage" },
      handler: (ctx) => reply(200, identity.domains(team(ctx))),
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/identity/domains",
      access: { action: "identity.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        const result = orThrow(
          identity.addDomain(me(ctx).id, team(ctx), {
            domain: text(body, "domain"),
            defaultRole: body["defaultRole"],
            capture: body["capture"],
            restrictSignup: body["restrictSignup"],
          }),
        );
        return reply(201, result.domain);
      },
    },
    {
      method: "PATCH",
      path: "/v1/teams/:teamId/identity/domains/:domainId",
      access: { action: "identity.manage" },
      async handler(ctx) {
        const body = await ctx.json();
        const result = orThrow(
          identity.updateDomain(me(ctx).id, team(ctx), ctx.params["domainId"]!, {
            defaultRole: body["defaultRole"],
            capture: body["capture"],
            restrictSignup: body["restrictSignup"],
          }),
        );
        return reply(200, result.domain);
      },
    },
    {
      method: "DELETE",
      path: "/v1/teams/:teamId/identity/domains/:domainId",
      access: { action: "identity.manage" },
      handler(ctx) {
        orThrow(identity.removeDomain(me(ctx).id, team(ctx), ctx.params["domainId"]!));
        return reply(204);
      },
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/identity/domains/:domainId/verify",
      access: { action: "identity.manage" },
      async handler(ctx) {
        const result = orThrow(
          await identity.verifyDomain(me(ctx).id, team(ctx), ctx.params["domainId"]!),
        );
        return reply(200, result.domain);
      },
    },

    // ---- for the person themselves ----
    {
      method: "POST",
      path: "/v1/teams/:teamId/domain-join",
      access: "signed_in",
      handler(ctx) {
        const result = orThrow(identity.domainJoin(me(ctx), team(ctx)));
        return reply(202, { requestId: result.requestId, role: result.role });
      },
    },
    {
      method: "GET",
      path: "/v1/me/capture-offers",
      access: "signed_in",
      handler: (ctx) => reply(200, identity.captureOffers(me(ctx))),
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/capture/accept",
      access: "signed_in",
      handler: (ctx) =>
        reply(200, { role: orThrow(identity.acceptCapture(me(ctx), team(ctx))).role }),
    },
    {
      method: "POST",
      path: "/v1/teams/:teamId/capture/decline",
      access: "signed_in",
      handler(ctx) {
        orThrow(identity.declineCapture(me(ctx), team(ctx)));
        return reply(204);
      },
    },
  ];
}
