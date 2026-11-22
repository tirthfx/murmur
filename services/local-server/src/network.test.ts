import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalServer } from "./server.ts";
import { inRange, parseCidr, type Cidr } from "./network.ts";
import { startHarness, type Json } from "./test-helpers.ts";

const ranges = (...text: string[]): Cidr[] => text.map((entry) => parseCidr(entry)!);

describe("address ranges", () => {
  it("are read as CIDR ranges or single addresses, for IPv4 and IPv6", () => {
    expect(parseCidr("10.0.0.0/8")).toMatchObject({ text: "10.0.0.0/8" });
    expect(parseCidr(" 192.168.1.5 ")?.text).toBe("192.168.1.5/32");
    expect(parseCidr("fd00::/8")?.text).toBe("fd00::/8");
    expect(parseCidr("::1")?.text).toBe("::1/128");
    for (const bad of [
      "",
      "nope",
      "10.0.0.0/33",
      "10.0.0.0/-1",
      "10.0.0/8",
      "fd00::/129",
      "1.2.3.4/x",
      "999.1.1.1",
    ])
      expect(parseCidr(bad), bad).toBeNull();
  });

  it("match the addresses inside them and no others", () => {
    const lan = ranges("10.0.0.0/8", "192.168.1.0/24");
    expect(inRange("10.200.3.4", lan)).toBe(true);
    expect(inRange("192.168.1.77", lan)).toBe(true);
    expect(inRange("192.168.2.1", lan)).toBe(false);
    expect(inRange("11.0.0.1", lan)).toBe(false);
    expect(inRange("172.16.0.1", lan)).toBe(false);
    expect(inRange("not an address", lan)).toBe(false);
    const v6 = ranges("fd00::/8", "2001:db8::/32");
    expect(inRange("fd12:3456::1", v6)).toBe(true);
    expect(inRange("2001:db8:1::5", v6)).toBe(true);
    expect(inRange("2001:db9::1", v6)).toBe(false);
    expect(inRange("fe80::1%en0", ranges("fe80::/10"))).toBe(true);
    // An IPv4 address that arrives as an IPv4-mapped IPv6 address is the same address.
    expect(inRange("::ffff:10.1.2.3", lan)).toBe(true);
    expect(inRange("::ffff:8.8.8.8", lan)).toBe(false);
    expect(inRange("1.2.3.4", ranges("0.0.0.0/0"))).toBe(true);
    expect(inRange("1.2.3.4", ranges("1.2.3.4"))).toBe(true);
    expect(inRange("1.2.3.5", ranges("1.2.3.4"))).toBe(false);
  });
});

