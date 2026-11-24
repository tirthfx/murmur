import { describe, expect, it, vi } from "vitest";
import { TEAM_CLIENT_VERSION } from "@murmur/shared";
import {
  createSupabaseTeamClient,
  decodeSupabaseToken,
  encodeSupabaseToken,
  type SupabaseTeamClientDeps,
} from "./supabase-team-client";
import { expectError, expectOk } from "./team-client-contract";

/** What a request looked like, as the fake service saw it. */
interface Call {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = { status: number; json?: unknown; headers?: Record<string, string> };
type Route = (call: Call) => Reply | undefined;

const URL_BASE = "https://abc.supabase.co";

/** A service that answers by the first route that has something to say. */
function setup(routes: Route[], options: { token?: string | null } = {}) {
  const calls: Call[] = [];
  const saved: string[] = [];
  let token: string | null = options.token === undefined ? null : options.token;
  const fetchFake = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const call: Call = {
      method: init?.method ?? "GET",
      url,
      path: url.slice(URL_BASE.length),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    for (const route of routes) {
      const reply = route(call);
      if (reply)
        return new Response(reply.json === undefined ? null : JSON.stringify(reply.json), {
          status: reply.status,
          headers: reply.headers ?? {},
        });
    }
    return new Response(JSON.stringify({ message: "no such route in the fake" }), { status: 404 });
  });
  const deps: SupabaseTeamClientDeps = {
    url: () => URL_BASE,
    anonKey: () => "public-key",
    token: () => token,
    saveToken: (next) => {
      saved.push(next);
      token = next;
    },
    fetch: fetchFake as unknown as typeof fetch,
    networkCheck: () => undefined,
  };
  return {
    client: createSupabaseTeamClient(deps),
    calls,
    saved,
    setToken: (next: string | null) => {
      token = next;
    },
    deps,
  };
}

const rpcRoute =
  (name: string, reply: Reply | ((call: Call) => Reply)): Route =>
  (call) =>
    call.path === `/rest/v1/rpc/${name}`
      ? typeof reply === "function"
        ? reply(call)
        : reply
      : undefined;

const authRoute =
  (path: string, reply: Reply | ((call: Call) => Reply)): Route =>
  (call) =>
    call.path === path ? (typeof reply === "function" ? reply(call) : reply) : undefined;

const sessionBody = (access: string, email = "ada@example.com", name = "Ada") => ({
  access_token: access,
  refresh_token: `refresh-of-${access}`,
  user: { email, user_metadata: { name } },
});

const signed = (access = "access-1") =>
  encodeSupabaseToken({ access, refresh: `refresh-of-${access}` });

