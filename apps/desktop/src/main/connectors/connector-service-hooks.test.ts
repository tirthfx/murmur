import { describe, expect, it } from "vitest";
import type { Keychain } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createConnectorService } from "./connector-service";
import { createConnectorStore } from "./connector-store";
import { createConnectorRegistry, type ConnectorProvider } from "./providers";

const HOST = "https://odd.test";

class MemoryKeychain implements Keychain {
  items = new Map<string, string>();
  async get(service: string, account: string) {
    return this.items.get(`${service}|${account}`) ?? null;
  }
  async set(service: string, account: string, value: string) {
    this.items.set(`${service}|${account}`, value);
  }
  async delete(service: string, account: string) {
    return this.items.delete(`${service}|${account}`);
  }
}

interface TokenCall {
  headers: Headers;
  body: string;
}

/** A provider whose token answer is not the standard shape: the token is nested, as Slack's is. */
function setup(over: Partial<ConnectorProvider>, standard = false) {
  const db = openDatabase(":memory:");
  const store = createConnectorStore(db);
  const keychain = new MemoryKeychain();
  const tokenCalls: TokenCall[] = [];
  const opened: URL[] = [];
  let now = 1_000_000;
  const provider: ConnectorProvider = {
    id: "odd",
    name: "Oddbook",
    authorizeUrl: `${HOST}/authorize`,
    tokenUrl: `${HOST}/token`,
    revokeUrl: null,
    scopes: ["one", "two"],
    loopbackPort: null,
    needsClientSecret: true,
    parseTokenResponse(body) {
      const user = (body as { authed_user?: { access_token?: string; refresh_token?: string } })
        .authed_user;
      return user?.access_token
        ? {
            accessToken: user.access_token,
            refreshToken: user.refresh_token ?? null,
            expiresIn: 600,
            scopes: ["one"],
          }
        : null;
    },
    accountLabel: async () => "odd@example.com",
    ...over,
  };
  if (standard) delete provider.parseTokenResponse;
  const service = createConnectorService({
    registry: createConnectorRegistry([provider]),
    store,
    keychain,
    config: { clientId: () => "client-1", clientSecret: async () => "secret-1" },
    http: async (url, init) => {
      if (url === `${HOST}/token`) {
        tokenCalls.push({ headers: new Headers(init?.headers), body: String(init?.body) });
        return Response.json({
          authed_user: { access_token: `tok-${tokenCalls.length}`, refresh_token: "ref-1" },
        });
      }
      return new Response("no", { status: 404 });
    },
    openExternal: async (url) => {
      const parsed = new URL(url);
      opened.push(parsed);
      const code = "the-code";
      await fetch(
        `${parsed.searchParams.get("redirect_uri")}?code=${code}&state=${parsed.searchParams.get("state")}`,
      );
    },
    now: () => now,
    newId: () => "acct-1",
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });
  return { service, opened, tokenCalls, advance: (ms: number) => (now += ms) };
}

describe("provider hooks for providers that are not standard (CN-05, CN-06)", () => {
  it("can send the scopes as user_scope, comma separated, and no scope", async () => {
    const t = setup({ scopeParam: "user_scope", scopeSeparator: "," });
    expect((await t.service.connect("odd")).ok).toBe(true);
    const url = t.opened[0]!;
    expect(url.searchParams.get("user_scope")).toBe("one,two");
    expect(url.searchParams.has("scope")).toBe(false);
  });

  it("can send no scope at all", async () => {
    const t = setup({ scopeParam: null });
    await t.service.connect("odd");
    expect(t.opened[0]!.searchParams.has("scope")).toBe(false);
    expect(t.opened[0]!.searchParams.has("user_scope")).toBe(false);
  });

  it("sends the usual scope parameter, spaced, when nothing is set", async () => {
    const t = setup({});
    await t.service.connect("odd");
    expect(t.opened[0]!.searchParams.get("scope")).toBe("one two");
  });

  it("can prove the app with HTTP Basic and a JSON body, with extra headers, and reads a token answer of its own shape", async () => {
    const t = setup({
      tokenAuth: "basic",
      tokenBody: "json",
      tokenHeaders: { "Notion-Version": "2022-06-28" },
    });
    const outcome = await t.service.connect("odd");
    expect(outcome).toMatchObject({
      ok: true,
      account: { email: "odd@example.com", scopes: ["one"] },
    });
    const call = t.tokenCalls[0]!;
    expect(call.headers.get("authorization")).toBe(
      `Basic ${Buffer.from("client-1:secret-1").toString("base64")}`,
    );
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(call.headers.get("notion-version")).toBe("2022-06-28");
    const body = JSON.parse(call.body) as Record<string, string>;
    expect(body).toMatchObject({ grant_type: "authorization_code", code: "the-code" });
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body).not.toHaveProperty("client_id");
    expect(body).not.toHaveProperty("client_secret");
  });

  it("uses the same style for a renewal", async () => {
    const t = setup({ tokenAuth: "basic", tokenBody: "json" });
    const outcome = await t.service.connect("odd");
    if (!outcome.ok) throw new Error(outcome.message);
    t.advance(11 * 60_000);
    await t.service.accessToken(outcome.account.id);
    const refresh = t.tokenCalls[1]!;
    expect(refresh.headers.get("authorization")).toMatch(/^Basic /);
    expect(JSON.parse(refresh.body)).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "ref-1",
    });
  });

  it("keeps the form and the body credentials for a standard provider", async () => {
    const t = setup({}, true);
    // The fake answers with a nested token, which the standard reader cannot use.
    expect(await t.service.connect("odd")).toMatchObject({
      ok: false,
      message: expect.stringContaining("cannot read"),
    });
    const call = t.tokenCalls[0]!;
    expect(call.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(call.headers.has("authorization")).toBe(false);
    expect(new URLSearchParams(call.body).get("client_id")).toBe("client-1");
    expect(new URLSearchParams(call.body).get("client_secret")).toBe("secret-1");
  });
});
