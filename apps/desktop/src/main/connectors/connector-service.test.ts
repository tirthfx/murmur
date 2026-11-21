import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Keychain } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createConnectorService, type ConnectorService } from "./connector-service";
import { createConnectorStore } from "./connector-store";
import { createConnectorRegistry, type ConnectorProvider } from "./providers";

const HOST = "https://fake.test";

/** A provider's servers: sign-in codes, tokens, the account's email, an API and revoke. */
class FakeProvider {
  now = 1_000_000;
  /** The account that signs in next. */
  nextEmail = "a@example.com";
  tokenCalls: Record<string, string>[] = [];
  revokeCalls: Record<string, string>[] = [];
  userinfoCalls = 0;
  failRefresh: number | null = null;
  failRevoke = false;
  /** Makes the provider refuse the sign-in code with this answer. */
  refuseCode: { status: number; body: object } | null = null;
  refreshTokenInResponse = false;
  expiresIn: number | undefined = 3600;
  private counter = 0;
  private codes = new Map<string, { challenge: string; email: string }>();
  private access = new Map<string, { email: string; expiresAt: number }>();
  private grants = new Map<string, string>();

  /** What the browser does at the provider's page: the owner signs in and is sent back. */
  issueCode(challenge: string): string {
    const code = `code-${++this.counter}`;
    this.codes.set(code, { challenge, email: this.nextEmail });
    return code;
  }

  revokeGrant(refreshToken: string) {
    this.grants.delete(refreshToken);
  }

  expireAccessTokens() {
    for (const entry of this.access.values()) entry.expiresAt = this.now;
  }

  private issue(email: string, withRefresh: boolean): Response {
    const accessToken = `access-${++this.counter}`;
    this.access.set(accessToken, {
      email,
      expiresAt: this.now + (this.expiresIn ?? 3600) * 1000,
    });
    const body: Record<string, unknown> = { access_token: accessToken, scope: "read write" };
    if (this.expiresIn !== undefined) body.expires_in = this.expiresIn;
    if (withRefresh) {
      const refreshToken = `refresh-${++this.counter}`;
      this.grants.set(refreshToken, email);
      body.refresh_token = refreshToken;
    }
    return Response.json(body);
  }

  readonly http = async (url: string, init?: RequestInit): Promise<Response> => {
    await Promise.resolve();
    const headers = new Headers(init?.headers);
    const bearer = headers.get("authorization")?.replace("Bearer ", "") ?? "";
    const valid = (token: string) => {
      const entry = this.access.get(token);
      return entry && entry.expiresAt > this.now ? entry : null;
    };
    if (url === `${HOST}/token`) {
      const body = Object.fromEntries(new URLSearchParams(String(init?.body)));
      this.tokenCalls.push(body);
      if (body.grant_type === "authorization_code") {
        if (this.refuseCode)
          return Response.json(this.refuseCode.body, { status: this.refuseCode.status });
        const issued = this.codes.get(body.code!);
        const verified =
          issued &&
          createHash("sha256").update(body.code_verifier!).digest("base64url") === issued.challenge;
        if (!issued || !verified) return Response.json({ error: "invalid_grant" }, { status: 400 });
        this.codes.delete(body.code!);
        return this.issue(issued.email, true);
      }
      if (this.failRefresh !== null)
        return Response.json({ error: "server_error" }, { status: this.failRefresh });
      const email = this.grants.get(body.refresh_token!);
      if (!email) return Response.json({ error: "invalid_grant" }, { status: 400 });
      return this.issue(email, this.refreshTokenInResponse);
    }
    if (url === `${HOST}/userinfo`) {
      this.userinfoCalls++;
      const entry = valid(bearer);
      return entry ? Response.json({ email: entry.email }) : new Response("no", { status: 401 });
    }
    if (url === `${HOST}/revoke`) {
      this.revokeCalls.push(Object.fromEntries(new URLSearchParams(String(init?.body))));
      if (this.failRevoke) return new Response("no", { status: 500 });
      for (const token of [...this.grants.keys()])
        if (token === new URLSearchParams(String(init?.body)).get("token"))
          this.grants.delete(token);
      return new Response("", { status: 200 });
    }
    if (url === `${HOST}/api`) {
      return valid(bearer) ? Response.json({ ok: true }) : new Response("no", { status: 401 });
    }
    return new Response("not found", { status: 404 });
  };
}

