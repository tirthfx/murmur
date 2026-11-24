import type { PlanFeature } from "../../../packages/shared/src/plans.ts";
import type { RouteInfo } from "./http.ts";

/**
 * Which plan feature each route needs (TM-25). The first rule that matches a route's path wins.
 * A route that no rule matches must be in `UNGATED` (accounts, the plan itself), and a test fails
 * for a new route that is in neither, so a feature cannot be added without a decision about it.
 */
const RULES: { test: RegExp; feature: PlanFeature }[] = [
  { test: /^\/v1\/audit\/export$/, feature: "auditExport" },
  { test: /^\/v1\/audit\/siem\//, feature: "auditSiem" },
  { test: /^\/v1\/audit/, feature: "auditLog" },
  { test: /^\/v1\/network\//, feature: "ipAllowlist" },
  { test: /^\/(scim\/|dev-idp\/|v1\/sso\/|v1\/me\/capture-offers)/, feature: "identity" },
  { test: /^\/v1\/teams\/:teamId\/(identity|capture|domain-join)/, feature: "identity" },
  { test: /^\/v1\/teams\/:teamId\/compliance/, feature: "complianceMode" },
  { test: /^\/v1\/teams\/:teamId\/policy/, feature: "policyBasic" },
  {
    test: /^\/v1\/teams\/:teamId\/(dictionary|snippets|vocabulary|skills|folders|content)/,
    feature: "teamVocabulary",
  },
  { test: /^\/v1\/teams\/:teamId\/leaderboard/, feature: "leaderboard" },
  { test: /^\/v1\/teams\/:teamId\/usage/, feature: "usageDashboards" },
  { test: /^\/v1\/(teams|invites|me\/join-requests)/, feature: "teams" },
];

/** Routes that are for every plan: signing in, accounts, and the plan itself. */
export const UNGATED: readonly string[] = [
  "GET /v1/health",
  "POST /v1/setup",
  "POST /v1/sessions",
  "DELETE /v1/sessions/current",
  "POST /v1/admin/session",
  "DELETE /v1/admin/session",
  "POST /v1/admin/mfa/begin",
  "POST /v1/admin/mfa/confirm",
  "POST /v1/admin/mfa/disable",
  "GET /v1/admin/mfa-policy",
  "PUT /v1/admin/mfa-policy",
  "POST /v1/users/:userId/mfa/reset",
  "GET /v1/me",
  "POST /v1/me/password",
  "GET /v1/users",
  "POST /v1/users",
  "GET /v1/plan",
  "PUT /v1/plan",
];

export function gateOf(route: Pick<RouteInfo, "method" | "path">): PlanFeature | null {
  return RULES.find((rule) => rule.test.test(route.path))?.feature ?? null;
}

/** Settings whose change needs more than the basic policy controls (Growth, not Team). */
export const FULL_POLICY_KEYS: readonly string[] = [
  "retention.audio.max",
  "retention.audio.min",
  "retention.transcript.max",
  "retention.transcript.min",
  "blockedDomains",
  "connectors.disabled",
  "connectors.readOnly",
  "deletion.requiresApproval",
];
