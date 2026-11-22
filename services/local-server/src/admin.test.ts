import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PASSWORD, startHarness, type Harness, type Json } from "./test-helpers.ts";

const ADMIN_DIR = new URL("../admin/", import.meta.url);

/** Every file the console is made of. */
function adminFiles(): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  for (const entry of readdirSync(ADMIN_DIR, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const file of readdirSync(new URL(`${entry.name}/`, ADMIN_DIR)))
        out.push({
          name: `${entry.name}/${file}`,
          text: readFileSync(new URL(`${entry.name}/${file}`, ADMIN_DIR), "utf8"),
        });
    } else
      out.push({ name: entry.name, text: readFileSync(new URL(entry.name, ADMIN_DIR), "utf8") });
  }
  return out;
}

let h: Awaited<ReturnType<typeof startHarness>>;
beforeEach(async () => {
  h = await startHarness();
});
afterEach(() => h.close());

/** A request that carries the console's cookie rather than a Bearer header. */
async function asCookie(
  token: string,
  method: string,
  path: string,
  options: { body?: unknown; header?: boolean } = {},
) {
  const res = await fetch(h.base + path, {
    method,
    headers: {
      cookie: `murmur_admin=${token}`,
      ...(options.header === false ? {} : { "x-murmur-admin": "1" }),
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const raw = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    raw,
    json: raw.startsWith("{") ? (JSON.parse(raw) as Json) : null,
  };
}

async function signInPage(email: string, password = PASSWORD) {
  const res = await fetch(`${h.base}/v1/admin/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const raw = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    raw,
    json: raw ? (JSON.parse(raw) as Json) : null,
  };
}

const tokenFrom = (setCookie: string | null) =>
  /murmur_admin=([^;]+)/.exec(setCookie ?? "")?.[1] ?? "";

describe("the console calls only documented routes (TM-11)", () => {
  it("every route a page names is in the server's route table", () => {
    const table = new Set(h.server.routes.map((route) => `${route.method} ${route.path}`));
    const used = new Set<string>();
    for (const file of adminFiles()) {
      if (!file.name.endsWith(".js")) continue;
      for (const match of file.text.matchAll(/"((?:GET|POST|PUT|PATCH|DELETE) \/[^"]*)"/g))
        used.add(match[1]!);
    }
    expect(used.size).toBeGreaterThan(40);
    const unknown = [...used].filter((route) => !table.has(route));
    expect(unknown).toEqual([]);
  });

  it("never calls the SCIM or the development provider routes, or starts a sign-in as someone else", () => {
    for (const file of adminFiles()) {
      if (!file.name.endsWith(".js")) continue;
      expect(file.text).not.toMatch(/\/scim\/v2|\/dev-idp|\/v1\/sso\/acs|sso\/start/);
    }
  });

  it("reaches the network only through the call helper", () => {
    for (const file of adminFiles()) {
      if (!file.name.endsWith(".js") || file.name === "api.js") continue;
      expect(file.text, file.name).not.toMatch(
        /\bfetch\(|XMLHttpRequest|WebSocket|localStorage|document\.cookie/,
      );
    }
  });

  it("writes text as text, never as markup", () => {
    for (const file of adminFiles()) {
      if (!file.name.endsWith(".js")) continue;
      expect(file.text, file.name).not.toMatch(
        /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/,
      );
    }
  });
});

describe("what the pages can show (no stored password or token)", () => {
  it("only the page that makes a SCIM token reads a token from an answer", () => {
    const readers = adminFiles()
      .filter(
        (file) =>
          file.name.endsWith(".js") && /\.token\b|\.password\b|passwordHash/.test(file.text),
      )
      .map((file) => file.name);
    expect(readers).toEqual(["pages/identity.js"]);
  });

  it("no answer the console reads holds a password, a token or a secret, except the ones made once", async () => {
    const teamId = (
      await h.call("POST", "/v1/teams", { token: h.owner.token, body: { name: "Acme" } })
    ).json!["id"];
    await h.call("POST", `/v1/teams/${teamId}/invites`, { token: h.owner.token, body: {} });
    await h.call("POST", `/v1/teams/${teamId}/dictionary`, {
      token: h.owner.token,
      body: { term: "Acme", scope: "company" },
    });
    await h.call("PUT", `/v1/teams/${teamId}/identity/scim`, {
      token: h.owner.token,
      body: { enabled: true },
    });
    const reads = [
      "/v1/me",
      "/v1/users",
      "/v1/teams",
      `/v1/teams/${teamId}/members`,
      `/v1/teams/${teamId}/invites`,
      `/v1/teams/${teamId}/requests`,
      `/v1/teams/${teamId}/departments`,
      `/v1/teams/${teamId}/dictionary`,
      `/v1/teams/${teamId}/snippets`,
      `/v1/teams/${teamId}/vocabulary/pending`,
      `/v1/teams/${teamId}/vocabulary/settings`,
      `/v1/teams/${teamId}/policy`,
      `/v1/teams/${teamId}/policy/effective`,
      `/v1/teams/${teamId}/usage`,
      `/v1/teams/${teamId}/usage/settings`,
      `/v1/teams/${teamId}/leaderboard`,
      `/v1/teams/${teamId}/identity`,
      `/v1/teams/${teamId}/identity/domains`,
      `/v1/teams/${teamId}/compliance`,
      "/v1/audit/settings",
      "/v1/network/allowlist",
      "/v1/plan",
    ];
    for (const path of reads) {
      const res = await h.call("GET", path, { token: h.owner.token });
      expect(res.status, path).toBe(200);
      expect(res.raw, path).not.toMatch(
        /"[A-Za-z]*(password|token|secret|passwordHash)[A-Za-z]*"\s*:\s*"/i,
      );
    }
    // The audit entries carry the chain's hashes; none carries a credential.
    const audit = await h.call("GET", "/v1/audit?limit=200", { token: h.owner.token });
    expect(audit.raw).not.toMatch(/mst_|inv_|"password"|"token"/);
  });
});

describe("the pages", () => {
  it("serves the sign-in page and the page's own files with strict headers, and nothing else", async () => {
    const page = await fetch(`${h.base}/admin`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect((await page.text()).includes("/admin/app.js")).toBe(true);

    const js = await fetch(`${h.base}/admin/app.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect((await fetch(`${h.base}/admin/pages/members.js`)).status).toBe(200);
    expect((await fetch(`${h.base}/admin/style.css`)).status).toBe(200);

    for (const path of [
      "/admin/nothing.js",
      "/admin/pages/nothing.js",
      "/admin/..%2fsrc%2fserver.ts",
      "/admin/%2e%2e/src/server.ts",
      "/admin/pages/..%2fapp.js",
      "/admin/a/b/c.js",
      "/admin/pages/",
    ]) {
      const res = await fetch(h.base + path);
      expect([404], path).toContain(res.status);
      expect(await res.text()).not.toContain("import");
    }
    const post = await fetch(`${h.base}/admin`, { method: "POST" });
    expect(post.status).toBe(405);
  });

  it("is answered only for this machine's own name and address", async () => {
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve) => {
      const port = new URL(h.base).port;
      const req = request(
        { host: "127.0.0.1", port, path: "/admin", headers: { host: "evil.example" } },
        (res) => resolve(res.statusCode ?? 0),
      );
      req.end();
    });
    expect(status).toBe(403);
  });
});

