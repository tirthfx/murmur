import { mkdtempSync, rmSync, statSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MCP_LIMITS } from "@murmur/shared";
import { bearerMatches, HTTP_PATH, startHttpTransport } from "./http-transport";
import { createMcpServer } from "./mcp-server";
import { SOCKET_PATH_MAX, startSocketTransport, type RunningTransport } from "./socket-transport";

const server = () =>
  createMcpServer({
    tools: [
      {
        name: "slow",
        title: "Slow",
        description: "Answers a moment later.",
        inputSchema: { type: "object" },
        args: z.strictObject({}),
        readOnly: true,
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 60));
          return { done: true };
        },
      },
    ],
    serverName: "murmur",
    serverVersion: "1",
  });

const open: RunningTransport[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const transport of open.splice(0)) await transport.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempSocket = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mm-"));
  dirs.push(dir);
  return path.join(dir, "mcp.sock");
};

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const ping = (id: number) => line({ jsonrpc: "2.0", id, method: "ping" });

/** Sends text to a socket and collects what comes back until the server ends the connection. */
const talk = (socketPath: string, text: string, endAfter = true) =>
  new Promise<string[]>((resolve, reject) => {
    const connection = net.connect(socketPath, () => {
      connection.write(text);
      if (endAfter) connection.end();
    });
    let received = "";
    connection.setEncoding("utf8");
    connection.on("data", (chunk: string) => (received += chunk));
    connection.on("close", () => resolve(received.split("\n").filter(Boolean)));
    connection.on("error", reject);
  });

