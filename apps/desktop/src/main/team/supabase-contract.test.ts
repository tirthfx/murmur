import { describe } from "vitest";
import {
  CONTRACT_PASSWORD,
  describeTeamClientContract,
  type ContractBackend,
} from "./team-client-contract";
import { createSupabaseTeamClient, decodeSupabaseToken } from "./supabase-team-client";
import { describeTeamAccountContract } from "./team-account-contract";
import { describeTeamContentContract } from "./team-content-contract";

/**
 * The contract suite against a real Supabase project (SW-01 phase 2). It runs only when a
 * throwaway test project is configured, because every test starts by emptying it:
 *
 *   MURMUR_SUPABASE_TEST_URL         https://<ref>.supabase.co
 *   MURMUR_SUPABASE_TEST_ANON_KEY    the project's anon or publishable key
 *   MURMUR_SUPABASE_TEST_SERVICE_KEY the service role key (makes test accounts, calls the reset)
 *   MURMUR_SUPABASE_TEST_WIPE        the word "yes": you know the project will be emptied
 *
 * The project needs the migrations and `services/supabase/tests/reset.sql`, with Confirm email off
 * in Authentication. The service key is used here, in a test, and never by the client.
 */
const URL = process.env["MURMUR_SUPABASE_TEST_URL"]?.replace(/\/+$/, "") ?? "";
const ANON = process.env["MURMUR_SUPABASE_TEST_ANON_KEY"] ?? "";
const SERVICE = process.env["MURMUR_SUPABASE_TEST_SERVICE_KEY"] ?? "";
const READY =
  URL !== "" && ANON !== "" && SERVICE !== "" && process.env["MURMUR_SUPABASE_TEST_WIPE"] === "yes";

async function api(
  path: string,
  options: { method?: string; body?: unknown; bearer: string; key?: string },
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${URL}${path}`, {
    method: options.method ?? "POST",
    headers: {
      apikey: options.key ?? ANON,
      authorization: `Bearer ${options.bearer}`,
      "content-type": "application/json",
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as unknown) : null };
}

function unwrap(answer: { status: number; json: unknown }, what: string): unknown {
  if (answer.status >= 300)
    throw new Error(`${what} failed (${answer.status}): ${JSON.stringify(answer.json)}`);
  return answer.json;
}

async function start(): Promise<ContractBackend> {
  unwrap(
    await api("/rest/v1/rpc/murmur_test_reset", { body: {}, bearer: SERVICE, key: SERVICE }),
    "reset",
  );

  const ownerEmail = "owner@example.com";
  const teams: string[] = [];
  let made = 0;
  const clientFor = (token: string | null, address = URL) =>
    createSupabaseTeamClient({
      url: () => address,
      anonKey: () => ANON,
      token: () => token,
      fetch,
      networkCheck: () => undefined,
    });

  /** The owner's session, signed in once and kept for the admin calls. */
  let ownerToken: string | null = null;
  async function owner(): Promise<string> {
    if (ownerToken) return ownerToken;
    const signedIn = await clientFor(null).signIn({
      email: ownerEmail,
      password: CONTRACT_PASSWORD,
    });
    if (!signedIn.ok) throw new Error(`the owner could not sign in: ${signedIn.error.message}`);
    // The client's token holds both tokens; the calls below need the access token.
    ownerToken = decodeSupabaseToken(signedIn.data.token).access;
    return ownerToken;
  }
  const asOwner = async (name: string, args: Record<string, unknown>) =>
    unwrap(await api(`/rest/v1/rpc/${name}`, { body: args, bearer: await owner() }), name);

  return {
    // Supabase Auth limits sign-ins in its own way (a setting of the project).
    capabilities: { signInLockout: false },
    client: (token) => clientFor(token),
    unreachable: () => clientFor(null, "http://127.0.0.1:9"),
    refused: () =>
      createSupabaseTeamClient({
        url: () => URL,
        anonKey: () => ANON,
        token: () => null,
        fetch,
        networkCheck: () => {
          throw new Error("Strict local mode: that address is not allowed.");
        },
      }),
    admin: {
      ownerEmail,
      async createTeam(name) {
        const { id } = (await asOwner("create_team", { p_name: name })) as { id: string };
        teams.push(id);
        return id;
      },
      async addMember(teamId, name, role) {
        made += 1;
        const email = `member${made}@example.com`;
        unwrap(
          await api("/auth/v1/admin/users", {
            body: {
              email,
              password: CONTRACT_PASSWORD,
              email_confirm: true,
              user_metadata: { name },
            },
            bearer: SERVICE,
            key: SERVICE,
          }),
          "make an account",
        );
        await asOwner("add_member", { p_team: teamId, p_email: email, p_role: role });
        return email;
      },
      async createInvite(teamId, approvalRequired) {
        const { code } = (await asOwner("create_invite", {
          p_team: teamId,
          p_role: "member",
          p_approval_required: approvalRequired,
          p_max_uses: 5,
        })) as { code: string };
        return code;
      },
      async setPolicy(teamId, set) {
        await asOwner("set_policy_values", {
          p_team: teamId,
          p_scope: "team",
          p_scope_id: null,
          p_values: set,
        });
      },
      async setPlan(tier) {
        for (const id of teams) await asOwner("set_team_plan", { p_team: id, p_tier: tier });
      },
      async addDictionary(teamId, term) {
        await asOwner("propose_item", { p_team: teamId, p_kind: "dictionary", p_term: term });
      },
      async rejectPending(teamId, note) {
        const rows = unwrap(
          await api(
            `/rest/v1/vocabulary_items?team_id=eq.${teamId}&status=eq.pending&order=created_at.asc&limit=1&select=id`,
            { method: "GET", bearer: await owner() },
          ),
          "find the pending entry",
        ) as { id: string }[];
        const item = rows[0];
        if (!item) throw new Error("there is no pending proposal to reject");
        await asOwner("review_item", {
          p_team: teamId,
          p_item: item.id,
          p_approve: false,
          p_note: note,
        });
      },
      async usageTotal(teamId, metric) {
        const rows = unwrap(
          await api(`/rest/v1/usage_daily?team_id=eq.${teamId}&metric=eq.${metric}&select=count`, {
            method: "GET",
            bearer: await owner(),
          }),
          "read usage",
        ) as { count: number }[];
        return rows.reduce((sum, row) => sum + Number(row.count), 0);
      },
      async retentionReports() {
        const rows = unwrap(
          await api("/rest/v1/audit_events?action=eq.policy.retention_applied&select=seq", {
            method: "GET",
            bearer: await owner(),
          }),
          "read the log",
        ) as unknown[];
        return rows.length;
      },
    },
    close: async () => undefined,
  };
}

// Left out, with a note, unless a test project is configured.
describe.skipIf(!READY)("Supabase test project", () => {
  describeTeamClientContract("Supabase", { start });
  describeTeamContentContract("Supabase", { start });
  describeTeamAccountContract("Supabase", { start });
});
