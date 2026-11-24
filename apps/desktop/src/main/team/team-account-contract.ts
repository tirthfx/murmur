import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { TEAM_ACCOUNT_VERSION, type TeamAccountClient, type TeamClient } from "@murmur/shared";
import {
  CONTRACT_PASSWORD,
  expectError,
  expectOk,
  type ContractBackend,
  type ContractOptions,
} from "./team-client-contract";

/**
 * The contract for a person's own account (`teamAccount.v1`): changing their password. It runs
 * on the same fixture as the team client contract.
 */
type Client = TeamClient & TeamAccountClient;

const withAccount = (client: TeamClient): Client => {
  if (!("accountVersion" in client)) throw new Error("This client has no account actions.");
  return client as Client;
};

const NEW_PASSWORD = "another long enough password";

export function describeTeamAccountContract(name: string, options: ContractOptions): void {
  describe(`team account contract: ${name}`, () => {
    let backend: ContractBackend;
    beforeEach(async () => {
      backend = await options.start();
    });
    afterEach(() => backend.close());

    async function owner() {
      const session = expectOk(
        await backend.client(null).setupOwner({
          name: "Ada",
          email: backend.admin.ownerEmail,
          password: CONTRACT_PASSWORD,
        }),
      );
      return { client: withAccount(backend.client(session.token)), email: session.user.email };
    }

    it("is version 1", async () => {
      const { client } = await owner();
      expect(client.accountVersion).toBe(TEAM_ACCOUNT_VERSION);
      expect(TEAM_ACCOUNT_VERSION).toBe("teamAccount.v1");
    });

    it("changes the password: the new one signs in and the old one does not", async () => {
      const { client, email } = await owner();
      expectOk(await client.changePassword({ current: CONTRACT_PASSWORD, next: NEW_PASSWORD }));
      expectOk(await backend.client(null).signIn({ email, password: NEW_PASSWORD }));
      expectError(
        await backend.client(null).signIn({ email, password: CONTRACT_PASSWORD }),
        "unauthorized",
      );
    });

    it("says invalid, in words, for a wrong current password, a short new one and the same one", async () => {
      const { client } = await owner();
      const wrong = expectError(
        await client.changePassword({ current: "not the password at all", next: NEW_PASSWORD }),
        "invalid",
      );
      expect(wrong.message).toMatch(/password/i);
      expectError(
        await client.changePassword({ current: CONTRACT_PASSWORD, next: "short" }),
        "invalid",
      );
      expectError(
        await client.changePassword({ current: CONTRACT_PASSWORD, next: CONTRACT_PASSWORD }),
        "invalid",
      );
    });

    it("says unauthorized with no session, and offline or refused when that is the case", async () => {
      await owner();
      expectError(
        await withAccount(backend.client(null)).changePassword({
          current: CONTRACT_PASSWORD,
          next: NEW_PASSWORD,
        }),
        "unauthorized",
      );
      expectError(
        await withAccount(backend.unreachable()).changePassword({
          current: "x",
          next: NEW_PASSWORD,
        }),
        "offline",
      );
      expectError(
        await withAccount(backend.refused()).changePassword({ current: "x", next: NEW_PASSWORD }),
        "refused",
      );
    });
  });
}
