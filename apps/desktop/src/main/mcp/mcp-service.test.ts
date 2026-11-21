import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MCP_SETTINGS,
  MCP_STATUS_OFF,
  type Keychain,
  type McpSettings,
} from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createAskIndex } from "../meetings/ask-index";
import { createFoldersStore } from "../meetings/folders-store";
import { createMeetingsStore } from "../meetings/meetings-store";
import { createSpeakersStore } from "../meetings/speakers-store";
import { createSummariesStore } from "../meetings/summaries-store";
import { createTasksService } from "../meetings/tasks-service";
import { createTranscriptStore } from "../meetings/transcript-store";
import { createMcpService, MCP_TOKEN_ITEM, type McpService } from "./mcp-service";

class FakeKeychain implements Keychain {
  items = new Map<string, string>();
  failGet = false;
  sets = 0;
  async get(service: string, account: string) {
    if (this.failGet) throw new Error("locked");
    return this.items.get(`${service}|${account}`) ?? null;
  }
  async set(service: string, account: string, value: string) {
    this.sets++;
    this.items.set(`${service}|${account}`, value);
  }
  async delete(service: string, account: string) {
    return this.items.delete(`${service}|${account}`);
  }
}

const services: McpService[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(initial: Partial<McpSettings> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "ms-"));
  dirs.push(dir);
  const socketPath = path.join(dir, "mcp.sock");
  let settings: McpSettings = { ...DEFAULT_MCP_SETTINGS, ...initial };
  const db = openDatabase(":memory:");
  let n = 0;
  const meetings = createMeetingsStore(db);
  meetings.create({
    id: "m-1",
    title: "Sync",
    startedAt: 1_000,
    source: "ad_hoc",
    folder: "/m/m-1",
  });
  const keychain = new FakeKeychain();
  const logs: string[] = [];
  const onCall = vi.fn();
  const service = createMcpService({
    settings: () => settings,
    data: {
      meetings,
      transcript: createTranscriptStore(db),
      speakers: createSpeakersStore(db, { now: () => 1 }),
      summaries: createSummariesStore(db),
      tasks: createTasksService(db, { newId: () => `t${++n}`, now: () => 1 }),
      folders: createFoldersStore(db, { now: () => 1, newId: () => `f${++n}` }),
      ask: createAskIndex(db, { now: () => 1 }),
    },
    keychain,
    socketPath,
    serverVersion: "0.0.0",
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    now: Date.now,
    onCall,
  });
  services.push(service);
  return {
    service,
    keychain,
    socketPath,
    logs,
    onCall,
    set: (next: Partial<McpSettings>) => (settings = { ...settings, ...next }),
  };
}

const rpc = (socketPath: string, message: object) =>
  new Promise<{
    result?: { content?: { text: string }[] } & Record<string, unknown>;
    error?: unknown;
  }>((resolve, reject) => {
    const connection = net.connect(socketPath, () =>
      connection.end(`${JSON.stringify(message)}\n`),
    );
    let received = "";
    connection.setEncoding("utf8");
    connection.on("data", (chunk: string) => (received += chunk));
    connection.on("close", () => resolve(JSON.parse(received.split("\n")[0]!)));
    connection.on("error", reject);
  });

const connectable = (socketPath: string) =>
  new Promise<boolean>((resolve) => {
    const connection = net.connect(socketPath);
    connection.once("connect", () => {
      connection.destroy();
      resolve(true);
    });
    connection.once("error", () => resolve(false));
  });

const httpPing = (url: string, token: string) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });

