import type { Accounts } from "../accounts.ts";
import type { Audit } from "../audit.ts";
import type { Invites } from "../invites.ts";
import type { Settings } from "../settings.ts";
import type { Siem } from "../siem.ts";
import type { TeamSettings } from "../team-settings.ts";
import type { Teams } from "../teams.ts";
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
  /** Whether the SIEM queue is sent as entries are written. */
  autoFlush: boolean;
}

/** The signed-in person of a request that needed one. */
export function me(ctx: Ctx): UserView {
  if (!ctx.user) throw new HttpError(401, "unauthorized", "Sign in first.");
  return ctx.user;
}
