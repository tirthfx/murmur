import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MFA, base32Decode, base32Encode, stepOf, totpAt } from "./mfa.ts";
import { PASSWORD, startHarness, type Json } from "./test-helpers.ts";

/**
 * The second step for the admin console: the code is RFC 6238's, a code works once, a recovery
 * code works once, five wrong tries make a wait, and the owner can require it of every console
 * account.
 */
describe("the time-based code", () => {
  // RFC 6238 appendix B, the SHA-1 secret "12345678901234567890", six digits (the last six of its
  // eight-digit values).
  const secret = Buffer.from("12345678901234567890");
  it.each([
    [59, "287082"],
    [1_111_111_109, "081804"],
    [1_111_111_111, "050471"],
    [1_234_567_890, "005924"],
    [2_000_000_000, "279037"],
  ])("is %s seconds -> %s", (seconds, code) => {
    expect(totpAt(secret, Math.floor(seconds / MFA.stepSeconds))).toBe(code);
  });

  it("writes and reads a secret as base32, as authenticator apps do", () => {
    const bytes = Buffer.from("12345678901234567890");
    expect(base32Encode(bytes)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("gezd gnbv-gy3t qojq GEZDGNBVGY3TQOJQ====").equals(bytes)).toBe(true);
    expect(() => base32Decode("not base32 !")).toThrow();
  });
});

let h: Awaited<ReturnType<typeof startHarness>>;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(() => h.close());

const OWNER = "owner@example.com";

async function post(path: string, body: unknown, token?: string) {
  return h.call("POST", path, { body, ...(token ? { token } : {}) });
}
const signIn = (email: string, code?: string, password = PASSWORD) =>
  post("/v1/admin/session", { email, password, ...(code !== undefined ? { code } : {}) });
const codeFor = (secret: string, offset = 0) =>
  totpAt(base32Decode(secret), stepOf(h.clock.now) + offset);

/** Sets up a second step for an account, as the console does, and returns its secret and codes. */
async function enrol(email: string) {
  const begun = await post("/v1/admin/mfa/begin", { email, password: PASSWORD });
  expect(begun.status).toBe(200);
  const secret = begun.json!["secret"] as string;
  const done = await post("/v1/admin/mfa/confirm", {
    email,
    password: PASSWORD,
    code: codeFor(secret),
  });
  expect(done.status).toBe(200);
  return {
    secret,
    recovery: done.json!["recovery"] as string[],
    uri: begun.json!["uri"] as string,
  };
}

/** The next time step, so a code that was used once is not the one tried again. */
const nextStep = () => (h.clock.now += MFA.stepSeconds * 1000);

describe("setting up", () => {
  it("gives a key and an address any authenticator app can read, once", async () => {
    const begun = await post("/v1/admin/mfa/begin", { email: OWNER, password: PASSWORD });
    expect(begun.status).toBe(200);
    expect(begun.json!["secret"]).toMatch(/^[A-Z2-7]{32}$/);
    expect(begun.json!["uri"]).toContain("otpauth://totp/");
    expect(begun.json!["uri"]).toContain(`secret=${begun.json!["secret"]}`);
    expect(begun.json!["uri"]).toContain("digits=6");
    expect(begun.json!["uri"]).toContain("period=30");
  });

  it("asks for the password, and refuses a person who cannot open the console", async () => {
    expect(
      (await post("/v1/admin/mfa/begin", { email: OWNER, password: "not it at all, no" })).status,
    ).toBe(401);
    const stranger = await h.person("Stranger Person");
    const refused = await post("/v1/admin/mfa/begin", {
      email: stranger.email,
      password: PASSWORD,
    });
    expect(refused.status).toBe(403);
    expect(refused.json!["error"].code).toBe("not_admin");
  });

  it("turns on only with a right code, and gives eight recovery codes, once", async () => {
    const begun = await post("/v1/admin/mfa/begin", { email: OWNER, password: PASSWORD });
    const secret = begun.json!["secret"] as string;
    const wrong = await post("/v1/admin/mfa/confirm", {
      email: OWNER,
      password: PASSWORD,
      code: "000000",
    });
    expect(wrong.status).toBe(400);
    expect(wrong.json!["error"].code).toBe("mfa_invalid");
    expect(h.server.mfa.enrolled(h.owner.id)).toBe(false);
    const done = await post("/v1/admin/mfa/confirm", {
      email: OWNER,
      password: PASSWORD,
      code: codeFor(secret),
    });
    expect(done.status).toBe(200);
    expect(done.json!["recovery"]).toHaveLength(MFA.recoveryCodes);
    expect(new Set(done.json!["recovery"]).size).toBe(MFA.recoveryCodes);
    expect(h.server.mfa.enrolled(h.owner.id)).toBe(true);
    // A second set-up is refused while one is on.
    expect((await post("/v1/admin/mfa/begin", { email: OWNER, password: PASSWORD })).status).toBe(
      409,
    );
  });

  it("starting again before finishing gives a new key and drops the old one", async () => {
    const first = (await post("/v1/admin/mfa/begin", { email: OWNER, password: PASSWORD })).json![
      "secret"
    ];
    const second = (await post("/v1/admin/mfa/begin", { email: OWNER, password: PASSWORD })).json![
      "secret"
    ];
    expect(second).not.toBe(first);
    const old = await post("/v1/admin/mfa/confirm", {
      email: OWNER,
      password: PASSWORD,
      code: codeFor(first),
    });
    expect(old.status).toBe(400);
  });
});