describe("the allowlist on the server", () => {
  it("lets this machine in and, from another address, refuses before anything else with 403 and a rate-limited audit entry", async () => {
    let from = "127.0.0.1";
    const h = await startHarness({ remoteAddress: () => from });
    const put = (body: unknown) =>
      h.call("PUT", "/v1/network/allowlist", { token: h.owner.token, body });
    expect((await h.call("GET", "/v1/health")).status).toBe(200);

    from = "10.1.2.3";
    // Not on the list: even the health check and an invalid token are refused alike.
    for (const path of ["/v1/health", "/v1/me", "/v1/audit"]) {
      const refused = await h.call("GET", path, { token: h.owner.token });
      expect(refused.status, path).toBe(403);
      expect(refused.json!["error"].code).toBe("ip_not_allowed");
    }
    expect(
      (await h.call("POST", "/v1/sessions", { body: { email: "x", password: "y" } })).status,
    ).toBe(403);
    from = "127.0.0.1";
    const denied = (
      await h.call("GET", "/v1/audit?action=network.denied", { token: h.owner.token })
    ).json!["events"] as Json[];
    // Five refusals from one address are one entry.
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({
      targetId: "10.1.2.3",
      detail: { reason: "not_in_allowlist" },
    });

    // A minute later it is written again.
    h.clock.now += 61_000;
    from = "10.1.2.3";
    await h.call("GET", "/v1/health");
    from = "127.0.0.1";
    expect(
      (await h.call("GET", "/v1/audit?action=network.denied", { token: h.owner.token })).json![
        "events"
      ] as Json[],
    ).toHaveLength(2);

    // Add the range and it works; another address in the same network too.
    expect((await put({ ranges: ["10.0.0.0/8"] })).json).toEqual({ ranges: ["10.0.0.0/8"] });
    from = "10.9.9.9";
    expect((await h.call("GET", "/v1/health")).status).toBe(200);
    from = "192.168.0.1";
    expect((await h.call("GET", "/v1/health")).status).toBe(403);

    // Taking the last other entry out does not lock out this machine.
    from = "127.0.0.1";
    expect((await put({ ranges: [] })).status).toBe(200);
    expect((await h.call("GET", "/v1/health")).status).toBe(200);
    expect((await h.call("GET", "/v1/me", { token: h.owner.token })).status).toBe(200);
    from = "::1";
    expect((await h.call("GET", "/v1/health")).status).toBe(200);
    from = "::ffff:127.0.0.1";
    expect((await h.call("GET", "/v1/health")).status).toBe(200);
    await h.close();
  });

  it("is for the owner of the server, and checks the entries", async () => {
    const h = await startHarness();
    const admin = await h.person("Ada");
    expect(
      (await h.call("PUT", "/v1/network/allowlist", { token: admin.token, body: { ranges: [] } }))
        .status,
    ).toBe(403);
    expect((await h.call("GET", "/v1/network/allowlist", { token: admin.token })).status).toBe(403);
    const put = (ranges: unknown) =>
      h.call("PUT", "/v1/network/allowlist", { token: h.owner.token, body: { ranges } });
    expect((await put("10.0.0.0/8")).json!["error"].code).toBe("invalid_allowlist");
    expect((await put(["10.0.0.0/8", "bad"])).status).toBe(400);
    expect((await put(Array.from({ length: 101 }, (_, i) => `10.0.${i}.0/24`))).status).toBe(400);
    expect((await put(["10.0.0.5", "10.0.0.5/32", "fd00::/8"])).json).toEqual({
      ranges: ["10.0.0.5/32", "fd00::/8"],
    });
    expect(
      (await h.call("GET", "/v1/network/allowlist", { token: h.owner.token })).json!["ranges"],
    ).toEqual(["10.0.0.5/32", "fd00::/8"]);
    const changed = (
      await h.call("GET", "/v1/audit?action=network.allowlist_changed", { token: h.owner.token })
    ).json!["events"] as Json[];
    expect(changed[0]!["detail"]).toEqual({ from: 2, to: 2 });
    await h.close();
  });

  it("does not trust a header that names another address", async () => {
    const server = createLocalServer({
      dbPath: ":memory:",
      port: 0,
      remoteAddress: () => "203.0.113.9",
    });
    const { port } = await server.listen();
    const res = await fetch(`http://127.0.0.1:${port}/v1/health`, {
      headers: { "x-forwarded-for": "127.0.0.1", forwarded: "for=127.0.0.1" },
    });
    expect(res.status).toBe(403);
    await server.close();
  });

  it("listens on the network only when it is asked to, and then accepts an address as the host", async () => {
    expect(() => createLocalServer({ dbPath: ":memory:", host: "0.0.0.0" })).toThrow(
      /this machine only/,
    );
    const lan = createLocalServer({ dbPath: ":memory:", host: "0.0.0.0", allowLan: true, port: 0 });
    const { port } = await lan.listen();
    const res = await fetch(`http://127.0.0.1:${port}/v1/health`);
    expect(res.status).toBe(200);
    await lan.close();
  });

  it("gives the owner a way back in from the host machine", () => {
    const dir = mkdtempSync(join(tmpdir(), "allow-cli-"));
    const file = join(dir, "murmur-server.db");
    const local = createLocalServer({ dbPath: file, port: 0 });
    local.network.set(null, ["203.0.113.0/24"]);
    expect(local.network.allowlist()).toEqual(["203.0.113.0/24"]);
    return local.close().then(() => {
      const out = execFileSync(process.execPath, ["src/cli.ts", "reset-allowlist"], {
        cwd: join(import.meta.dirname, ".."),
        env: { ...process.env, MURMUR_SERVER_DIR: dir, NODE_NO_WARNINGS: "1" },
        encoding: "utf8",
      });
      expect(out).toContain("back to this machine only");
      const again = createLocalServer({ dbPath: file, port: 0 });
      expect(again.network.allowlist()).toEqual(["127.0.0.1/32", "::1/128"]);
      expect(again.audit.list({ action: "network.allowlist_reset" }).events).toHaveLength(1);
      return again.close();
    });
  });
});
