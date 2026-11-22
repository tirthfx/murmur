import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalServer, type LocalServer } from "./server.ts";

const OWNER = { name: "Ada", email: "ada@example.com", password: "correct horse battery" };
const OTHER = { name: "Grace", email: "grace@example.com", password: "another long password" };

let clock = 1_000_000;
let server: LocalServer;
let base = "";
let answers: number[] = [];
let posted: string[] = [];

beforeEach(async () => {
  clock = 1_000_000;
  answers = [];
  posted = [];
  server = createLocalServer({
    dbPath: ":memory:",
    port: 0,
    now: () => clock,
    siemAutoFlush: false,
    siemFile: join(mkdtempSync(join(tmpdir(), "audit-")), "audit.jsonl"),
    siemPost: async (_url, line) => {
      posted.push(line);
      return answers.shift() ?? 200;
    },
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
  options: { body?: unknown; token?: string } = {},
) {
  const withBody = options.body !== undefined && method !== "GET";
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(withBody ? { "content-type": "application/json" } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(withBody ? { body: JSON.stringify(options.body) } : {}),
  });
  const raw = await res.text();
  const json =
    raw && res.headers.get("content-type")?.includes("application/json")
      ? (JSON.parse(raw) as Json)
      : null;
  return { status: res.status, raw, json, headers: res.headers };
}

const setUp = async () =>
  (await call("POST", "/v1/setup", { body: OWNER })).json!["token"] as string;
const actions = async (token: string, query = "") =>
  ((await call("GET", `/v1/audit${query}`, { token })).json!["events"] as Json[]).map(
    (e) => e["action"],
  );

describe("what the accounts write", () => {
  it("records setup, sign-in, a new account, a password change and a first failed sign-in", async () => {
    const token = await setUp();
    await call("POST", "/v1/users", { token, body: OTHER });
    await call("POST", "/v1/me/password", {
      token,
      body: { currentPassword: OWNER.password, newPassword: "brand new password 1" },
    });
    await call("POST", "/v1/sessions", {
      body: { email: OWNER.email, password: "wrong wrong wrong" },
    });
    await call("POST", "/v1/sessions", {
      body: { email: OWNER.email, password: "wrong wrong wrong" },
    });
    await call("POST", "/v1/sessions", {
      body: { email: OWNER.email, password: "brand new password 1" },
    });

    expect(await actions(token)).toEqual([
      "auth.sign_in",
      "auth.sign_in_failed",
      "auth.password_changed",
      "account.created",
      "server.setup",
    ]);
  });

  it("writes the miss that locks, and not every miss in between", async () => {
    const token = await setUp();
    for (let i = 0; i < 12; i++)
      await call("POST", "/v1/sessions", {
        body: { email: "x@example.com", password: "wrong wrong wrong" },
      });
    const failed = (await actions(token)).filter((a) => a === "auth.sign_in_failed");
    // The 1st, the 5th and the 10th miss; the rest of the twelve are not written. The 6th to 9th
    // and the 11th to 12th are delayed or in between.
    expect(failed.length).toBeLessThanOrEqual(3);
    expect(failed.length).toBeGreaterThanOrEqual(1);
  });

  it("verifies after a day of use", async () => {
    const token = await setUp();
    for (let i = 0; i < 30; i++) {
      clock += 3_000_000;
      await call("POST", "/v1/sessions", {
        body: { email: OWNER.email, password: OWNER.password },
      });
    }
    const verified = await call("POST", "/v1/audit/verify", { token });
    expect(verified.json).toMatchObject({ ok: true });
    expect(verified.json!["count"]).toBeGreaterThanOrEqual(31);
  });

  it("never puts a password, a hash or a token in the log", async () => {
    const token = await setUp();
    await call("POST", "/v1/sessions", {
      body: { email: OWNER.email, password: "wrong wrong wrong" },
    });
    const exported = (await call("GET", "/v1/audit/export", { token })).raw;
    for (const secret of [OWNER.password, "wrong wrong wrong", token, "scrypt$"])
      expect(exported).not.toContain(secret);
  });
});

describe("reading and exporting", () => {
  it("filters by action, actor and date", async () => {
    const token = await setUp();
    const me = (await call("GET", "/v1/me", { token })).json!["id"] as string;
    clock += 5000;
    await call("POST", "/v1/sessions", { body: { email: OWNER.email, password: OWNER.password } });
    expect(await actions(token, "?action=auth.sign_in")).toEqual(["auth.sign_in"]);
    expect(await actions(token, "?action=auth.")).toEqual(["auth.sign_in"]);
    expect(await actions(token, `?actor=${me}`)).toHaveLength(2);
    expect(await actions(token, `?from=${clock}`)).toEqual(["auth.sign_in"]);
    expect(await actions(token, "?actor=nobody")).toEqual([]);
  });

  it("exports JSON lines and audits the export", async () => {
    const token = await setUp();
    const out = await call("GET", "/v1/audit/export?action=server.", { token });
    expect(out.headers.get("content-type")).toContain("application/x-ndjson");
    expect(out.raw.trimEnd().split("\n")).toHaveLength(1);
    expect(await actions(token)).toContain("audit.exported");
    const exportEvent = (await call("GET", "/v1/audit?action=audit.exported", { token })).json![
      "events"
    ][0];
    expect(exportEvent.detail).toEqual({ rows: 1 });
  });

  it("is for the owner only", async () => {
    const token = await setUp();
    await call("POST", "/v1/users", { token, body: OTHER });
    const grace = (
      await call("POST", "/v1/sessions", { body: { email: OTHER.email, password: OTHER.password } })
    ).json!["token"] as string;
    for (const [method, path] of [
      ["GET", "/v1/audit"],
      ["GET", "/v1/audit/export"],
      ["POST", "/v1/audit/verify"],
      ["GET", "/v1/audit/settings"],
      ["PUT", "/v1/audit/settings"],
      ["POST", "/v1/audit/siem/retry"],
    ] as const)
      expect((await call(method, path, { token: grace, body: {} })).status, path).toBe(403);
    expect((await call("GET", "/v1/audit")).status).toBe(401);
  });
});

describe("settings and the SIEM", () => {
  it("keeps the retention between 30 and 3650 days, and a webhook on the local network", async () => {
    const token = await setUp();
    const put = (body: unknown) => call("PUT", "/v1/audit/settings", { token, body });
    expect((await put({ retentionDays: 5 })).status).toBe(400);
    expect(
      (await put({ siemMode: "webhook", siemWebhookUrl: "https://example.com/in" })).json!["error"]
        .code,
    ).toBe("invalid_siem");
    const ok = await put({
      retentionDays: 90,
      siemMode: "webhook",
      siemWebhookUrl: "http://127.0.0.1:9000/in",
    });
    expect(ok.json).toMatchObject({ retentionDays: 90, siem: { mode: "webhook" } });
    const change = (await call("GET", "/v1/audit?action=audit.settings_changed", { token })).json![
      "events"
    ][0];
    expect(change.detail).toEqual({
      retentionDays: 90,
      siemMode: "webhook",
      siemWebhook: "changed",
    });
    expect(JSON.stringify(change)).not.toContain("127.0.0.1");
  });

  it("streams entries to the webhook, shows a failure and sends again on a retry", async () => {
    const token = await setUp();
    await call("PUT", "/v1/audit/settings", {
      token,
      body: { siemMode: "webhook", siemWebhookUrl: "http://127.0.0.1:9000/in" },
    });
    answers = Array<number>(20).fill(500);
    await call("POST", "/v1/sessions", { body: { email: OWNER.email, password: OWNER.password } });
    for (const wait of [0, 1_000, 5_000]) {
      clock += wait;
      await server.siem.flush();
    }
    const status = (await call("GET", "/v1/audit/settings", { token })).json!["siem"];
    expect(status.failed).toBeGreaterThanOrEqual(1);
    expect(status.failures[0].error).toBe("The receiver answered 500.");

    answers = [];
    const retried = await call("POST", "/v1/audit/siem/retry", { token });
    expect(retried.status).toBe(200);
    await server.siem.flush();
    const after = (await call("GET", "/v1/audit/settings", { token })).json!["siem"];
    expect(after.failed).toBe(0);
    expect(posted.length).toBeGreaterThan(3);
  });
});

describe("the verify command", () => {
  it("reports an intact log, then the entry that was changed", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-cli-"));
    const file = join(dir, "murmur-server.db");
    const local = createLocalServer({ dbPath: file, port: 0 });
    for (let i = 0; i < 4; i++) local.audit.record({ action: "auth.sign_in", actorId: "u1" });
    return local.close().then(() => {
      const run = () =>
        execFileSync(process.execPath, ["src/cli.ts", "verify"], {
          cwd: join(import.meta.dirname, ".."),
          env: { ...process.env, MURMUR_SERVER_DIR: dir, NODE_NO_WARNINGS: "1" },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      expect(run()).toContain("intact: 4 entries");
      const db = new DatabaseSync(file);
      db.prepare("UPDATE audit_events SET actor_id = 'x' WHERE seq = 3").run();
      db.close();
      try {
        run();
        expect.unreachable("verify should exit with an error");
      } catch (error) {
        const failure = error as { status: number; stderr: string };
        expect(failure.status).toBe(1);
        expect(failure.stderr).toContain("broken at entry 3");
      }
    });
  });
});