describe("signing in to the console", () => {
  it("sets an HttpOnly, SameSite=Strict cookie and puts no token in the answer", async () => {
    const res = await signInPage("owner@example.com");
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^murmur_admin=mst_/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(res.raw).not.toContain("mst_");
    expect(res.json!["user"].email).toBe("owner@example.com");
    expect(res.json!["user"].passwordHash).toBeUndefined();
  });

  it("the cookie opens the page and the API, and a change needs the console's header", async () => {
    const token = tokenFrom((await signInPage("owner@example.com")).headers.get("set-cookie"));
    const page = await asCookie(token, "GET", "/admin");
    expect(page.status).toBe(200);
    expect((await asCookie(token, "GET", "/v1/me")).json!["email"]).toBe("owner@example.com");
    // A page on another site could send the cookie but not this header.
    const forged = await asCookie(token, "POST", "/v1/teams", {
      body: { name: "Forged" },
      header: false,
    });
    expect(forged.status).toBe(403);
    expect(forged.json!["error"].code).toBe("csrf");
    const made = await asCookie(token, "POST", "/v1/teams", { body: { name: "Real" } });
    expect(made.status).toBe(201);
    // A Bearer request is not a cookie request and needs no header.
    expect((await h.call("GET", "/v1/me", { token })).status).toBe(200);
  });

  it("refuses a request from another page's origin", async () => {
    const token = tokenFrom((await signInPage("owner@example.com")).headers.get("set-cookie"));
    const res = await fetch(`${h.base}/v1/teams`, {
      method: "POST",
      headers: {
        cookie: `murmur_admin=${token}`,
        "x-murmur-admin": "1",
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Evil" }),
    });
    expect(res.status).toBe(403);
  });

  it("says the same for a wrong password as the other sign-in, and sets no cookie", async () => {
    const res = await signInPage("owner@example.com", "not the password at all");
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("signs out: the cookie is cleared and the session no longer works", async () => {
    const token = tokenFrom((await signInPage("owner@example.com")).headers.get("set-cookie"));
    const out = await asCookie(token, "DELETE", "/v1/admin/session");
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await asCookie(token, "GET", "/v1/me")).status).toBe(401);
  });

  it("a SCIM provider's route never accepts the cookie", async () => {
    const token = tokenFrom((await signInPage("owner@example.com")).headers.get("set-cookie"));
    const res = await asCookie(token, "GET", "/scim/v2/Users");
    expect(res.status).toBe(401);
  });
});

describe("who may open it", () => {
  async function team(h: Harness & { owner: { id: string; token: string } }) {
    const made = await h.call("POST", "/v1/teams", {
      token: h.owner.token,
      body: { name: "Acme" },
    });
    return made.json!["id"] as string;
  }

  it("an owner, admin or manager of a team may; a member, a viewer and a person with no team see the 403 page", async () => {
    const teamId = await team(h);
    const roles: [string, boolean][] = [
      ["Admin Person", true],
      ["Manager Person", true],
      ["Member Person", false],
      ["Viewer Person", false],
    ];
    for (const [name, allowed] of roles) {
      const person = await h.person(name);
      const role = name.split(" ")[0]!.toLowerCase();
      h.server.teams.addMember(teamId, person.id, role as never, null, {
        actorId: h.owner.id,
        via: "test",
      });
      const signed = await signInPage(person.email);
      if (allowed) {
        expect(signed.status, name).toBe(200);
        const token = tokenFrom(signed.headers.get("set-cookie"));
        expect((await asCookie(token, "GET", "/admin")).status, name).toBe(200);
      } else {
        expect(signed.status, name).toBe(403);
        expect(signed.json!["error"].code).toBe("not_admin");
        expect(signed.headers.get("set-cookie"), name).toBeNull();
        // A cookie made some other way (a session from the app) is refused with the 403 page.
        const page = await asCookie(person.token, "GET", "/admin");
        expect(page.status, name).toBe(403);
        expect(page.headers.get("content-type")).toContain("text/html");
        expect(page.raw).toContain("403");
        expect(page.raw).not.toContain("/admin/app.js");
      }
    }
    const stranger = await h.person("Stranger Person");
    expect((await signInPage(stranger.email)).status).toBe(403);
    expect((await asCookie(stranger.token, "GET", "/admin")).status).toBe(403);
  });

  it("a plan without the console says so, after sign-in and not before", async () => {
    const token = tokenFrom((await signInPage("owner@example.com")).headers.get("set-cookie"));
    await h.call("PUT", "/v1/plan", { token: h.owner.token, body: { tier: "free" } });
    const page = await asCookie(token, "GET", "/admin");
    expect(page.status).toBe(403);
    expect(page.raw).toContain("Available on Team");
    const again = await signInPage("owner@example.com");
    expect(again.status).toBe(403);
    expect(again.headers.get("set-cookie")).toBeNull();
    // Someone who is not signed in learns nothing about the plan from the sign-in page.
    const open = await fetch(`${h.base}/admin`);
    expect(open.status).toBe(200);
    expect(await open.text()).not.toContain("Available on");
  });
});