describe("signing in to the console", () => {
  it("needs no code until a second step is on", async () => {
    expect((await signIn(OWNER)).status).toBe(200);
  });

  it("asks for the code once a second step is on, and gives no session without it", async () => {
    const { secret } = await enrol(OWNER);
    const without = await signIn(OWNER);
    expect(without.status).toBe(401);
    expect(without.json!["error"].code).toBe("mfa_required");
    const wrong = await signIn(OWNER, "123456");
    expect(wrong.status).toBe(401);
    expect(wrong.json!["error"].code).toBe("mfa_invalid");
    nextStep();
    expect((await signIn(OWNER, codeFor(secret))).status).toBe(200);
  });

  it("makes no session when the code is missing or wrong", async () => {
    await enrol(OWNER);
    await signIn(OWNER);
    await signIn(OWNER, "123456");
    const sessions = h.server.accounts.authenticate(h.owner.token);
    expect(sessions).not.toBeNull(); // the app's own session is untouched
    const open = (
      h.server.db
        .prepare(
          "SELECT COUNT(*) AS n FROM sessions WHERE client_id = 'admin' AND revoked_at IS NULL",
        )
        .get() as { n: number }
    ).n;
    expect(open).toBe(0);
  });

  it("takes a code once: the same code in the same step is refused the second time", async () => {
    const { secret } = await enrol(OWNER);
    nextStep();
    const code = codeFor(secret);
    expect((await signIn(OWNER, code)).status).toBe(200);
    const again = await signIn(OWNER, code);
    expect(again.status).toBe(401);
    expect(again.json!["error"].code).toBe("mfa_invalid");
  });

  it("takes a code from the step before or after, for a clock that is a little off", async () => {
    const { secret } = await enrol(OWNER);
    h.clock.now += 5 * MFA.stepSeconds * 1000;
    expect((await signIn(OWNER, codeFor(secret, -1))).status).toBe(200);
    h.clock.now += 5 * MFA.stepSeconds * 1000;
    expect((await signIn(OWNER, codeFor(secret, 1))).status).toBe(200);
    h.clock.now += 5 * MFA.stepSeconds * 1000;
    expect((await signIn(OWNER, codeFor(secret, 3))).status).toBe(401);
  });

  it("takes a recovery code once", async () => {
    const { recovery } = await enrol(OWNER);
    const code = recovery[0]!;
    expect((await signIn(OWNER, code)).status).toBe(200);
    expect((await signIn(OWNER, code)).status).toBe(401);
    // The others still work, and capitals and a missing dash do not matter.
    expect((await signIn(OWNER, recovery[1]!.toUpperCase().replaceAll("-", " "))).status).toBe(200);
    expect(h.server.mfa.recoveryLeft(h.owner.id)).toBe(MFA.recoveryCodes - 2);
  });

  it("makes a person wait after five wrong codes, and says for how long", async () => {
    const { secret } = await enrol(OWNER);
    let last: Awaited<ReturnType<typeof signIn>> | null = null;
    for (let i = 0; i < MFA.failures; i++) last = await signIn(OWNER, "000000");
    expect(last!.status).toBe(401);
    const wait = await signIn(OWNER, "000000");
    expect(wait.status).toBe(429);
    expect(wait.json!["error"].retryAfterSeconds).toBeGreaterThan(0);
    // Even a right code waits until the time is up, and then it works.
    expect((await signIn(OWNER, codeFor(secret, 1))).status).toBe(429);
    h.clock.now += MFA.delayMs + 1000;
    expect((await signIn(OWNER, codeFor(secret))).status).toBe(200);
  });
});

