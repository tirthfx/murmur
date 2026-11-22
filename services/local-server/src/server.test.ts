import { request } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THROTTLE } from "./accounts.ts";
import { MIN_PASSWORD_LENGTH } from "./passwords.ts";
import { createLocalServer, type LocalServer } from "./server.ts";

const OWNER = { name: "Ada", email: "Ada@Example.com", password: "correct horse battery" };
const OTHER = { name: "Grace", email: "grace@example.com", password: "another long password" };

let clock = 1_000_000;
let server: LocalServer;
let base = "";
let logs: string[] = [];

beforeEach(async () => {
  clock = 1_000_000;
  logs = [];
  server = createLocalServer({
    dbPath: ":memory:",
    port: 0,
    now: () => clock,
    log: (line) => logs.push(line),
  });
  const { host, port } = await server.listen();
  base = `http://${host}:${port}`;
});
afterEach(() => server.close());

// Test responses are read loosely on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function call(
  method: string,
  path: string,
  options: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const raw = await res.text();
  return { status: res.status, raw, json: raw ? (JSON.parse(raw) as Json) : null };
}

async function setUp() {
  const made = await call("POST", "/v1/setup", { body: OWNER });
  return made.json!["token"] as string;
}

describe("the first run", () => {
  it("starts with no account, then makes the owner and signs them in", async () => {
    expect((await call("GET", "/v1/health")).json).toMatchObject({ ok: true, setUp: false });
    const made = await call("POST", "/v1/setup", { body: OWNER });
    expect(made.status).toBe(201);
    expect(made.json!["user"]).toMatchObject({ email: "ada@example.com", isOwner: true });
    expect((await call("GET", "/v1/health")).json).toMatchObject({ setUp: true });
    expect((await call("GET", "/v1/me", { token: made.json!["token"] })).json).toMatchObject({
      name: "Ada",
    });
  });

  it("makes an owner only once", async () => {
    await setUp();
    const again = await call("POST", "/v1/setup", { body: { ...OTHER } });
    expect(again.status).toBe(409);
    expect(again.json!["error"].code).toBe("already_set_up");
  });

  it("refuses a short password and a bad address", async () => {
    const short = await call("POST", "/v1/setup", { body: { ...OWNER, password: "short" } });
    expect(short.status).toBe(400);
    expect(short.json!["error"].message).toContain(String(MIN_PASSWORD_LENGTH));
    const bad = await call("POST", "/v1/setup", { body: { ...OWNER, email: "nope" } });
    expect(bad.json!["error"].code).toBe("invalid_email");
  });
});