describe("MCP service (CN-11)", () => {
  it("is off by default: no socket, no port, nothing in the Keychain", async () => {
    const t = setup();
    expect(await t.service.apply()).toEqual(MCP_STATUS_OFF);
    expect(await connectable(t.socketPath)).toBe(false);
    expect(t.keychain.items.size).toBe(0);
  });

  it("turns the socket on, serves the tools, and closes it when disabled", async () => {
    const t = setup({ enabled: true });
    const status = await t.service.apply();
    expect(status).toMatchObject({
      running: true,
      stdio: { wanted: true, listening: true, path: t.socketPath, problem: null },
      http: { wanted: false, listening: false, url: null },
    });
    const listed = await rpc(t.socketPath, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect((listed.result as { tools: { name: string }[] }).tools.map((tool) => tool.name)).toEqual(
      [
        "search_meetings",
        "get_meeting",
        "get_summary",
        "get_transcript",
        "list_tasks",
        "list_folders",
      ],
    );
    const meeting = await rpc(t.socketPath, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_meeting", arguments: { meetingId: "m-1" } },
    });
    expect(JSON.parse(meeting.result!.content![0]!.text)).toMatchObject({ title: "Sync" });
    // The call is told to the audit hook with names and sizes only.
    expect(t.onCall).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "get_meeting", ok: true, resultBytes: expect.any(Number) }),
    );
    expect(t.logs.join("\n")).not.toContain("Sync");

    t.set({ enabled: false });
    expect(await t.service.apply()).toEqual(MCP_STATUS_OFF);
    expect(await connectable(t.socketPath)).toBe(false);
  });

  it("makes the access token once, keeps it in the Keychain, and uses it for HTTP", async () => {
    const t = setup({ enabled: true, transport: { stdio: false, http: true }, http: { port: 0 } });
    const status = await t.service.apply();
    expect(status.http).toMatchObject({ wanted: true, listening: true, problem: null });
    expect(status.http.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(status.stdio.listening).toBe(false);
    const token = t.keychain.items.get(`${MCP_TOKEN_ITEM.service}|${MCP_TOKEN_ITEM.account}`)!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256 bits
    expect((await httpPing(status.http.url!, token)).status).toBe(200);
    expect((await httpPing(status.http.url!, "wrong")).status).toBe(401);
    // Turning it off and on again keeps the same token.
    t.set({ enabled: false });
    await t.service.apply();
    t.set({ enabled: true });
    const again = await t.service.apply();
    expect(t.keychain.sets).toBe(1);
    expect((await httpPing(again.http.url!, token)).status).toBe(200);
    // And the token is never in the log.
    expect(t.logs.join("\n")).not.toContain(token);
  });

  it("disabling closes the HTTP port: connection refused", async () => {
    const t = setup({ enabled: true, transport: { stdio: true, http: true }, http: { port: 0 } });
    const on = await t.service.apply();
    const token = t.keychain.items.get(`${MCP_TOKEN_ITEM.service}|${MCP_TOKEN_ITEM.account}`)!;
    expect((await httpPing(on.http.url!, token)).status).toBe(200);
    t.set({ enabled: false });
    await t.service.apply();
    await expect(httpPing(on.http.url!, token)).rejects.toThrow();
    expect(await connectable(t.socketPath)).toBe(false);
  });

  it("follows a change of transport or port while it is on", async () => {
    const t = setup({ enabled: true, transport: { stdio: true, http: false } });
    await t.service.apply();
    t.set({ transport: { stdio: false, http: true }, http: { port: 0 } });
    const status = await t.service.apply();
    expect(status.stdio.listening).toBe(false);
    expect(await connectable(t.socketPath)).toBe(false);
    expect(status.http.listening).toBe(true);
    const first = status.http.url;
    // A new port: the old one is closed, the new one answers.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const { port } = probe.address() as { port: number };
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    t.set({ http: { port } });
    const moved = await t.service.apply();
    expect(moved.http.url).toBe(`http://127.0.0.1:${port}/mcp`);
    expect(moved.http.url).not.toBe(first);
    const token = t.keychain.items.get(`${MCP_TOKEN_ITEM.service}|${MCP_TOKEN_ITEM.account}`)!;
    expect((await httpPing(moved.http.url!, token)).status).toBe(200);
    await expect(httpPing(first!, token)).rejects.toThrow();
  });

  it("says why when the port is taken, and keeps the other transport", async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve));
    const { port } = taken.address() as { port: number };
    const t = setup({ enabled: true, transport: { stdio: true, http: true }, http: { port } });
    const status = await t.service.apply();
    expect(status.running).toBe(true);
    expect(status.stdio.listening).toBe(true);
    expect(status.http).toMatchObject({
      wanted: true,
      listening: false,
      url: null,
      problem: `Port ${port} is in use. Choose another port.`,
    });
    taken.close();
  });

  it("does not start HTTP when the Keychain cannot give the token", async () => {
    const t = setup({ enabled: true, transport: { stdio: false, http: true }, http: { port: 0 } });
    t.keychain.failGet = true;
    const status = await t.service.apply();
    expect(status.http).toMatchObject({
      listening: false,
      problem: "Murmur could not use the Keychain for the access token.",
    });
    expect(status.running).toBe(false);
  });

  it("handles calls to apply that come together, one after the other", async () => {
    const t = setup({ enabled: true });
    const results = await Promise.all([t.service.apply(), t.service.apply(), t.service.apply()]);
    expect(results.every((status) => status.stdio.listening)).toBe(true);
    expect(await connectable(t.socketPath)).toBe(true);
  });

  it("counts calls per connection against the limit in the settings", async () => {
    const t = setup({ enabled: true, rateLimitPerMinute: 2 });
    await t.service.apply();
    const connection = net.connect(t.socketPath);
    await new Promise((resolve) => connection.once("connect", resolve));
    const lines: string[] = [];
    connection.setEncoding("utf8");
    connection.on("data", (chunk: string) => lines.push(...chunk.split("\n").filter(Boolean)));
    for (let id = 1; id <= 3; id++)
      connection.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "list_folders" } })}\n`,
      );
    await vi.waitFor(() => expect(lines).toHaveLength(3));
    connection.destroy();
    const refused = lines
      .map(
        (l) =>
          JSON.parse(l) as {
            id: number;
            result: { isError?: boolean; content: { text: string }[] };
          },
      )
      .filter((reply) => reply.result.isError);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.result.content[0]!.text).toContain("Too many calls");
  });
});
