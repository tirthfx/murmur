import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  TEAM_CLIENT_VERSION,
  type TeamClient,
  type TeamClientErrorCode,
  type TeamClientResult,
} from "@murmur/shared";

/**
 * The contract every team backend passes (SW-01, SW-08). It talks to the backend only through
 * `TeamClient`; what it needs besides (a team, a member, a policy, a plan) comes from the
 * backend's own `admin`, which is the one place a test knows how a backend is set up. A second
 * backend runs `describeTeamClientContract` with its own fixture and nothing else changes.
 */
export const CONTRACT_PASSWORD = "a long enough password";

export interface ContractAdmin {
  /** The owner made by `client.setupOwner`; the backend's admin calls act as this account. */
  ownerEmail: string;
  createTeam(name: string): Promise<string>;
  /** A member's email, who signs in with `CONTRACT_PASSWORD`. */
  addMember(teamId: string, name: string, role: string): Promise<string>;
  /** A code that joins a team, with or without an admin's approval. */
  createInvite(teamId: string, approvalRequired: boolean): Promise<string>;
  setPolicy(teamId: string, set: Record<string, unknown>): Promise<void>;
  /** Free has no shared vocabulary or policy; this is how a test reaches `forbidden`. */
  setPlan(tier: "free" | "enterprise"): Promise<void>;
  addDictionary(teamId: string, term: string): Promise<void>;
  /** Rejects the oldest pending proposal with a note. */
  rejectPending(teamId: string, note: string): Promise<void>;
  /** What the dashboard totals say for a metric, over all days. */
  usageTotal(teamId: string, metric: string): Promise<number>;
  /** How many retention reports the backend recorded. */
  retentionReports(): Promise<number>;
}

export interface ContractBackend {
  /** A client for this session (null: signed out). */
  client(token: string | null): TeamClient;
  /** A client whose backend cannot be reached. */
  unreachable(): TeamClient;
  /** A client that Murmur's own network rules refuse to use. */
  refused(): TeamClient;
  admin: ContractAdmin;
  close(): Promise<void>;
}

export interface ContractOptions {
  /** A backend with no owner yet. */
  start(): Promise<ContractBackend>;
}

export function expectError<T>(
  result: TeamClientResult<T>,
  code: TeamClientErrorCode,
): { message: string; retryAfterSeconds?: number } {
  expect(result.ok, `expected ${code}`).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.error.code).toBe(code);
  expect(result.error.message.length).toBeGreaterThan(0);
  return result.error;
}

export function expectOk<T>(result: TeamClientResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.data;
}