class FakeKeychain implements Keychain {
  items = new Map<string, string>();
  failGet = false;
  failSet = false;
  failDelete = false;
  async get(service: string, account: string) {
    if (this.failGet) throw new Error("locked");
    return this.items.get(`${service}|${account}`) ?? null;
  }
  async set(service: string, account: string, value: string) {
    if (this.failSet) throw new Error("denied");
    this.items.set(`${service}|${account}`, value);
  }
  async delete(service: string, account: string) {
    if (this.failDelete) throw new Error("denied");
    return this.items.delete(`${service}|${account}`);
  }
}

const provider = (over: Partial<ConnectorProvider> = {}): ConnectorProvider => ({
  id: "fake",
  name: "Fakebook",
  authorizeUrl: `${HOST}/authorize`,
  tokenUrl: `${HOST}/token`,
  revokeUrl: `${HOST}/revoke`,
  scopes: ["read"],
  authorizeParams: { access_type: "offline" },
  loopbackPort: null,
  accountLabel: async ({ token, http }) => {
    const response = await http(`${HOST}/userinfo`, {
      headers: { authorization: `Bearer ${token.accessToken}` },
    });
    return ((await response.json()) as { email: string }).email;
  },
  ...over,
});

type BrowserStep = (url: URL, fake: FakeProvider) => Promise<void>;

/** The owner approves: the browser goes to the redirect address with a code and the state. */
const approve: BrowserStep = async (url, fake) => {
  const code = fake.issueCode(url.searchParams.get("code_challenge")!);
  await fetch(
    `${url.searchParams.get("redirect_uri")}?code=${code}&state=${url.searchParams.get("state")}`,
  );
};

function setup(
  over: {
    provider?: Partial<ConnectorProvider>;
    clientId?: string | null;
    browser?: BrowserStep;
  } = {},
) {
  const db = openDatabase(":memory:");
  const store = createConnectorStore(db);
  const fake = new FakeProvider();
  const keychain = new FakeKeychain();
  const logs: string[] = [];
  const opened: URL[] = [];
  let browser = over.browser ?? approve;
  let ids = 0;
  const service: ConnectorService = createConnectorService({
    registry: createConnectorRegistry([provider(over.provider)]),
    store,
    keychain,
    config: {
      clientId: () => (over.clientId === undefined ? "client-1" : over.clientId),
      clientSecret: async () => "secret-1",
    },
    http: fake.http,
    openExternal: async (url) => {
      const parsed = new URL(url);
      opened.push(parsed);
      // The browser answers a moment later, as a person would.
      void browser(parsed, fake);
    },
    now: () => fake.now,
    newId: () => `acct-${++ids}`,
    logger: {
      info: (m) => logs.push(m),
      warn: (m) => logs.push(m),
      error: (m) => logs.push(m),
    },
  });
  return {
    db,
    store,
    fake,
    keychain,
    service,
    logs,
    opened,
    setBrowser: (step: BrowserStep) => (browser = step),
  };
}

async function connected(t: ReturnType<typeof setup>, email = "a@example.com") {
  t.fake.nextEmail = email;
  const outcome = await t.service.connect("fake");
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.account;
}

const blobOf = (t: ReturnType<typeof setup>, email = "a@example.com") =>
  JSON.parse(t.keychain.items.get(`com.murmur.connector.fake|${email}`)!) as {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: number | null;
  };

