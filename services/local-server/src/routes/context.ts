import type { Accounts } from "../accounts.ts";
import type { Audit } from "../audit.ts";
import type { Compliance } from "../compliance.ts";
import type { Identity } from "../identity.ts";
import type { Invites } from "../invites.ts";
import type { Network } from "../network.ts";
import type { Policy } from "../policy.ts";
import type { Scim } from "../scim.ts";
import type { Settings } from "../settings.ts";
import type { Siem } from "../siem.ts";
import type { TeamSettings, UsageSettingsStore } from "../team-settings.ts";
import type { Teams } from "../teams.ts";
import type { Usage } from "../usage.ts";
import type { Vocabulary } from "../vocabulary.ts";
import type { Ctx } from "../http.ts";
import { HttpError } from "../http.ts";
import type { UserView } from "../accounts.ts";

/** What the route handlers work with. */
export interface RouteDeps {
  accounts: Accounts;
  audit: Audit;
  siem: Siem;
  settings: Settings;
  teams: Teams;
  invites: Invites;
  teamSettings: TeamSettings;
  vocabulary: Vocabulary;
  policy: Policy;
  usage: Usage;
  identity: Identity;
  scim: Scim;
  compliance: Compliance;
  network: Network;
  usageSettings: UsageSettingsStore;
  /** Whether the SIEM queue is sent as entries are written. */
  autoFlush: boolean;
}

/** The signed-in person of a request that needed one. */
export function me(ctx: Ctx): UserView {
  if (!ctx.user) throw new HttpError(401, "unauthorized", "Sign in first.");
  return ctx.user;
}