export function describeTeamClientContract(name: string, options: ContractOptions): void {
  describe(`team client contract: ${name}`, () => {
    let backend: ContractBackend;
    beforeEach(async () => {
      backend = await options.start();
    });
    afterEach(() => backend.close());

    /** The owner signed in, with a team made. */
    async function owner() {
      const anon = backend.client(null);
      const session = expectOk(
        await anon.setupOwner({
          name: "Ada",
          email: backend.admin.ownerEmail,
          password: CONTRACT_PASSWORD,
        }),
      );
      const teamId = await backend.admin.createTeam("Acme");
      return { client: backend.client(session.token), session, teamId };
    }

    async function member(teamId: string, role = "member") {
      const email = await backend.admin.addMember(teamId, `Bea ${role}`, role);
      const session = expectOk(
        await backend.client(null).signIn({ email, password: CONTRACT_PASSWORD }),
      );
      return { client: backend.client(session.token), session, email };
    }

    it("is version 1", () => {
      expect(backend.client(null).version).toBe(TEAM_CLIENT_VERSION);
      expect(TEAM_CLIENT_VERSION).toBe("teamClient.v1");
    });

    describe("the backend and the first account", () => {
      it("says whether there is an owner, and makes one once", async () => {
        const anon = backend.client(null);
        expect(expectOk(await anon.health())).toEqual({ setUp: false });
        const made = expectOk(
          await anon.setupOwner({
            name: "Ada",
            email: backend.admin.ownerEmail,
            password: CONTRACT_PASSWORD,
          }),
        );
        expect(made.user).toEqual({ name: "Ada", email: backend.admin.ownerEmail });
        expect(made.token.length).toBeGreaterThan(10);
        expect(expectOk(await anon.health())).toEqual({ setUp: true });
        expectError(
          await anon.setupOwner({
            name: "Eve",
            email: "eve@example.com",
            password: CONTRACT_PASSWORD,
          }),
          "conflict",
        );
      });

      it("refuses a password that is too short, in words", async () => {
        const error = expectError(
          await backend
            .client(null)
            .setupOwner({ name: "Ada", email: "a@example.com", password: "short" }),
          "invalid",
        );
        expect(error.message).toMatch(/password|character/i);
      });
    });

    describe("signing in", () => {
      it("gives a session for the right password, and unauthorized for the wrong one", async () => {
        const { session } = await owner();
        const again = expectOk(
          await backend
            .client(null)
            .signIn({ email: backend.admin.ownerEmail, password: CONTRACT_PASSWORD }),
        );
        expect(again.user.name).toBe(session.user.name);
        expectError(
          await backend
            .client(null)
            .signIn({ email: backend.admin.ownerEmail, password: "not the password" }),
          "unauthorized",
        );
        expectError(
          await backend
            .client(null)
            .signIn({ email: "nobody@example.com", password: "whatever it is" }),
          "unauthorized",
        );
      });

      it("makes a person wait after five wrong passwords, and says for how long", async () => {
        await owner();
        let last: TeamClientResult<unknown> | null = null;
        for (let i = 0; i < 6; i++)
          last = await backend
            .client(null)
            .signIn({ email: backend.admin.ownerEmail, password: `wrong password ${i}` });
        const error = expectError(last!, "rate_limited");
        expect(error.retryAfterSeconds).toBeGreaterThan(0);
      });

      it("ends the session at sign-out", async () => {
        const { client } = await owner();
        expectOk(await client.teams());
        expectOk(await client.signOut());
        expectError(await client.teams(), "unauthorized");
      });
    });

    describe("teams and shared entries", () => {
      it("lists the teams a person is in, with their role", async () => {
        const { client, teamId } = await owner();
        const teams = expectOk(await client.teams());
        expect(teams).toEqual([
          expect.objectContaining({ id: teamId, name: "Acme", myRole: "owner" }),
        ]);
        const bea = await member(teamId, "viewer");
        expect(expectOk(await bea.client.teams())[0]).toMatchObject({
          id: teamId,
          myRole: "viewer",
        });
      });

      it("refuses a call with no session or a wrong one as unauthorized", async () => {
        const { teamId } = await owner();
        expectError(await backend.client(null).teams(), "unauthorized");
        expectError(await backend.client("not-a-session").vocabulary(teamId), "unauthorized");
      });

      it("returns the shared entries with a revision, and nothing new when it has not moved", async () => {
        const { client, teamId } = await owner();
        await backend.admin.addDictionary(teamId, "Kubernetes");
        const first = expectOk(await client.vocabulary(teamId));
        if (first.unchanged) throw new Error("expected entries");
        expect(first.dictionary.map((entry) => entry.term)).toEqual(["Kubernetes"]);
        expect(first.context.team).toBe("Acme");
        expect(first.revision).toBeGreaterThan(0);
        expect(expectOk(await client.vocabulary(teamId, first.revision))).toEqual({
          unchanged: true,
        });
        await backend.admin.addDictionary(teamId, "Terraform");
        const next = expectOk(await client.vocabulary(teamId, first.revision));
        expect(next.unchanged).toBe(false);
      });

      it("keeps a team's entries from a person who is not in it", async () => {
        const { teamId } = await owner();
        const other = await backend.admin.createTeam("Other");
        const bea = await member(other);
        expectError(await bea.client.vocabulary(teamId), "forbidden");
      });

      it("says forbidden when the plan has no shared entries", async () => {
        const { client, teamId } = await owner();
        await backend.admin.setPlan("free");
        expectError(await client.vocabulary(teamId), "forbidden");
      });
    });

    describe("proposals and notices", () => {
      it("goes live for someone who may approve it, and waits for a review otherwise", async () => {
        const { client, teamId } = await owner();
        expect(
          expectOk(
            await client.propose(teamId, {
              kind: "dictionary",
              term: "Zendesk",
              replacement: null,
            }),
          ),
        ).toEqual({ live: true });
        const bea = await member(teamId);
        expect(
          expectOk(
            await bea.client.propose(teamId, {
              kind: "snippet",
              trigger: "sig",
              expansion: "Best, Bea",
            }),
          ),
        ).toEqual({ live: false });
      });

      it("says conflict for a duplicate, and invalid for what is not acceptable", async () => {
        const { client, teamId } = await owner();
        expectOk(
          await client.propose(teamId, { kind: "dictionary", term: "Zendesk", replacement: null }),
        );
        expectError(
          await client.propose(teamId, { kind: "dictionary", term: "zendesk", replacement: null }),
          "conflict",
        );
        expectError(
          await client.propose(teamId, { kind: "dictionary", term: "   ", replacement: null }),
          "invalid",
        );
      });

      it("tells a person their proposal was turned down until they mark it seen", async () => {
        const { teamId } = await owner();
        const bea = await member(teamId);
        expectOk(
          await bea.client.propose(teamId, { kind: "dictionary", term: "Odd", replacement: null }),
        );
        await backend.admin.rejectPending(teamId, "Too generic");
        const notices = expectOk(await bea.client.notices(teamId));
        expect(notices).toEqual([expect.objectContaining({ summary: "Odd", note: "Too generic" })]);
        expectOk(await bea.client.markNoticesSeen(teamId));
        expect(expectOk(await bea.client.notices(teamId))).toEqual([]);
      });
    });

    describe("policy", () => {
      it("gives the policy that applies to the person", async () => {
        const { client, teamId } = await owner();
        await backend.admin.setPolicy(teamId, {
          "features.scratchpad": false,
          blockedDomains: ["blocked.example"],
          "retention.audio.max": 7,
          adminContact: "it@acme.test",
        });
        const policy = expectOk(await client.policy(teamId));
        expect(policy.features.scratchpad).toBe(false);
        expect(policy.features.notetaker).toBe(true);
        expect(policy.blockedDomains).toEqual(["blocked.example"]);
        expect(policy.retention.audio.max).toBe(7);
        expect(policy.adminContact).toBe("it@acme.test");
      });

      it("says forbidden when the plan has no policy, and unauthorized with no session", async () => {
        const { client, teamId } = await owner();
        await backend.admin.setPlan("free");
        expectError(await client.policy(teamId), "forbidden");
        expectError(await backend.client(null).policy(teamId), "unauthorized");
      });
    });

    describe("usage and the retention report", () => {
      it("counts a batch once, however often it is sent", async () => {
        const { client, teamId } = await owner();
        const events = [
          { day: "2026-11-20", metric: "words", count: 120, bucket: "mail" },
          { day: "2026-11-20", metric: "dictations", count: 6, bucket: "mail" },
        ];
        expectOk(await client.sendUsage(teamId, "batch-0001", events));
        expectOk(await client.sendUsage(teamId, "batch-0001", events));
        expect(await backend.admin.usageTotal(teamId, "words")).toBe(120);
        expectOk(
          await client.sendUsage(teamId, "batch-0002", [
            { day: "2026-11-21", metric: "words", count: 30 },
          ]),
        );
        expect(await backend.admin.usageTotal(teamId, "words")).toBe(150);
      });

      it("refuses a batch that is not acceptable as invalid", async () => {
        const { client, teamId } = await owner();
        expectError(
          await client.sendUsage(teamId, "batch-0003", [
            { day: "yesterday", metric: "nonsense", count: -1 },
          ]),
          "invalid",
        );
      });

      it("records that retention ran under a limit, with counts only", async () => {
        const { client, teamId } = await owner();
        await backend.admin.setPolicy(teamId, { "retention.audio.max": 7 });
        expectOk(await client.reportRetention(teamId, { audio: 3, transcripts: 5 }));
        expect(await backend.admin.retentionReports()).toBe(1);
      });
    });

    describe("invites", () => {
      it("makes an account and joins at once, or asks to join when approval is needed", async () => {
        const { teamId } = await owner();
        const open = await backend.admin.createInvite(teamId, false);
        const joined = expectOk(
          await backend.client(null).redeemInvite({
            code: open,
            name: "New Hire",
            email: "hire@example.com",
            password: CONTRACT_PASSWORD,
            signedIn: false,
          }),
        );
        expect(joined).toMatchObject({ status: "joined", teamName: "Acme" });
        expect(joined.session?.user.email).toBe("hire@example.com");
        expect(expectOk(await backend.client(joined.session!.token).teams())).toHaveLength(1);

        const gated = await backend.admin.createInvite(teamId, true);
        const asked = expectOk(
          await backend.client(null).redeemInvite({
            code: gated,
            name: "Second",
            email: "second@example.com",
            password: CONTRACT_PASSWORD,
            signedIn: false,
          }),
        );
        expect(asked.status).toBe("pending");
      });

      it("says why a code did not work", async () => {
        await owner();
        const error = expectError(
          await backend.client(null).redeemInvite({
            code: "inv_not_a_real_code",
            name: "X",
            email: "x@example.com",
            password: CONTRACT_PASSWORD,
            signedIn: false,
          }),
          "not_found",
        );
        expect(error.message.length).toBeGreaterThan(5);
      });
    });

    describe("a backend that cannot be used", () => {
      it("says offline when it cannot be reached, for every kind of call", async () => {
        const gone = backend.unreachable();
        expectError(await gone.health(), "offline");
        expectError(await gone.signIn({ email: "a@b.co", password: "x" }), "offline");
        expectError(await gone.teams(), "offline");
        expectError(await gone.vocabulary("t"), "offline");
        expectError(await gone.sendUsage("t", "b", []), "offline");
      });

      it("says refused when Murmur's own network rules do not allow the address", async () => {
        const blocked = backend.refused();
        expectError(await blocked.health(), "refused");
        expectError(await blocked.teams(), "refused");
      });
    });
  });
}