describe("requiring it of everyone", () => {
  async function admin() {
    const teamId = (
      await h.call("POST", "/v1/teams", { token: h.owner.token, body: { name: "Acme" } })
    ).json!["id"];
    const person = await h.person("Admin Person");
    h.server.teams.addMember(teamId, person.id, "admin", null, {
      actorId: h.owner.id,
      via: "test",
    });
    return person;
  }
  const policy = (token: string, requireMfa: unknown) =>
    h.call("PUT", "/v1/admin/mfa-policy", { token, body: { requireMfa } });

  it("is the server owner's to decide, and the owner must have one first", async () => {
    const person = await admin();
    expect((await h.call("GET", "/v1/admin/mfa-policy", { token: h.owner.token })).json).toEqual({
      requireMfa: false,
    });
    expect((await h.call("GET", "/v1/admin/mfa-policy", { token: person.token })).status).toBe(403);
    expect((await policy(person.token, true)).status).toBe(403);
    const early = await policy(h.owner.token, true);
    expect(early.status).toBe(409);
    expect(early.json!["error"].code).toBe("enroll_first");
    expect((await policy(h.owner.token, "yes")).status).toBe(400);
    await enrol(OWNER);
    expect((await policy(h.owner.token, true)).json).toEqual({ requireMfa: true });
  });

  it("keeps a console account that has none out, until it sets one up", async () => {
    const person = await admin();
    const owner = await enrol(OWNER);
    await policy(h.owner.token, true);
    const refused = await signIn(person.email);
    expect(refused.status).toBe(403);
    expect(refused.json!["error"].code).toBe("mfa_enrollment_required");
    const set = await enrol(person.email);
    nextStep();
    expect((await signIn(person.email, codeFor(set.secret))).status).toBe(200);
    expect((await signIn(OWNER, codeFor(owner.secret))).status).toBe(200);
  });

  it("does not let a person turn off their own while it is required", async () => {
    const owner = await enrol(OWNER);
    await policy(h.owner.token, true);
    nextStep();
    const refused = await post("/v1/admin/mfa/disable", {
      email: OWNER,
      password: PASSWORD,
      code: codeFor(owner.secret),
    });
    expect(refused.status).toBe(403);
    expect(refused.json!["error"].code).toBe("mfa_required_by_owner");
  });

  it("lets a person turn off their own when it is not required, with a code", async () => {
    const owner = await enrol(OWNER);
    const wrong = await post("/v1/admin/mfa/disable", {
      email: OWNER,
      password: PASSWORD,
      code: "000000",
    });
    expect(wrong.status).toBe(401);
    nextStep();
    const off = await post("/v1/admin/mfa/disable", {
      email: OWNER,
      password: PASSWORD,
      code: codeFor(owner.secret),
    });
    expect(off.status).toBe(204);
    expect(h.server.mfa.enrolled(h.owner.id)).toBe(false);
    expect((await signIn(OWNER)).status).toBe(200);
  });

  it("is reset by the owner for a person who lost their phone, and not by anyone else", async () => {
    const person = await admin();
    await enrol(person.email);
    expect(h.server.mfa.enrolled(person.id)).toBe(true);
    expect((await post(`/v1/users/${person.id}/mfa/reset`, {}, person.token)).status).toBe(403);
    expect(h.server.mfa.enrolled(person.id)).toBe(true);
    expect((await post(`/v1/users/${person.id}/mfa/reset`, {}, h.owner.token)).status).toBe(204);
    expect(h.server.mfa.enrolled(person.id)).toBe(false);
    expect((await signIn(person.email)).status).toBe(200);
    expect((await post("/v1/users/nobody/mfa/reset", {}, h.owner.token)).status).toBe(404);
  });
});

describe("what is kept and what is written down", () => {
  it("writes the steps to the audit log, with no key, code or address in it", async () => {
    const { secret, recovery } = await enrol(OWNER);
    nextStep();
    await signIn(OWNER, "000000");
    await signIn(OWNER, recovery[0]!);
    const log = await h.call("GET", "/v1/audit?limit=200", { token: h.owner.token });
    const actions = (log.json!["events"] as Json[]).map((event) => event["action"]);
    expect(actions).toEqual(
      expect.arrayContaining([
        "mfa.enrollment_started",
        "mfa.enrolled",
        "mfa.failed",
        "mfa.recovery_used",
      ]),
    );
    expect(log.raw).not.toContain(secret);
    expect(log.raw).not.toContain("otpauth");
    for (const code of recovery) expect(log.raw).not.toContain(code);
  });

  it("keeps only hashes of the recovery codes, and the key is in no other answer", async () => {
    const { secret, recovery } = await enrol(OWNER);
    const rows = h.server.db.prepare("SELECT code_hash FROM mfa_recovery").all() as {
      code_hash: string;
    }[];
    expect(rows).toHaveLength(MFA.recoveryCodes);
    for (const row of rows) for (const code of recovery) expect(row.code_hash).not.toBe(code);
    for (const path of [
      "/v1/me",
      "/v1/users",
      "/v1/teams",
      "/v1/audit/settings",
      "/v1/admin/mfa-policy",
    ]) {
      const res = await h.call("GET", path, { token: h.owner.token });
      expect(res.raw, path).not.toContain(secret);
    }
  });

  it("has no way for a client to read the key again", () => {
    const routes = h.server.routes.filter((route) => route.path.includes("/mfa"));
    expect(routes.map((route) => `${route.method} ${route.path}`).sort()).toEqual([
      "GET /v1/admin/mfa-policy",
      "POST /v1/admin/mfa/begin",
      "POST /v1/admin/mfa/confirm",
      "POST /v1/admin/mfa/disable",
      "POST /v1/users/:userId/mfa/reset",
      "PUT /v1/admin/mfa-policy",
    ]);
  });
});
