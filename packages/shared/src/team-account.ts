import type { TeamClientResult } from "./team-client";

/**
 * What a person can do to their own account on a team backend: change their password. Like
 * `teamContent.v1` it sits next to the frozen `teamClient.v1` instead of changing it, and a
 * backend implements it or does not.
 *
 * A wrong current password and a new password that is not acceptable are both `invalid`, with
 * the backend's words: `unauthorized` is only for a session that has ended.
 */
export const TEAM_ACCOUNT_VERSION = "teamAccount.v1";

export interface TeamAccountClient {
  readonly accountVersion: typeof TEAM_ACCOUNT_VERSION;
  changePassword(input: { current: string; next: string }): Promise<TeamClientResult<null>>;
}