describe("signing in", () => {
  it("signs in with the password, with any capitals in the address", async () => {
    await setUp();
    const ok = await call("POST", "/v1/sessions", {
      body: { email: "ADA@example.com", password: OWNER.password },
    });
    expect(ok.status).toBe(200);
    expect(ok.json!["token"]).toMatch(/^mst_/);
  });

  it("answers a wrong password and an unknown address the same way", async () => {
    await setUp();
    const wrong = await call("POST", "/v1/sessions", {
      body: { email: OWNER.email, password: "wrong wrong wrong" },
    });
    const unknown = await call("POST", "/v1/sessions", {
      body: { email: "nobody@example.com", password: "wrong wrong wrong" },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.json).toEqual(unknown.json);
  });

  it("delays the next attempt by 30 seconds after five wrong passwords in a row", async () => {
    await setUp();
    const wrong = () =>
      call("POST", "/v1/sessions", { body: { email: OWNER.email, password: "wrong wrong wrong" } });
    for (let i = 0; i < THROTTLE.failures; i++) expect((await wrong()).status).toBe(401);

    const delayed = await wrong();
    expect(delayed.status).toBe(429);
    expect(delayed.json!["error"].retryAfterSeconds).toBe(30);
    // Even the right password waits, or the delay would stop nothing.
    const right = await call("POST", "/v1/sessions", {
      body: { email: OWNER.email, password: OWNER.password },
    });
    expect(right.status).toBe(429);

    clock += 31_000;
    const after = await call("POST", "/v1/sessions", {
      body: { email: OWNER.email, password: OWNER.password },
    });
    expect(after.status).toBe(200);
  });

  it("starts the count again after a good sign-in", async () => {
    await setUp();
    const wrong = () =>
      call("POST", "/v1/sessions", { body: { email: OWNER.email, password: "wrong wrong wrong" } });
    for (let i = 0; i < THROTTLE.failures - 1; i++) await wrong();
    await call("POST", "/v1/sessions", { body: { email: OWNER.email, password: OWNER.password } });
    for (let i = 0; i < THROTTLE.failures - 1; i++) expect((await wrong()).status).toBe(401);
  });

  it("ends a session on sign-out and when it expires", async () => {
    const token = await setUp();
    expect((await call("DELETE", "/v1/sessions/current", { token })).status).toBe(204);
    expect((await call("GET", "/v1/me", { token })).status).toBe(401);

    const second = (
      await call("POST", "/v1/sessions", {
        body: { email: OWNER.email, password: OWNER.password },
      })
    ).json!["token"];
    expect((await call("GET", "/v1/me", { token: second })).status).toBe(200);
    clock += 31 * 86_400_000;
    expect((await call("GET", "/v1/me", { token: second })).status).toBe(401);
  });

  it("stores only the hash of a session token", async () => {
    const token = await setUp();
    const rows = server.db.prepare("SELECT token_hash FROM sessions").all() as {
      token_hash: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toContain(token);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("accounts made by the owner", () => {
  it("lets the owner add accounts and see the list, and nobody else", async () => {
    const token = await setUp();
    const made = await call("POST", "/v1/users", { token, body: OTHER });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ email: "grace@example.com", isOwner: false });
    expect((await call("POST", "/v1/users", { token, body: OTHER })).status).toBe(409);

    const listed = await call("GET", "/v1/users", { token });
    expect(listed.json!["users"]).toHaveLength(2);

    const grace = (
      await call("POST", "/v1/sessions", {
        body: { email: OTHER.email, password: OTHER.password },
      })
    ).json!["token"];
    expect((await call("GET", "/v1/users", { token: grace })).status).toBe(403);
    expect((await call("POST", "/v1/users", { token: grace, body: OWNER })).status).toBe(403);
    expect((await call("GET", "/v1/users")).status).toBe(401);
  });

  it("keeps a turned-off account from signing in or using a session", async () => {
    const token = await setUp();
    await call("POST", "/v1/users", { token, body: OTHER });
    const grace = (
      await call("POST", "/v1/sessions", {
        body: { email: OTHER.email, password: OTHER.password },
      })
    ).json!["token"];
    server.db.prepare("UPDATE users SET status = 'deactivated' WHERE email = ?").run(OTHER.email);
    expect((await call("GET", "/v1/me", { token: grace })).status).toBe(401);
    const again = await call("POST", "/v1/sessions", {
      body: { email: OTHER.email, password: OTHER.password },
    });
    expect(again.status).toBe(403);
    expect(again.json!["error"].code).toBe("deactivated");
  });
});

describe("changing the password", () => {
  const change = (token: string, currentPassword: string, newPassword: string) =>
    call("POST", "/v1/me/password", { token, body: { currentPassword, newPassword } });

  it("needs the current password and a new one that passes the rules", async () => {
    const token = await setUp();
    expect((await change(token, "not the password", "brand new password 1")).status).toBe(400);
    expect((await change(token, OWNER.password, "short")).json!["error"].code).toBe(
      "weak_password",
    );
    expect((await change(token, OWNER.password, "brand new password 1")).status).toBe(204);
    const signIn = await call("POST", "/v1/sessions", {
      body: { email: OWNER.email, password: "brand new password 1" },
    });
    expect(signIn.status).toBe(200);
  });

  it("refuses any of the last five passwords", async () => {
    const token = await setUp();
    const used = [OWNER.password];
    for (let i = 1; i <= 5; i++) {
      const next = `password number ${i} long`;
      expect((await change(token, used.at(-1)!, next)).status).toBe(204);
      used.push(next);
    }
    // The first password is now six back, so it is free again; the five after it are not.
    expect((await change(token, used.at(-1)!, used[1]!)).json!["error"].code).toBe(
      "password_reused",
    );
    expect((await change(token, used.at(-1)!, used[0]!)).status).toBe(204);
  });

  it("ends the other sessions and keeps this one", async () => {
    const first = await setUp();
    const second = (
      await call("POST", "/v1/sessions", {
        body: { email: OWNER.email, password: OWNER.password },
      })
    ).json!["token"];
    await change(first, OWNER.password, "brand new password 1");
    expect((await call("GET", "/v1/me", { token: first })).status).toBe(200);
    expect((await call("GET", "/v1/me", { token: second })).status).toBe(401);
  });
});

describe("what is never shown", () => {
  it("keeps password hashes and passwords out of every response and the log", async () => {
    const token = await setUp();
    await call("POST", "/v1/users", { token, body: OTHER });
    await call("POST", "/v1/sessions", {
      body: { email: OWNER.email, password: "wrong wrong wrong" },
    });
    const responses = [
      await call("GET", "/v1/me", { token }),
      await call("GET", "/v1/users", { token }),
      await call("POST", "/v1/users", { token, body: OTHER }),
      await call("POST", "/v1/sessions", {
        body: { email: OWNER.email, password: OWNER.password },
      }),
    ];
    for (const response of responses) {
      expect(response.raw).not.toMatch(/scrypt\$/);
      expect(response.raw).not.toContain("password_hash");
      expect(response.raw).not.toContain(OWNER.password);
    }
    const hashes = (
      server.db.prepare("SELECT password_hash FROM users").all() as { password_hash: string }[]
    ).map((row) => row.password_hash);
    const log = logs.join("\n");
    for (const secret of [...hashes, OWNER.password, OTHER.password, "wrong wrong wrong", token])
      expect(log).not.toContain(secret);
    expect(hashes.every((hash) => hash.startsWith("scrypt$"))).toBe(true);
  });
});

describe("who can reach it", () => {
  it("binds to the loopback address only", async () => {
    const other = () => createLocalServer({ dbPath: ":memory:", host: "0.0.0.0" });
    expect(other).toThrow(/this machine only/);
    expect(base.startsWith("http://127.0.0.1:")).toBe(true);
  });

  it("does not answer a page from another origin or a rebinding host name", async () => {
    const origin = await call("GET", "/v1/health", { headers: { origin: "https://evil.example" } });
    expect(origin.status).toBe(403);
    // fetch will not send a different Host header, so this one is made with node:http.
    const status = await new Promise<number>((resolve, reject) => {
      const { port } = new URL(base);
      const req = request(
        { host: "127.0.0.1", port, path: "/v1/health", headers: { host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("asks for JSON, refuses a body that is too large and an unknown path", async () => {
    const plain = await fetch(`${base}/v1/setup`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect(plain.status).toBe(415);
    const big = await call("POST", "/v1/sessions", { body: { email: "x".repeat(70_000) } });
    expect(big.status).toBe(413);
    expect((await call("GET", "/v1/nothing")).status).toBe(404);
  });
});
