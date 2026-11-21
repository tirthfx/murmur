import { describe, expect, it, vi } from "vitest";
import type { Keychain } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { clientTokenAccount, createMcpClients, MCP_KEYCHAIN_SERVICE } from "./mcp-clients";

class FakeKeychain implements Keychain {
  items = new Map<string, string>();
  failSet = false;
  failDelete = false;
  async get(service: string, account: string) {
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

function setup() {
  const db = openDatabase(":memory:");
  const keychain = new FakeKeychain();
  let n = 0;
  let now = 1_000_000;
  const onEnded = vi.fn();
  const warn = vi.fn();
  const clients = createMcpClients(db, {
    keychain,
    newId: () => `c${++n}`,
    now: () => now,
    logger: { warn },
    onEnded,
  });
  return { db, keychain, clients, onEnded, warn, advance: (ms: number) => (now += ms) };
}

const tokenOf = (t: ReturnType<typeof setup>, id: string) =>
  t.keychain.items.get(`${MCP_KEYCHAIN_SERVICE}|${clientTokenAccount(id)}`)!;

describe("approved MCP apps and their tokens (CN-11)", () => {
  it("approves an app: a 256-bit token in the Keychain, and only its hash in the database", async () => {
    const t = setup();
    const result = await t.clients.issue("  Claude   desktop ", "claude-desktop");
    expect(result).toEqual({
      ok: true,
      client: {
        id: "c1",
        name: "Claude desktop",
        kind: "claude-desktop",
        createdAt: 1_000_000,
        lastUsedAt: null,
      },
    });
    const token = tokenOf(t, "c1");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(t.db.prepare("SELECT * FROM mcp_clients").all())).not.toContain(token);
    expect(await t.clients.token("c1")).toBe(token);
    expect(t.clients.authenticate(token)).toMatchObject({ id: "c1", name: "Claude desktop" });
    expect(t.clients.authenticate("not-the-token")).toBeNull();
  });

  it("gives each app its own token, and refuses a name that is empty, long, or taken", async () => {
    const t = setup();
    await t.clients.issue("Claude", "claude-desktop");
    await t.clients.issue("Cursor", "cursor");
    expect(tokenOf(t, "c1")).not.toBe(tokenOf(t, "c2"));
    expect(t.clients.authenticate(tokenOf(t, "c2"))).toMatchObject({ name: "Cursor" });
    expect(await t.clients.issue("", "other")).toEqual({
      ok: false,
      message: "Write a name for the app.",
    });
    expect(await t.clients.issue("x".repeat(61), "other")).toMatchObject({ ok: false });
    expect(await t.clients.issue("claude", "other")).toEqual({
      ok: false,
      message: "There is an app with that name already.",
    });
    expect(await t.clients.issue("Other", "nonsense" as never)).toMatchObject({ ok: false });
    expect(t.clients.list().map((client) => client.name)).toEqual(["Claude", "Cursor"]);
  });

  it("does not approve an app when the Keychain cannot keep its token", async () => {
    const t = setup();
    t.keychain.failSet = true;
    expect(await t.clients.issue("Claude", "claude-desktop")).toEqual({
      ok: false,
      message: "Murmur could not keep the token in the Keychain.",
    });
    expect(t.clients.list()).toEqual([]);
  });

  it("notes when an app was last used, no more than once a minute", async () => {
    const t = setup();
    await t.clients.issue("Claude", "claude-desktop");
    const token = tokenOf(t, "c1");
    expect(t.clients.authenticate(token)?.lastUsedAt).toBe(1_000_000);
    t.advance(10_000);
    t.clients.authenticate(token);
    expect(t.clients.get("c1")?.lastUsedAt).toBe(1_000_000);
    t.advance(60_000);
    expect(t.clients.authenticate(token)?.lastUsedAt).toBe(1_070_000);
  });

  it("rotating gives a new token and the old one stops at once; connections end", async () => {
    const t = setup();
    await t.clients.issue("Claude", "claude-desktop");
    const old = tokenOf(t, "c1");
    expect(await t.clients.rotate("c1")).toMatchObject({ ok: true });
    expect(tokenOf(t, "c1")).not.toBe(old);
    expect(t.clients.authenticate(old)).toBeNull();
    expect(t.clients.authenticate(tokenOf(t, "c1"))).not.toBeNull();
    expect(t.onEnded).toHaveBeenCalledWith("c1");
    expect(await t.clients.rotate("nope")).toEqual({ ok: false, message: "That app is gone." });
    t.keychain.failSet = true;
    expect(await t.clients.rotate("c1")).toMatchObject({ ok: false });
    // A failed rotation leaves the working token alone.
    expect(t.clients.authenticate(tokenOf(t, "c1"))).not.toBeNull();
  });

  it("revoking takes the token out of use before the Keychain item goes", async () => {
    const t = setup();
    await t.clients.issue("Claude", "claude-desktop");
    await t.clients.issue("Cursor", "cursor");
    const token = tokenOf(t, "c1");
    expect(await t.clients.revoke("c1")).toMatchObject({ ok: true });
    expect(t.clients.authenticate(token)).toBeNull();
    expect(t.keychain.items.has(`${MCP_KEYCHAIN_SERVICE}|${clientTokenAccount("c1")}`)).toBe(false);
    expect(t.onEnded).toHaveBeenCalledWith("c1");
    expect(t.clients.list().map((client) => client.id)).toEqual(["c2"]);
    // The other app is untouched, and the name can be used again.
    expect(t.clients.authenticate(tokenOf(t, "c2"))).not.toBeNull();
    expect(await t.clients.issue("Claude", "claude-desktop")).toMatchObject({ ok: true });
    expect(await t.clients.revoke("c1")).toEqual({ ok: false, message: "That app is gone." });
  });

  it("revokes even when the Keychain item cannot be deleted, and says so in the log", async () => {
    const t = setup();
    await t.clients.issue("Claude", "claude-desktop");
    const token = tokenOf(t, "c1");
    t.keychain.failDelete = true;
    expect(await t.clients.revoke("c1")).toMatchObject({ ok: true });
    expect(t.clients.authenticate(token)).toBeNull();
    expect(t.warn).toHaveBeenCalled();
  });

  it("gives a token only for an app that exists, and reset removes every app", async () => {
    const t = setup();
    await t.clients.issue("Claude", "claude-desktop");
    await t.clients.issue("Cursor", "cursor");
    expect(await t.clients.token("nope")).toBeNull();
    await t.clients.reset();
    expect(t.clients.list()).toEqual([]);
    expect(t.keychain.items.size).toBe(0);
  });
});