describe("the Supabase team client", () => {
  it("is version 1", () => {
    expect(setup([]).client.version).toBe(TEAM_CLIENT_VERSION);
  });

  describe("the session token", () => {
    it("carries both tokens, and a bare string is taken as an access token", () => {
      expect(decodeSupabaseToken(encodeSupabaseToken({ access: "a", refresh: "r" }))).toEqual({
        access: "a",
        refresh: "r",
      });
      expect(decodeSupabaseToken("some.jwt.value")).toEqual({
        access: "some.jwt.value",
        refresh: null,
      });
      expect(decodeSupabaseToken("sb1.not-json")).toEqual({
        access: "sb1.not-json",
        refresh: null,
      });
    });
  });

  describe("health", () => {
    it("says whether there is an owner, asking with the public key only", async () => {
      const { client, calls } = setup([
        rpcRoute("murmur_health", { status: 200, json: { setUp: false } }),
      ]);
      expect(expectOk(await client.health())).toEqual({ setUp: false });
      expect(calls[0]?.headers["apikey"]).toBe("public-key");
      expect(calls[0]?.headers["authorization"]).toBeUndefined();
    });

    it("says when the address is not a Murmur backend, and when it cannot be reached", async () => {
      const wrong = setup([rpcRoute("murmur_health", { status: 404, json: { message: "nope" } })]);
      expectError(await wrong.client.health(), "invalid");
      const gone = setup([]);
      gone.deps.fetch = (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch;
      expectError(await createSupabaseTeamClient(gone.deps).health(), "offline");
    });

    it("says refused, in the guard's words, when Murmur's network rules do not allow the address", async () => {
      const { deps } = setup([]);
      deps.networkCheck = () => {
        throw new Error("Strict local mode: that address is not allowed.");
      };
      const error = expectError(await createSupabaseTeamClient(deps).health(), "refused");
      expect(error.message).toContain("Strict local mode");
    });
  });

  describe("the first account", () => {
    const input = { name: "Ada", email: "ada@example.com", password: "a long enough password" };

    it("refuses a short password before anything is sent", async () => {
      const { client, calls } = setup([]);
      const error = expectError(
        await client.setupOwner({ ...input, password: "short" }),
        "invalid",
      );
      expect(error.message).toMatch(/password/i);
      expect(calls).toEqual([]);
    });

    it("says conflict, without making an account, when there is an owner already", async () => {
      const { client, calls } = setup([
        rpcRoute("murmur_health", { status: 200, json: { setUp: true } }),
      ]);
      expectError(await client.setupOwner(input), "conflict");
      expect(calls.some((c) => c.path.startsWith("/auth/"))).toBe(false);
    });

    it("signs up, claims the owner as that account and returns the session", async () => {
      const { client, calls } = setup([
        rpcRoute("murmur_health", { status: 200, json: { setUp: false } }),
        authRoute("/auth/v1/signup", { status: 200, json: sessionBody("access-1") }),
        rpcRoute("claim_owner", { status: 200, json: { owner: true } }),
      ]);
      const session = expectOk(await client.setupOwner(input));
      expect(session.user).toEqual({ name: "Ada", email: "ada@example.com" });
      expect(decodeSupabaseToken(session.token).access).toBe("access-1");
      const signup = calls.find((c) => c.path === "/auth/v1/signup");
      expect(signup?.body).toEqual({
        email: input.email,
        password: input.password,
        data: { name: "Ada" },
      });
      const claim = calls.find((c) => c.path === "/rest/v1/rpc/claim_owner");
      expect(claim?.headers["authorization"]).toBe("Bearer access-1");
    });

    it("says what to change when the project asks for an email check", async () => {
      const { client } = setup([
        rpcRoute("murmur_health", { status: 200, json: { setUp: false } }),
        authRoute("/auth/v1/signup", { status: 200, json: { id: "u1", email: input.email } }),
      ]);
      const error = expectError(await client.setupOwner(input), "invalid");
      expect(error.message).toMatch(/confirm their email/);
    });

    it("says conflict when someone else claimed the owner first", async () => {
      const { client } = setup([
        rpcRoute("murmur_health", { status: 200, json: { setUp: false } }),
        authRoute("/auth/v1/signup", { status: 200, json: sessionBody("access-1") }),
        rpcRoute("claim_owner", {
          status: 409,
          json: { code: "PT409", message: "This server already has an owner." },
        }),
      ]);
      expectError(await client.setupOwner(input), "conflict");
    });
  });

  describe("signing in and out", () => {
    it("gives a session, and unauthorized in the app's words for a wrong password", async () => {
      const good = setup([
        authRoute("/auth/v1/token?grant_type=password", { status: 200, json: sessionBody("a1") }),
      ]);
      const session = expectOk(
        await good.client.signIn({ email: "ada@example.com", password: "x" }),
      );
      expect(session.user.name).toBe("Ada");
      const bad = setup([
        authRoute("/auth/v1/token?grant_type=password", {
          status: 400,
          json: { error_code: "invalid_credentials", msg: "Invalid login credentials" },
        }),
      ]);
      const error = expectError(
        await bad.client.signIn({ email: "a@b.co", password: "x" }),
        "unauthorized",
      );
      expect(error.message).toBe("The email or the password is not right.");
    });

    it("says how long to wait when the project limits sign-ins", async () => {
      const { client } = setup([
        authRoute("/auth/v1/token?grant_type=password", {
          status: 429,
          json: { error_code: "over_request_rate_limit", msg: "Request rate limit reached" },
          headers: { "retry-after": "42" },
        }),
      ]);
      const error = expectError(
        await client.signIn({ email: "a@b.co", password: "x" }),
        "rate_limited",
      );
      expect(error.retryAfterSeconds).toBe(42);
    });

    it("ends only this session at sign-out, and treats an expired one as ended", async () => {
      const first = setup([authRoute("/auth/v1/logout?scope=local", { status: 204 })], {
        token: signed(),
      });
      expectOk(await first.client.signOut());
      expect(first.calls[0]?.headers["authorization"]).toBe("Bearer access-1");
      const expired = setup(
        [authRoute("/auth/v1/logout?scope=local", { status: 401, json: { msg: "expired" } })],
        {
          token: signed(),
        },
      );
      expectOk(await expired.client.signOut());
      expectOk(await setup([]).client.signOut());
    });
  });

  describe("invites", () => {
    const hire = {
      code: "inv_x",
      name: "New Hire",
      email: "hire@example.com",
      password: "a long enough password",
      signedIn: false,
    };

    it("checks the code before making an account", async () => {
      const { client, calls } = setup([
        rpcRoute("check_invite", {
          status: 404,
          json: { code: "PT404", message: "That invite is not valid, or it has expired." },
        }),
      ]);
      const error = expectError(await client.redeemInvite(hire), "not_found");
      expect(error.message).toMatch(/not valid/);
      expect(calls.some((c) => c.path.startsWith("/auth/"))).toBe(false);
    });

    it("makes the account and joins, as the new account", async () => {
      const { client, calls } = setup([
        rpcRoute("check_invite", { status: 200, json: { teamName: "Acme" } }),
        authRoute("/auth/v1/signup", {
          status: 200,
          json: sessionBody("new-access", "hire@example.com", "New Hire"),
        }),
        rpcRoute("redeem_invite", { status: 200, json: { status: "joined", teamName: "Acme" } }),
      ]);
      const joined = expectOk(await client.redeemInvite(hire));
      expect(joined).toMatchObject({ status: "joined", teamName: "Acme" });
      expect(joined.session?.user.email).toBe("hire@example.com");
      expect(calls.find((c) => c.path.endsWith("redeem_invite"))?.headers["authorization"]).toBe(
        "Bearer new-access",
      );
    });

    it("says pending when an admin has to approve, and conflict when the email has an account", async () => {
      const pending = setup([
        rpcRoute("check_invite", { status: 200, json: { teamName: "Acme" } }),
        authRoute("/auth/v1/signup", { status: 200, json: sessionBody("n") }),
        rpcRoute("redeem_invite", { status: 200, json: { status: "pending", teamName: "Acme" } }),
      ]);
      expect(expectOk(await pending.client.redeemInvite(hire)).status).toBe("pending");
      const taken = setup([
        rpcRoute("check_invite", { status: 200, json: { teamName: "Acme" } }),
        authRoute("/auth/v1/signup", {
          status: 422,
          json: { error_code: "user_already_exists", msg: "User already registered" },
        }),
      ]);
      expectError(await taken.client.redeemInvite(hire), "conflict");
    });

    it("uses the invite as the signed-in person, with no new account", async () => {
      const { client, calls } = setup(
        [rpcRoute("redeem_invite", { status: 200, json: { status: "joined", teamName: "Acme" } })],
        { token: signed("mine") },
      );
      const joined = expectOk(await client.redeemInvite({ code: "inv_x", signedIn: true }));
      expect(joined.session).toBeNull();
      expect(calls.some((c) => c.path.startsWith("/auth/"))).toBe(false);
      expect(calls[0]?.headers["authorization"]).toBe("Bearer mine");
    });
  });

  describe("what a failure means", () => {
    const failing = (status: number, code: string) =>
      setup([rpcRoute("my_teams", { status, json: { code, message: `words for ${code}` } })], {
        token: signed(),
      });

    it.each([
      [403, "PT403", "forbidden"],
      [404, "PT404", "not_found"],
      [409, "PT409", "conflict"],
      [400, "PT400", "invalid"],
      [500, "XX000", "server"],
    ] as const)("maps %s to %s, with the database's own words", async (status, code, expected) => {
      const error = expectError(await failing(status, code).client.teams(), expected);
      expect(error.message).toBe(`words for ${code}`);
    });

    it("says unauthorized with no session, asking without a token, and offline or refused first when that is the case", async () => {
      const none = setup([
        rpcRoute("my_teams", {
          status: 401,
          json: { code: "42501", message: "permission denied for function my_teams" },
        }),
      ]);
      expectError(await none.client.teams(), "unauthorized");
      expect(none.calls).toHaveLength(1);
      expect(none.calls[0]?.headers["authorization"]).toBeUndefined();

      const gone = setup([]);
      gone.deps.fetch = (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch;
      expectError(await createSupabaseTeamClient(gone.deps).teams(), "offline");

      const blocked = setup([]);
      blocked.deps.networkCheck = () => {
        throw new Error("Strict local mode: that address is not allowed.");
      };
      expectError(await createSupabaseTeamClient(blocked.deps).teams(), "refused");
    });
  });

  describe("an expired session", () => {
    const refreshRoute: Route = authRoute("/auth/v1/token?grant_type=refresh_token", (call) =>
      (call.body as { refresh_token: string }).refresh_token === "refresh-of-access-1"
        ? { status: 200, json: { access_token: "access-2", refresh_token: "refresh-of-access-2" } }
        : { status: 400, json: { error_code: "refresh_token_not_found" } },
    );
    const teamsRoute: Route = rpcRoute("my_teams", (call) =>
      call.headers["authorization"] === "Bearer access-2"
        ? { status: 200, json: [{ id: "t1", name: "Acme", myRole: "owner" }] }
        : { status: 401, json: { code: "PGRST301", message: "JWT expired" } },
    );

    it("is renewed inside the client, the new token is handed to the app and the call goes through", async () => {
      const { client, calls, saved } = setup([teamsRoute, refreshRoute], {
        token: signed("access-1"),
      });
      expect(expectOk(await client.teams())).toHaveLength(1);
      expect(saved).toHaveLength(1);
      expect(decodeSupabaseToken(saved[0] ?? "")).toEqual({
        access: "access-2",
        refresh: "refresh-of-access-2",
      });
      expect(calls.map((c) => c.path)).toEqual([
        "/rest/v1/rpc/my_teams",
        "/auth/v1/token?grant_type=refresh_token",
        "/rest/v1/rpc/my_teams",
      ]);
    });

    it("keeps using the renewed session, without renewing again, while the app holds the old token", async () => {
      const { client, calls, saved, setToken } = setup([teamsRoute, refreshRoute], {
        token: signed("access-1"),
      });
      await client.teams();
      setToken(signed("access-1")); // the app has not stored the new token (saveToken did not take)
      expectOk(await client.teams());
      expect(calls.filter((c) => c.path.includes("refresh_token"))).toHaveLength(1);
      expect(saved).toHaveLength(1);
    });

    it("is unauthorized when the refresh token no longer works", async () => {
      const { client, saved } = setup([teamsRoute, refreshRoute], {
        token: encodeSupabaseToken({ access: "access-old", refresh: "revoked" }),
      });
      expectError(await client.teams(), "unauthorized");
      expect(saved).toEqual([]);
    });

    it("is unauthorized, without a renewal, for a token that has no refresh token", async () => {
      const { client, calls } = setup([teamsRoute, refreshRoute], { token: "bare-access-token" });
      expectError(await client.teams(), "unauthorized");
      expect(calls.filter((c) => c.path.includes("refresh_token"))).toEqual([]);
    });
  });

  describe("shared entries and notices", () => {
    it("returns entries with a revision, or the news that nothing moved", async () => {
      const { client, calls } = setup(
        [
          rpcRoute("team_vocabulary", (call) =>
            (call.body as { p_since: number | null }).p_since === 3
              ? { status: 200, json: { unchanged: true } }
              : {
                  status: 200,
                  json: {
                    unchanged: false,
                    revision: 3,
                    context: { me: "Ada", team: "Acme" },
                    dictionary: [
                      { id: "d1", term: "Kubernetes", replacement: null, pronunciation: "" },
                    ],
                    snippets: [],
                  },
                },
          ),
        ],
        { token: signed() },
      );
      const first = expectOk(await client.vocabulary("t1"));
      if (first.unchanged) throw new Error("expected entries");
      expect(first.revision).toBe(3);
      expect(first.context).toEqual({ me: "Ada", team: "Acme" });
      expect(calls[0]?.body).toEqual({ p_team: "t1", p_since: null });
      expect(expectOk(await client.vocabulary("t1", 3))).toEqual({ unchanged: true });
    });

    it("lists the notices and marks them seen", async () => {
      const { client } = setup(
        [
          rpcRoute("my_notices", {
            status: 200,
            json: [{ id: "n1", summary: "Odd", note: "Too generic" }],
          }),
          rpcRoute("mark_notices_seen", { status: 200, json: { marked: 1 } }),
        ],
        { token: signed() },
      );
      expect(expectOk(await client.notices("t1"))).toEqual([
        { id: "n1", summary: "Odd", note: "Too generic" },
      ]);
      expectOk(await client.markNoticesSeen("t1"));
    });

    it("says live or pending for a proposal, sending the right fields for each kind", async () => {
      const { client, calls } = setup(
        [
          rpcRoute("propose_item", (call) => ({
            status: 200,
            json: { live: (call.body as { p_kind: string }).p_kind === "dictionary" },
          })),
        ],
        { token: signed() },
      );
      expect(
        expectOk(
          await client.propose("t1", { kind: "dictionary", term: "Zendesk", replacement: null }),
        ),
      ).toEqual({ live: true });
      expect(
        expectOk(
          await client.propose("t1", { kind: "snippet", trigger: "sig", expansion: "Best" }),
        ),
      ).toEqual({ live: false });
      expect(calls[0]?.body).toEqual({
        p_team: "t1",
        p_kind: "dictionary",
        p_term: "Zendesk",
        p_replacement: null,
      });
      expect(calls[1]?.body).toEqual({
        p_team: "t1",
        p_kind: "snippet",
        p_trigger: "sig",
        p_expansion: "Best",
      });
    });
  });

  describe("policy", () => {
    it("merges the team, department and member layers with the app's own rules", async () => {
      const { client } = setup(
        [
          rpcRoute("policy_layers", {
            status: 200,
            json: {
              revision: 2,
              team: {
                "features.scratchpad": false,
                adminContact: "it@acme.test",
                "made.up.key": 1,
              },
              department: { "retention.audio.max": 7 },
              member: { "retention.audio.max": "not a number" },
            },
          }),
        ],
        { token: signed() },
      );
      const policy = expectOk(await client.policy("t1"));
      expect(policy.features.scratchpad).toBe(false);
      expect(policy.features.notetaker).toBe(true);
      expect(policy.adminContact).toBe("it@acme.test");
      // The department's limit stands; the member's value is not one the app accepts, so it is dropped.
      expect(policy.retention.audio.max).toBe(7);
    });

    it("says forbidden when the plan has no policy", async () => {
      const { client } = setup(
        [
          rpcRoute("policy_layers", {
            status: 403,
            json: { code: "PT403", message: "This is not on the team's plan." },
          }),
        ],
        { token: signed() },
      );
      expectError(await client.policy("t1"), "forbidden");
    });
  });

  describe("usage and the retention report", () => {
    it("sends the batch as it is and the counts under the names the function takes", async () => {
      const { client, calls } = setup(
        [
          rpcRoute("send_usage", { status: 200, json: { accepted: 1, duplicate: false } }),
          rpcRoute("report_retention", { status: 200, json: { recorded: true } }),
        ],
        { token: signed() },
      );
      const events = [{ day: "2026-11-20", metric: "words", count: 120, bucket: "mail" }];
      expectOk(await client.sendUsage("t1", "batch-0001", events));
      expectOk(await client.reportRetention("t1", { audio: 3, transcripts: 5 }));
      expect(calls[0]?.body).toEqual({ p_team: "t1", p_batch: "batch-0001", p_events: events });
      expect(calls[1]?.body).toEqual({ p_team: "t1", p_audio: 3, p_transcripts: 5 });
    });

    it("says invalid for a batch the database refuses, and rate_limited with a wait", async () => {
      const { client } = setup(
        [
          rpcRoute("send_usage", {
            status: 400,
            json: { code: "PT400", message: "An event's day is YYYY-MM-DD." },
          }),
        ],
        { token: signed() },
      );
      expectError(await client.sendUsage("t1", "batch-0003", []), "invalid");
      const limited = setup(
        [rpcRoute("send_usage", { status: 429, json: { message: "slow down" } })],
        { token: signed() },
      );
      const error = expectError(
        await limited.client.sendUsage("t1", "batch-0004", []),
        "rate_limited",
      );
      expect(error.retryAfterSeconds).toBeGreaterThan(0);
    });
  });

  describe("shared Skills and folders", () => {
    const call = (name: string, reply: Reply) => rpcRoute(name, reply);

    it("asks for the content with the revision it has, and reads the answer", async () => {
      const { client, calls } = setup(
        [
          call("team_content", { status: 200, json: { revision: 4, unchanged: true } }),
          call("team_people", {
            status: 200,
            json: [{ userId: "u1", name: "Ada", email: "ada@example.com", role: "owner" }],
          }),
        ],
        { token: signed() },
      );
      expect(expectOk(await client.content("t1", 4))).toEqual({ unchanged: true, revision: 4 });
      expect(calls[0]?.body).toEqual({ p_team: "t1", p_since: 4 });
      expect(expectOk(await client.people("t1"))[0]).toMatchObject({ name: "Ada", role: "owner" });
    });

    it("sends each call under the names the function takes", async () => {
      const ok = (json: unknown): Reply => ({ status: 200, json });
      const { client, calls } = setup(
        [
          call("publish_skill", ok({ skill: { id: "s1", version: 1 } })),
          call("update_skill", ok({ skill: { id: "s1", version: 2 }, changed: true })),
          call("remove_skill", ok({ removed: true })),
          call("create_folder", ok({ folder: { id: "f1" } })),
          call("set_folder_member", ok({ folder: { id: "f1" } })),
          call("share_folder_item", ok({ id: "n1" })),
          call("read_folder_item", ok({ item: { id: "n1", title: "T", body: "B" } })),
          call("remove_folder_item", ok({ removed: true })),
        ],
        { token: signed() },
      );
      expectOk(await client.publishSkill("t1", { name: "A", description: "d", body: "b" }));
      expectOk(await client.updateSkill("t1", "s1", { body: "new" }));
      expectOk(await client.removeSkill("t1", "s1"));
      expectOk(await client.createFolder("t1", { name: "Q4", kind: "shared", members: ["u2"] }));
      expectOk(await client.setFolderMember("t1", "f1", "u2", false));
      expectOk(await client.shareNote("t1", "f1", { title: "T", body: "B", sourceRef: "m:1" }));
      expect(expectOk(await client.readNote("t1", "f1", "n1"))).toMatchObject({ title: "T" });
      expectOk(await client.removeNote("t1", "f1", "n1"));
      expect(calls.map((c) => c.body)).toEqual([
        {
          p_team: "t1",
          p_name: "A",
          p_description: "d",
          p_body: "b",
          p_scope: "company",
          p_department: null,
        },
        { p_team: "t1", p_skill: "s1", p_name: null, p_description: null, p_body: "new" },
        { p_team: "t1", p_skill: "s1" },
        { p_team: "t1", p_name: "Q4", p_kind: "shared", p_department: null, p_members: ["u2"] },
        { p_team: "t1", p_folder: "f1", p_user: "u2", p_can_write: false },
        { p_team: "t1", p_folder: "f1", p_title: "T", p_body: "B", p_source_ref: "m:1" },
        { p_team: "t1", p_folder: "f1", p_item: "n1" },
        { p_team: "t1", p_folder: "f1", p_item: "n1" },
      ]);
    });

    it("maps what the database says to the shared errors", async () => {
      const { client } = setup(
        [
          call("share_folder_item", {
            status: 403,
            json: { code: "PT403", message: "You cannot add to this folder." },
          }),
        ],
        { token: signed() },
      );
      const error = expectError(
        await client.shareNote("t1", "f1", { title: "T", body: "B" }),
        "forbidden",
      );
      expect(error.message).toBe("You cannot add to this folder.");
    });
  });

  describe("changing the password", () => {
    /** An access token whose payload names the person, as Supabase Auth's do. */
    const named = (email: string) => {
      const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      return encodeSupabaseToken({
        access: `${part({ alg: "HS256" })}.${part({ email })}.sig`,
        refresh: null,
      });
    };
    const proof = (status: number): Route =>
      authRoute("/auth/v1/token?grant_type=password", {
        status,
        json: status === 200 ? sessionBody("x") : { error_code: "invalid_credentials" },
      });

    it("checks the current password by signing in with it, then sets the new one as the person", async () => {
      const { client, calls } = setup(
        [proof(200), authRoute("/auth/v1/user", { status: 200, json: { id: "u1" } })],
        { token: named("ada@example.com") },
      );
      expectOk(
        await client.changePassword({ current: "the old password", next: "a brand new password" }),
      );
      expect(calls[0]?.path).toBe("/auth/v1/token?grant_type=password");
      expect(calls[0]?.body).toEqual({ email: "ada@example.com", password: "the old password" });
      expect(calls[1]).toMatchObject({ method: "PUT", path: "/auth/v1/user" });
      expect(calls[1]?.body).toEqual({ password: "a brand new password" });
      expect(calls[1]?.headers["authorization"]).toMatch(/^Bearer /);
    });

    it("says invalid for a wrong current password, and sets nothing", async () => {
      const { client, calls } = setup([proof(400)], { token: named("ada@example.com") });
      const error = expectError(
        await client.changePassword({ current: "wrong wrong wrong", next: "a brand new password" }),
        "invalid",
      );
      expect(error.message).toBe("The current password is not right.");
      expect(calls.some((c) => c.method === "PUT")).toBe(false);
    });

    it("refuses a short new password before anything is sent, and the same one in words", async () => {
      const { client, calls } = setup([], { token: named("ada@example.com") });
      expectError(await client.changePassword({ current: "x", next: "short" }), "invalid");
      expect(calls).toEqual([]);
      const same = setup(
        [
          proof(200),
          authRoute("/auth/v1/user", {
            status: 422,
            json: { error_code: "same_password", msg: "same" },
          }),
        ],
        { token: named("ada@example.com") },
      );
      const error = expectError(
        await same.client.changePassword({ current: "the old password", next: "the old password" }),
        "invalid",
      );
      expect(error.message).toMatch(/not the one you have now/);
    });

    it("says unauthorized with no session, or a token that does not name the person", async () => {
      const none = setup([authRoute("/auth/v1/settings", { status: 200, json: {} })]);
      expectError(
        await none.client.changePassword({ current: "x", next: "a brand new password" }),
        "unauthorized",
      );
      // It still asks the backend something first, so a backend that is down is reported as down.
      expect(none.calls.map((c) => c.path)).toEqual(["/auth/v1/settings"]);
      const anonymous = setup([], { token: signed() });
      expectError(
        await anonymous.client.changePassword({ current: "x", next: "a brand new password" }),
        "unauthorized",
      );
    });
  });

  it("sends the session only as the authorization of a signed-in call", async () => {
    const { client, calls } = setup([rpcRoute("my_teams", { status: 200, json: [] })], {
      token: signed("access-9"),
    });
    await client.teams();
    expect(calls[0]?.headers["authorization"]).toBe("Bearer access-9");
    expect(calls[0]?.headers["apikey"]).toBe("public-key");
  });
});
