import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/database";
import { createConnectorStore } from "./connector-store";

function setup() {
  const db = openDatabase(":memory:");
  return { db, store: createConnectorStore(db) };
}

const account = (id: string, email: string, at = 1, connector = "fake") => ({
  id,
  connector,
  email,
  scopes: ["read", "read", "write"],
  at,
});

describe("connector store (CN-01)", () => {
  it("adds accounts, keeps the scopes once, and lists them oldest first", () => {
    const { store } = setup();
    const b = store.upsertAccount(account("b", "b@example.com", 2));
    store.upsertAccount(account("a", "a@example.com", 1));
    store.upsertAccount(account("c", "c@example.com", 3, "other"));
    expect(b).toMatchObject({
      id: "b",
      connector: "fake",
      email: "b@example.com",
      scopes: ["read", "write"],
      status: "connected",
      statusReason: null,
      lastSyncAt: null,
      createdAt: 2,
    });
    expect(store.list().map((a) => a.id)).toEqual(["a", "b", "c"]);
    expect(store.list("fake").map((a) => a.id)).toEqual(["a", "b"]);
    expect(store.get("zzz")).toBeNull();
  });

  it("reconnecting the same email keeps the account and makes it connected", () => {
    const { store } = setup();
    store.upsertAccount(account("a", "a@example.com"));
    store.setStatus("a", "needs_attention", "Gone.");
    const again = store.upsertAccount({ ...account("new-id", "a@example.com", 9), scopes: ["x"] });
    expect(again).toMatchObject({
      id: "a",
      scopes: ["x"],
      status: "connected",
      statusReason: null,
    });
    expect(store.list()).toHaveLength(1);
  });

  it("keeps a reason only for needs attention, and the time of the last sync", () => {
    const { store } = setup();
    store.upsertAccount(account("a", "a@example.com"));
    store.setStatus("a", "needs_attention", "Connect again.");
    expect(store.get("a")).toMatchObject({
      status: "needs_attention",
      statusReason: "Connect again.",
    });
    store.setStatus("a", "disabled", "ignored");
    expect(store.get("a")).toMatchObject({ status: "disabled", statusReason: null });
    store.setLastSync("a", 42);
    expect(store.get("a")?.lastSyncAt).toBe(42);
  });

  it("caches text for its time to live, replaces it, and prunes what is old", () => {
    const { store } = setup();
    store.upsertAccount(account("a", "a@example.com"));
    store.cachePut("a", "events", "k1", "[1]", 1_000, 500);
    store.cachePut("a", "events", "k2", "[2]", 1_000, 5_000);
    expect(store.cacheGet("a", "events", "k1", 1_499)).toBe("[1]");
    expect(store.cacheGet("a", "events", "k1", 1_500)).toBeNull();
    expect(store.cacheGet("a", "other", "k1", 1_100)).toBeNull();
    store.cachePut("a", "events", "k1", "[3]", 2_000, 500);
    expect(store.cacheGet("a", "events", "k1", 2_100)).toBe("[3]");
    expect(store.cachePrune(2_600)).toBe(1);
    expect(store.cacheGet("a", "events", "k2", 2_600)).toBe("[2]");
  });

  it("removing an account removes its cache and nobody else's", () => {
    const { store, db } = setup();
    store.upsertAccount(account("a", "a@example.com"));
    store.upsertAccount(account("b", "b@example.com"));
    store.cachePut("a", "events", "k", "A", 1, 100);
    store.cachePut("b", "events", "k", "B", 1, 100);
    store.remove("a");
    expect(store.get("a")).toBeNull();
    expect(db.prepare("SELECT account_id FROM connector_cache").all()).toEqual([
      { account_id: "b" },
    ]);
    store.cacheClear("b");
    expect(db.prepare("SELECT COUNT(*) AS n FROM connector_cache").get()).toEqual({ n: 0 });
  });
});