describe("connecting (CN-01)", () => {
  it("opens the system browser with PKCE, a state and a loopback redirect, then keeps the tokens in the Keychain", async () => {
    const t = setup();
    const outcome = await t.service.connect("fake");
    expect(outcome).toMatchObject({
      ok: true,
      account: {
        id: "acct-1",
        connector: "fake",
        email: "a@example.com",
        status: "connected",
        scopes: ["read", "write"],
      },
    });
    expect(t.opened).toHaveLength(1);
    const url = t.opened[0]!;
    expect(`${url.origin}${url.pathname}`).toBe(`${HOST}/authorize`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "client-1",
      scope: "read",
      code_challenge_method: "S256",
      access_type: "offline",
    });
    expect(url.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{32}$/);
    // The code was only accepted because the verifier matched the challenge (see FakeProvider).
    expect(t.fake.tokenCalls[0]).toMatchObject({
      grant_type: "authorization_code",
      client_id: "client-1",
    });
    expect(t.fake.tokenCalls[0]!.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(blobOf(t)).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-3" });
    expect(t.service.list()).toHaveLength(1);
  });

  it("asks for the scopes it is given, and passes a login hint", async () => {
    const t = setup();
    await t.service.connect("fake", { scopes: ["read", "draft"], loginHint: "a@example.com" });
    expect(t.opened[0]!.searchParams.get("scope")).toBe("read draft");
    expect(t.opened[0]!.searchParams.get("login_hint")).toBe("a@example.com");
  });

  it("sends a client secret only for providers that need one", async () => {
    const t = setup({ provider: { needsClientSecret: true } });
    await t.service.connect("fake");
    expect(t.fake.tokenCalls[0]).toMatchObject({ client_secret: "secret-1" });
    const plain = setup();
    await plain.service.connect("fake");
    expect(plain.fake.tokenCalls[0]).not.toHaveProperty("client_secret");
  });

  it("does nothing until the OAuth client id is added, and for an unknown connector", async () => {
    const t = setup({ clientId: null });
    expect(await t.service.connect("fake")).toMatchObject({ ok: false, reason: "not-configured" });
    expect(await t.service.connect("nope")).toMatchObject({ ok: false, reason: "failed" });
    expect(t.opened).toHaveLength(0);
    expect(t.service.providers()).toEqual([
      { id: "fake", name: "Fakebook", scopes: ["read"], configured: false },
    ]);
  });

  it("names localhost in the redirect for a provider that registers it, and shows the provider's reason for a refused code", async () => {
    const t = setup({ provider: { redirectHost: "localhost" } });
    expect((await t.service.connect("fake")).ok).toBe(true);
    expect(t.opened[0]!.searchParams.get("redirect_uri")).toMatch(
      /^http:\/\/localhost:\d+\/callback$/,
    );
    expect(t.fake.tokenCalls[0]!.redirect_uri).toMatch(/^http:\/\/localhost:/);
    const failing = setup();
    failing.fake.refuseCode = {
      status: 400,
      body: {
        error: "invalid_request",
        error_description: "AADSTS70000: The code was used already.",
      },
    };
    expect(await failing.service.connect("fake")).toMatchObject({
      ok: false,
      message: "Fakebook did not accept the sign-in: AADSTS70000: The code was used already.",
    });
  });

  it("is refused while strict local mode is on, before anything is opened", async () => {
    const t = setup();
    const service = createConnectorService({
      registry: createConnectorRegistry([provider()]),
      store: t.store,
      keychain: t.keychain,
      config: { clientId: () => "c", clientSecret: async () => null },
      http: t.fake.http,
      openExternal: async () => undefined,
      networkRefusal: () => "Strict local mode is on.",
      now: () => 1,
      newId: () => "x",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    expect(await service.connect("fake")).toEqual({
      ok: false,
      reason: "failed",
      message: "Strict local mode is on.",
    });
    expect(t.fake.tokenCalls).toHaveLength(0);
  });

  it("ignores an answer with the wrong state, and keeps nothing", async () => {
    const t = setup({
      browser: async (url, fake) => {
        const code = fake.issueCode(url.searchParams.get("code_challenge")!);
        await fetch(`${url.searchParams.get("redirect_uri")}?code=${code}&state=forged`);
      },
    });
    expect(await t.service.connect("fake")).toMatchObject({ ok: false, reason: "state" });
    expect(t.fake.tokenCalls).toHaveLength(0);
    expect(t.keychain.items.size).toBe(0);
    expect(t.service.list()).toEqual([]);
  });

  it("reports a refused sign-in", async () => {
    const t = setup({
      browser: async (url) => {
        await fetch(
          `${url.searchParams.get("redirect_uri")}?error=access_denied&state=${url.searchParams.get("state")}`,
        );
      },
    });
    expect(await t.service.connect("fake")).toMatchObject({ ok: false, reason: "denied" });
  });

  it("allows one sign-in at a time for a provider, and can cancel it", async () => {
    const t = setup({ browser: async () => undefined });
    const first = t.service.connect("fake");
    await vi.waitFor(() => expect(t.opened).toHaveLength(1));
    expect(await t.service.connect("fake")).toMatchObject({ ok: false, reason: "busy" });
    expect(t.service.isConnecting("fake")).toBe(true);
    t.service.cancelConnect("fake");
    expect(await first).toMatchObject({ ok: false, reason: "cancelled" });
    expect(t.service.isConnecting("fake")).toBe(false);
    // And it can start again.
    t.setBrowser(approve);
    expect(await t.service.connect("fake")).toMatchObject({ ok: true });
  });

  it("fails clearly when the browser cannot be opened, the code is refused or the Keychain fails", async () => {
    const closed = setup();
    const broken = createConnectorService({
      registry: createConnectorRegistry([provider()]),
      store: closed.store,
      keychain: closed.keychain,
      config: { clientId: () => "c", clientSecret: async () => null },
      http: closed.fake.http,
      openExternal: async () => {
        throw new Error("no browser");
      },
      now: () => 1,
      newId: () => "x",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    expect(await broken.connect("fake")).toMatchObject({
      ok: false,
      message: "Murmur could not open your browser.",
    });

    // An administrator's consent: the provider's words are shown.
    const consent = setup({
      browser: async (url) => {
        await fetch(
          `${url.searchParams.get("redirect_uri")}?error=access_denied&error_description=${encodeURIComponent("AADSTS65001: Needs admin consent.")}&state=${url.searchParams.get("state")}`,
        );
      },
    });
    expect(await consent.service.connect("fake")).toMatchObject({
      ok: false,
      message: "The provider refused the sign-in: AADSTS65001: Needs admin consent.",
    });

    const refused = setup({
      browser: async (url) => {
        await fetch(
          `${url.searchParams.get("redirect_uri")}?code=never-issued&state=${url.searchParams.get("state")}`,
        );
      },
    });
    expect(await refused.service.connect("fake")).toMatchObject({
      ok: false,
      message: "Fakebook did not accept the sign-in: invalid_grant",
    });

    const locked = setup();
    locked.keychain.failSet = true;
    expect(await locked.service.connect("fake")).toMatchObject({
      ok: false,
      message: "Murmur could not save the sign-in to the Keychain.",
    });
    expect(locked.service.list()).toEqual([]);
  });

  it("connects two accounts of one provider, and connecting the same email again reconnects it", async () => {
    const t = setup();
    const a = await connected(t, "a@example.com");
    const b = await connected(t, "b@example.com");
    expect([a.id, b.id]).toEqual(["acct-1", "acct-2"]);
    expect(t.service.list().map((x) => x.email)).toEqual(["a@example.com", "b@example.com"]);
    expect(t.keychain.items.size).toBe(2);
    const again = await connected(t, "a@example.com");
    expect(again.id).toBe("acct-1");
    expect(t.service.list()).toHaveLength(2);
  });
});

describe("tokens stay out of the database, the logs and the window (CN-01)", () => {
  it("leaves no token in any table or log, through connect, refresh and disconnect", async () => {
    const t = setup();
    const account = await connected(t);
    const tokens = new Set<string>();
    const remember = () => {
      const blob = blobOf(t);
      tokens.add(blob.accessToken);
      if (blob.refreshToken) tokens.add(blob.refreshToken);
    };
    remember();
    t.fake.now += 59 * 60_000;
    await t.service.accessToken(account.id);
    remember();
    await t.service.authorizedFetch(account.id, `${HOST}/api`);
    await t.service.disconnect(account.id);
    expect(tokens.size).toBeGreaterThanOrEqual(3);

    const tables = (
      t.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    const dump = JSON.stringify(
      Object.fromEntries(
        tables.map((name) => [name, t.db.prepare(`SELECT * FROM "${name}"`).all()]),
      ),
    );
    const logged = t.logs.join("\n");
    for (const token of tokens) {
      expect(dump).not.toContain(token);
      expect(logged).not.toContain(token);
    }
    // The account row is the only place the email is, and the logs name an id instead.
    expect(logged).not.toContain("a@example.com");
  });

  it("never gives the window an object with a token: an account has no token field", async () => {
    const t = setup();
    const account = await connected(t);
    expect(Object.keys(account).sort()).toEqual(
      [
        "connector",
        "createdAt",
        "email",
        "id",
        "lastSyncAt",
        "scopes",
        "status",
        "statusReason",
      ].sort(),
    );
  });
});

describe("refreshing (CN-01)", () => {
  it("uses the token while it is good, and renews it when it ends within 5 minutes", async () => {
    const t = setup();
    const account = await connected(t);
    const first = blobOf(t);
    t.fake.now += 54 * 60_000; // 6 minutes left
    expect(await t.service.accessToken(account.id)).toBe(first.accessToken);
    expect(t.fake.tokenCalls).toHaveLength(1);
    t.fake.now += 2 * 60_000; // 4 minutes left
    const renewed = await t.service.accessToken(account.id);
    expect(renewed).not.toBe(first.accessToken);
    expect(t.fake.tokenCalls).toHaveLength(2);
    expect(t.fake.tokenCalls[1]).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: first.refreshToken,
    });
    // The provider sent no new refresh token: the old one is kept.
    expect(blobOf(t)).toMatchObject({ accessToken: renewed, refreshToken: first.refreshToken });
  });

  it("takes a new refresh token when the provider sends one", async () => {
    const t = setup();
    t.fake.refreshTokenInResponse = true;
    const account = await connected(t);
    const first = blobOf(t);
    t.fake.now += 58 * 60_000;
    await t.service.accessToken(account.id);
    expect(blobOf(t).refreshToken).not.toBe(first.refreshToken);
  });

  it("refreshes once for callers that ask together", async () => {
    const t = setup();
    const account = await connected(t);
    t.fake.now += 58 * 60_000;
    const tokens = await Promise.all(
      Array.from({ length: 6 }, () => t.service.accessToken(account.id)),
    );
    expect(new Set(tokens).size).toBe(1);
    expect(t.fake.tokenCalls.filter((c) => c.grant_type === "refresh_token")).toHaveLength(1);
  });

  it("refreshes one account without touching the other", async () => {
    const t = setup();
    const a = await connected(t, "a@example.com");
    const b = await connected(t, "b@example.com");
    const before = blobOf(t, "b@example.com");
    t.fake.now += 58 * 60_000;
    await t.service.accessToken(a.id);
    expect(t.fake.tokenCalls.filter((c) => c.grant_type === "refresh_token")).toHaveLength(1);
    expect(blobOf(t, "b@example.com")).toEqual(before);
    expect(t.service.list().find((x) => x.id === b.id)?.status).toBe("connected");
  });

  it("renews once on a 401 and asks again, for one caller or several at once", async () => {
    const t = setup();
    const account = await connected(t);
    t.fake.expireAccessTokens(); // the provider stops accepting the token early
    const reply = await t.service.authorizedFetch(account.id, `${HOST}/api`);
    expect(reply.status).toBe(200);
    expect(t.fake.tokenCalls.filter((c) => c.grant_type === "refresh_token")).toHaveLength(1);

    t.fake.expireAccessTokens();
    const replies = await Promise.all(
      Array.from({ length: 4 }, () => t.service.authorizedFetch(account.id, `${HOST}/api`)),
    );
    expect(replies.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(t.fake.tokenCalls.filter((c) => c.grant_type === "refresh_token")).toHaveLength(2);
  });

  it("sends the token as a bearer header and keeps the caller's own headers", async () => {
    const t = setup();
    const account = await connected(t);
    const http = vi.fn(t.fake.http);
    const service = createConnectorService({
      registry: createConnectorRegistry([provider()]),
      store: t.store,
      keychain: t.keychain,
      config: { clientId: () => "c", clientSecret: async () => null },
      http,
      openExternal: async () => undefined,
      now: () => t.fake.now,
      newId: () => "x",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    await service.authorizedFetch(account.id, `${HOST}/api`, { headers: { "x-test": "1" } });
    const headers = new Headers(http.mock.calls[0]![1]!.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${blobOf(t).accessToken}`);
    expect(headers.get("x-test")).toBe("1");
  });

  it("makes the account need attention when the token cannot be refreshed", async () => {
    const t = setup();
    const account = await connected(t);
    t.fake.revokeGrant(blobOf(t).refreshToken!); // revoked at the provider
    t.fake.now += 58 * 60_000;
    await expect(t.service.accessToken(account.id)).rejects.toMatchObject({
      code: "needs-attention",
      message: "Fakebook no longer accepts this sign-in. Connect again.",
    });
    expect(t.store.get(account.id)).toMatchObject({
      status: "needs_attention",
      statusReason: "Fakebook no longer accepts this sign-in. Connect again.",
    });
    // Nothing more is asked of the provider until the owner reconnects.
    const calls = t.fake.tokenCalls.length;
    await expect(t.service.accessToken(account.id)).rejects.toMatchObject({
      code: "needs-attention",
    });
    await expect(t.service.authorizedFetch(account.id, `${HOST}/api`)).rejects.toMatchObject({
      code: "needs-attention",
    });
    expect(t.fake.tokenCalls).toHaveLength(calls);
    // Reconnecting the same account brings it back with the same id.
    const again = await connected(t);
    expect(again).toMatchObject({ id: account.id, status: "connected", statusReason: null });
    expect(await t.service.accessToken(account.id)).toBe(blobOf(t).accessToken);
  });

  it("needs attention when an ended token has nothing to renew it with, or the Keychain item is gone", async () => {
    const t = setup();
    const account = await connected(t);
    const blob = blobOf(t);
    t.keychain.items.set(
      "com.murmur.connector.fake|a@example.com",
      JSON.stringify({ ...blob, refreshToken: null }),
    );
    t.fake.now += 59 * 60_000;
    await expect(t.service.accessToken(account.id)).rejects.toMatchObject({
      code: "needs-attention",
    });

    const gone = setup();
    const other = await connected(gone);
    gone.keychain.items.clear();
    await expect(gone.service.accessToken(other.id)).rejects.toMatchObject({
      code: "needs-attention",
      message: "The saved sign-in is gone. Connect again.",
    });
  });

  it("does not blame the account for a busy provider or an unreachable network", async () => {
    const t = setup();
    const account = await connected(t);
    t.fake.now += 58 * 60_000;
    t.fake.failRefresh = 503;
    await expect(t.service.accessToken(account.id)).rejects.toMatchObject({ code: "network" });
    expect(t.store.get(account.id)?.status).toBe("connected");
    t.fake.failRefresh = null;
    expect(await t.service.accessToken(account.id)).toBeTruthy();

    const offline = setup();
    const second = await connected(offline);
    offline.fake.now += 58 * 60_000;
    const failing = createConnectorService({
      registry: createConnectorRegistry([provider()]),
      store: offline.store,
      keychain: offline.keychain,
      config: { clientId: () => "c", clientSecret: async () => null },
      http: async () => {
        throw new Error("offline");
      },
      openExternal: async () => undefined,
      now: () => offline.fake.now,
      newId: () => "x",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    await expect(failing.accessToken(second.id)).rejects.toMatchObject({ code: "network" });
    expect(offline.store.get(second.id)?.status).toBe("connected");
  });

  it("says it cannot read the Keychain without changing the account", async () => {
    const t = setup();
    const account = await connected(t);
    t.keychain.failGet = true;
    await expect(t.service.accessToken(account.id)).rejects.toMatchObject({ code: "keychain" });
    expect(t.store.get(account.id)?.status).toBe("connected");
  });

  it("refuses a missing account and a disabled one; turning it on again works", async () => {
    const t = setup();
    const account = await connected(t);
    await expect(t.service.accessToken("nope")).rejects.toMatchObject({ code: "not-connected" });
    t.service.setEnabled(account.id, false);
    expect(t.store.get(account.id)?.status).toBe("disabled");
    await expect(t.service.accessToken(account.id)).rejects.toMatchObject({ code: "disabled" });
    t.service.setEnabled(account.id, true);
    expect(await t.service.accessToken(account.id)).toBeTruthy();
  });
});

describe("disconnecting (CN-01)", () => {
  it("revokes at the provider, deletes the Keychain item and the cache, and keeps the other account", async () => {
    const t = setup();
    const a = await connected(t, "a@example.com");
    const b = await connected(t, "b@example.com");
    t.store.cachePut(a.id, "events", "k", "A", 1, 1e9);
    t.store.cachePut(b.id, "events", "k", "B", 1, 1e9);
    const refresh = blobOf(t, "a@example.com").refreshToken;

    expect(await t.service.disconnect(a.id)).toEqual({ revoked: true });
    expect(t.fake.revokeCalls).toEqual([{ token: refresh, client_id: "client-1" }]);
    expect(t.keychain.items.has("com.murmur.connector.fake|a@example.com")).toBe(false);
    expect(t.store.get(a.id)).toBeNull();
    expect(t.store.cacheGet(a.id, "events", "k", 2)).toBeNull();
    // The other account is untouched and still works.
    expect(t.keychain.items.has("com.murmur.connector.fake|b@example.com")).toBe(true);
    expect(t.store.cacheGet(b.id, "events", "k", 2)).toBe("B");
    expect(await t.service.authorizedFetch(b.id, `${HOST}/api`)).toMatchObject({ status: 200 });

    expect(await t.service.disconnect(b.id)).toEqual({ revoked: true });
    expect(t.service.list()).toEqual([]);
    expect(await t.service.disconnect(b.id)).toEqual({ revoked: null });
  });

  it("still disconnects when the provider does not confirm the revoke", async () => {
    const t = setup();
    const account = await connected(t);
    t.fake.failRevoke = true;
    expect(await t.service.disconnect(account.id)).toEqual({ revoked: false });
    expect(t.service.list()).toEqual([]);
    expect(t.keychain.items.size).toBe(0);
  });

  it("says revoked is unknown for a provider with no revoke endpoint", async () => {
    const t = setup({ provider: { revokeUrl: null } });
    const account = await connected(t);
    expect(await t.service.disconnect(account.id)).toEqual({ revoked: null });
    expect(t.fake.revokeCalls).toEqual([]);
  });

  it("uses the provider's own revoke when it has one", async () => {
    const revoke = vi.fn(async () => undefined);
    const t = setup({ provider: { revoke } });
    const account = await connected(t);
    expect(await t.service.disconnect(account.id)).toEqual({ revoked: true });
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({ token: expect.stringMatching(/^refresh-/), clientId: "client-1" }),
    );
  });

  it("keeps the account, and says why, when the Keychain item cannot be deleted", async () => {
    const t = setup();
    const account = await connected(t);
    t.keychain.failDelete = true;
    await expect(t.service.disconnect(account.id)).rejects.toMatchObject({ code: "keychain" });
    expect(t.store.get(account.id)).not.toBeNull();
    t.keychain.failDelete = false;
    expect(await t.service.disconnect(account.id)).toEqual({ revoked: true });
  });

  it("resets: disconnects every account, deletes the client secrets, and counts what it could not", async () => {
    const t = setup({ provider: { needsClientSecret: true } });
    await connected(t, "a@example.com");
    await connected(t, "b@example.com");
    t.keychain.items.set("com.murmur.connector.fake.app|client-secret", "secret-1");
    expect(await t.service.reset()).toEqual({ disconnected: 2, kept: 0 });
    expect(t.keychain.items.size).toBe(0);
    expect(t.service.list()).toEqual([]);

    const stuck = setup();
    await connected(stuck);
    stuck.keychain.failDelete = true;
    expect(await stuck.service.reset()).toEqual({ disconnected: 0, kept: 1 });
  });

  it("tells the listener after a connect, a disconnect and a change of state", async () => {
    const t = setup();
    const onChange = vi.fn();
    const service = createConnectorService({
      registry: createConnectorRegistry([provider()]),
      store: t.store,
      keychain: t.keychain,
      config: { clientId: () => "c", clientSecret: async () => null },
      http: t.fake.http,
      openExternal: async (url) => void approve(new URL(url), t.fake),
      now: () => t.fake.now,
      newId: () => "x",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      onChange,
    });
    const outcome = await service.connect("fake");
    expect(onChange).toHaveBeenCalledTimes(1);
    if (!outcome.ok) throw new Error("connect failed");
    service.setEnabled(outcome.account.id, false);
    await service.disconnect(outcome.account.id);
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});