describe("socket transport (CN-11)", () => {
  it("answers one JSON-RPC message per line, and stays open for more", async () => {
    const socketPath = tempSocket();
    open.push(
      await startSocketTransport({ path: socketPath, server: server(), logger: { warn: vi.fn() } }),
    );
    const replies = await talk(socketPath, ping(1) + ping(2));
    expect(replies.map((reply) => JSON.parse(reply).id).sort()).toEqual([1, 2]);
  });

  it("answers what is still being worked on before it closes, when the client has finished writing", async () => {
    const socketPath = tempSocket();
    open.push(
      await startSocketTransport({ path: socketPath, server: server(), logger: { warn: vi.fn() } }),
    );
    const replies = await talk(
      socketPath,
      line({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "slow" } }),
    );
    expect(JSON.parse(replies[0]!)).toMatchObject({
      id: 7,
      result: { content: [{ text: '{"done":true}' }] },
    });
  });

  it("makes the socket readable by its owner only", async () => {
    const socketPath = tempSocket();
    open.push(
      await startSocketTransport({ path: socketPath, server: server(), logger: { warn: vi.fn() } }),
    );
    expect(statSync(socketPath).mode & 0o777).toBe(0o600);
  });

  it("gives each connection its own client for the rate limit and the name", async () => {
    const socketPath = tempSocket();
    const seen: string[] = [];
    const listening = createMcpServer({
      tools: [],
      serverName: "murmur",
      serverVersion: "1",
    });
    const original = listening.handleText;
    listening.handleText = async (text, client) => {
      seen.push(client.id);
      return original(text, client);
    };
    open.push(
      await startSocketTransport({
        path: socketPath,
        server: listening,
        logger: { warn: vi.fn() },
      }),
    );
    await talk(socketPath, ping(1) + ping(2));
    await talk(socketPath, ping(3));
    expect(seen[0]).toBe(seen[1]);
    expect(seen[2]).not.toBe(seen[0]);
    expect(seen[0]).toMatch(/^socket:/);
  });

  it("closes a connection that sends a line that is too long", async () => {
    const socketPath = tempSocket();
    const warn = vi.fn();
    open.push(await startSocketTransport({ path: socketPath, server: server(), logger: { warn } }));
    const replies = await talk(socketPath, "x".repeat(MCP_LIMITS.messageBytes + 10), false);
    expect(replies).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("goes away when closed: the file is removed and nothing connects", async () => {
    const socketPath = tempSocket();
    const transport = await startSocketTransport({
      path: socketPath,
      server: server(),
      logger: { warn: vi.fn() },
    });
    const held = net.connect(socketPath);
    await new Promise((resolve) => held.once("connect", resolve));
    await transport.close();
    expect(() => statSync(socketPath)).toThrow();
    await expect(talk(socketPath, ping(1))).rejects.toMatchObject({
      code: expect.stringMatching(/ENOENT|ECONNREFUSED/),
    });
  });

  it("replaces a stale socket file, and refuses a path that is too long", async () => {
    const socketPath = tempSocket();
    const first = await startSocketTransport({
      path: socketPath,
      server: server(),
      logger: { warn: vi.fn() },
    });
    // A crashed Murmur leaves the file behind; the next start takes it over.
    const second = await startSocketTransport({
      path: socketPath,
      server: server(),
      logger: { warn: vi.fn() },
    });
    open.push(first, second);
    expect((await talk(socketPath, ping(1))).length).toBe(1);
    await expect(
      startSocketTransport({
        path: `/tmp/${"x".repeat(SOCKET_PATH_MAX)}.sock`,
        server: server(),
        logger: { warn: vi.fn() },
      }),
    ).rejects.toThrow(/too long/);
  });
});

describe("HTTP transport (CN-11)", () => {
  const start = async (token: () => string | null = () => "right-token") => {
    const transport = await startHttpTransport({ port: 0, server: server(), token });
    open.push(transport);
    return { port: transport.port, url: `http://127.0.0.1:${transport.port}${HTTP_PATH}` };
  };
  const post = (
    url: string,
    init: { token?: string; headers?: Record<string, string>; body?: string; method?: string } = {},
  ) =>
    fetch(url, {
      method: init.method ?? "POST",
      headers: {
        "content-type": "application/json",
        ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
        ...init.headers,
      },
      body:
        init.method === "GET"
          ? null
          : (init.body ?? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })),
    });

  it("returns 401 without a token, and with a wrong one, before reading the body", async () => {
    const t = await start();
    const none = await post(t.url);
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain("Bearer");
    expect((await post(t.url, { token: "wrong-token" })).status).toBe(401);
    expect((await post(t.url, { headers: { authorization: "Basic abc" } })).status).toBe(401);
    // Nothing is answered while there is no token to check against.
    const closed = await start(() => null);
    expect((await post(closed.url, { token: "right-token" })).status).toBe(401);
  });

  it("answers a JSON-RPC message with the token", async () => {
    const t = await start();
    const reply = await post(t.url, { token: "right-token" });
    expect(reply.status).toBe(200);
    expect(reply.headers.get("content-type")).toContain("application/json");
    expect(await reply.json()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("answers 202 with nothing for a notification, and takes a batch", async () => {
    const t = await start();
    const note = await post(t.url, {
      token: "right-token",
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(note.status).toBe(202);
    expect(await note.text()).toBe("");
    const batch = await post(t.url, {
      token: "right-token",
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", id: 2, method: "ping" },
      ]),
    });
    expect(((await batch.json()) as { id: number }[]).map((r) => r.id)).toEqual([1, 2]);
  });

  it("takes a new token at once", async () => {
    let token = "one";
    const t = await start(() => token);
    expect((await post(t.url, { token: "one" })).status).toBe(200);
    token = "two";
    expect((await post(t.url, { token: "one" })).status).toBe(401);
    expect((await post(t.url, { token: "two" })).status).toBe(200);
  });

  it("allows only POST to /mcp, JSON, and a message of a sensible size", async () => {
    const t = await start();
    expect((await post(t.url, { token: "right-token", method: "GET" })).status).toBe(405);
    expect((await post(`${t.url}x`, { token: "right-token" })).status).toBe(404);
    expect(
      (await post(t.url, { token: "right-token", headers: { "content-type": "text/plain" } }))
        .status,
    ).toBe(415);
    const big = await post(t.url, {
      token: "right-token",
      body: "x".repeat(MCP_LIMITS.messageBytes + 10),
    }).catch(() => null);
    // The server may cut the connection or answer 413.
    expect(big === null || big.status === 413).toBe(true);
    expect(await (await post(t.url, { token: "right-token", body: "{nope" })).json()).toMatchObject(
      {
        error: { code: -32700 },
      },
    );
  });

  it("refuses a request that names another host or comes from another site", async () => {
    const t = await start();
    // fetch cannot set Host, so use http.request.
    const raw = (headers: Record<string, string>) =>
      new Promise<number>((resolve, reject) => {
        const request = httpRequest(
          { host: "127.0.0.1", port: t.port, path: HTTP_PATH, method: "POST", headers },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          },
        );
        request.on("error", reject);
        request.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
      });
    const good = { "content-type": "application/json", authorization: "Bearer right-token" };
    expect(await raw({ ...good, host: "evil.example" })).toBe(403);
    expect(await raw({ ...good, host: `localhost:${t.port}` })).toBe(200);
    expect(
      await raw({ ...good, host: `127.0.0.1:${t.port}`, origin: "https://evil.example" }),
    ).toBe(403);
    expect(
      await raw({ ...good, host: `127.0.0.1:${t.port}`, origin: "http://localhost:3000" }),
    ).toBe(200);
  });

  it("listens on 127.0.0.1 only, and refuses connections once closed", async () => {
    const transport = await startHttpTransport({ port: 0, server: server(), token: () => "t" });
    const url = `http://127.0.0.1:${transport.port}${HTTP_PATH}`;
    expect((await post(url, { token: "t" })).status).toBe(200);
    await transport.close();
    await expect(post(url, { token: "t" })).rejects.toThrow();
  });

  it("says when its port is taken", async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve));
    const { port } = taken.address() as { port: number };
    await expect(startHttpTransport({ port, server: server(), token: () => "t" })).rejects.toThrow(
      `Port ${port} is in use. Choose another port.`,
    );
    taken.close();
  });
});

describe("bearer token check", () => {
  it("accepts exactly the token", () => {
    expect(bearerMatches("Bearer abc", "abc")).toBe(true);
    for (const header of [
      undefined,
      "",
      "abc",
      "Bearer",
      "Bearer abd",
      "bearer abc",
      "Bearer abc extra",
    ])
      expect(bearerMatches(header, "abc")).toBe(false);
  });
});
