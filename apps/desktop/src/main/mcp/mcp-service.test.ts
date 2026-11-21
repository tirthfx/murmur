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
import { createMeetingNotesStore } from "../meetings/meeting-notes-store";
import { createMeetingsStore } from "../meetings/meetings-store";
import { createSpeakersStore } from "../meetings/speakers-store";
import { createSummariesStore } from "../meetings/summaries-store";
import { createTasksService } from "../meetings/tasks-service";
import { createTranscriptStore } from "../meetings/transcript-store";
import { createMcpService, type McpService } from "./mcp-service";

class FakeKeychain implements Keychain {
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
  const service = createMcpService({
    settings: () => settings,
    db,
    data: {
      meetings,
      transcript: createTranscriptStore(db),
      speakers: createSpeakersStore(db, { now: () => 1 }),
      summaries: createSummariesStore(db),
      tasks: createTasksService(db, { newId: () => `t${++n}`, now: () => 1 }),
      folders: createFoldersStore(db, { now: () => 1, newId: () => `f${++n}` }),
      ask: createAskIndex(db, { now: () => 1 }),
      notes: createMeetingNotesStore(db),
    },
    keychain,
    socketPath,
    serverVersion: "0.0.0",
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    now: Date.now,
    newId: () => `id-${++n}`,
  });
  services.push(service);
  /** Approves an app and gives its token. */
  const approve = async (name = "Claude desktop") => {
    const result = await service.clients.issue(name, "claude-desktop");
    if (!result.ok) throw new Error(result.message);
    return { client: result.client, token: (await service.clients.token(result.client.id))! };
  };
  return {
    db,
    service,
    keychain,
    socketPath,
    logs,
    approve,
    set: (next: Partial<McpSettings>) => (settings = { ...settings, ...next }),
  };
}

const authorize = (token: string) =>
  `${JSON.stringify({ jsonrpc: "2.0", method: "murmur/authorize", params: { token } })}\n`;

type Reply = { id?: number; result?: Record<string, unknown>; error?: { code: number } };

/** Opens a connection with a token, sends messages, and returns the replies once it closes. */
const rpc = (socketPath: string, token: string, ...messages: object[]) =>
  new Promise<Reply[]>((resolve, reject) => {
    const connection = net.connect(socketPath, () =>
      connection.end(authorize(token) + messages.map((m) => `${JSON.stringify(m)}\n`).join("")),
    );
    let received = "";
    connection.setEncoding("utf8");
    connection.on("data", (chunk: string) => (received += chunk));
    connection.on("close", () =>
      resolve(
        received
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Reply),
      ),
    );
    connection.on("error", reject);
  });

const call = (id: number, name: string, args: object = {}) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
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

const httpCall = (
  url: string,
  token: string,
  body: object = { jsonrpc: "2.0", id: 1, method: "ping" },
) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

const toolNames = (reply: Reply) =>
  (reply.result as { tools: { name: string }[] }).tools.map((t) => t.name);

describe("MCP service (CN-11)", () => {
  it("is off by default: no socket, no port, nothing in the Keychain", async () => {
    const t = setup();
    expect(await t.service.apply()).toEqual(MCP_STATUS_OFF);
    expect(await connectable(t.socketPath)).toBe(false);
    expect(t.keychain.items.size).toBe(0);
  });

  it("serves the tools to an approved app over the socket, and closes it when disabled", async () => {
    const t = setup({ enabled: true });
    const { token } = await t.approve();
    const status = await t.service.apply();
    expect(status).toMatchObject({
      running: true,
      stdio: { wanted: true, listening: true, path: t.socketPath, problem: null },
      http: { wanted: false, listening: false, url: null },
    });
    const [listed, meeting] = await rpc(
      t.socketPath,
      token,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      call(2, "get_meeting", { meetingId: "m-1" }),
    );
    expect(toolNames(listed!)).toEqual([
      "search_meetings",
      "get_meeting",
      "get_summary",
      "get_transcript",
      "list_tasks",
      "list_folders",
    ]);
    expect(
      JSON.parse((meeting!.result as { content: { text: string }[] }).content[0]!.text),
    ).toMatchObject({
      title: "Sync",
    });
    t.set({ enabled: false });
    expect(await t.service.apply()).toEqual(MCP_STATUS_OFF);
    expect(await connectable(t.socketPath)).toBe(false);
  });

  it("refuses an app with no token or a wrong one, over the socket and HTTP", async () => {
    const t = setup({
      enabled: true,
      transport: { stdio: true, http: true },
      http: { port: 0 },
      write: { createTask: false, addNote: false },
    });
    const status = await t.service.apply();
    const [none] = await rpc(t.socketPath, "wrong-token", {
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
    });
    expect(none).toMatchObject({ error: { code: -32001 } });
    expect((await httpCall(status.http.url!, "wrong-token")).status).toBe(401);
  });

  it("an app's token works over HTTP, and the same app is counted on both", async () => {
    const t = setup({ enabled: true, transport: { stdio: false, http: true }, http: { port: 0 } });
    const { token } = await t.approve();
    const status = await t.service.apply();
    expect(status.http.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(status.stdio.listening).toBe(false);
    expect((await httpCall(status.http.url!, token)).status).toBe(200);
    expect(t.logs.join("\n")).not.toContain(token);
  });

  it("revoking an app makes its token fail at once, and ends its connections", async () => {
    const t = setup({ enabled: true, transport: { stdio: true, http: true }, http: { port: 0 } });
    const { client, token } = await t.approve();
    const status = await t.service.apply();
    expect((await httpCall(status.http.url!, token)).status).toBe(200);
    const open = net.connect(t.socketPath);
    await new Promise((resolve) => open.once("connect", resolve));
    open.write(authorize(token));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(await t.service.clients.revoke(client.id)).toMatchObject({ ok: true });
    expect((await httpCall(status.http.url!, token)).status).toBe(401);
    await vi.waitFor(() => expect(open.destroyed).toBe(true));
    const [reply] = await rpc(t.socketPath, token, { jsonrpc: "2.0", id: 1, method: "ping" });
    expect(reply).toMatchObject({ error: { code: -32001 } });
  });

  it("rotating a token stops the old one at once and the new one works", async () => {
    const t = setup({ enabled: true, transport: { stdio: true, http: true }, http: { port: 0 } });
    const { client, token } = await t.approve();
    const status = await t.service.apply();
    expect(await t.service.clients.rotate(client.id)).toMatchObject({ ok: true });
    const fresh = (await t.service.clients.token(client.id))!;
    expect(fresh).not.toBe(token);
    expect((await httpCall(status.http.url!, token)).status).toBe(401);
    expect((await httpCall(status.http.url!, fresh)).status).toBe(200);
    expect(
      (await rpc(t.socketPath, fresh, { jsonrpc: "2.0", id: 1, method: "ping" }))[0],
    ).toMatchObject({ id: 1 });
  });

  it("disabling closes the HTTP port: connection refused", async () => {
    const t = setup({ enabled: true, transport: { stdio: true, http: true }, http: { port: 0 } });
    const { token } = await t.approve();
    const on = await t.service.apply();
    expect((await httpCall(on.http.url!, token)).status).toBe(200);
    t.set({ enabled: false });
    await t.service.apply();
    await expect(httpCall(on.http.url!, token)).rejects.toThrow();
    expect(await connectable(t.socketPath)).toBe(false);
  });

  it("follows a change of transport or port while it is on", async () => {
    const t = setup({ enabled: true, transport: { stdio: true, http: false } });
    const { token } = await t.approve();
    await t.service.apply();
    t.set({ transport: { stdio: false, http: true }, http: { port: 0 } });
    const status = await t.service.apply();
    expect(status.stdio.listening).toBe(false);
    expect(await connectable(t.socketPath)).toBe(false);
    expect(status.http.listening).toBe(true);
    const first = status.http.url;
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const { port } = probe.address() as { port: number };
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    t.set({ http: { port } });
    const moved = await t.service.apply();
    expect(moved.http.url).toBe(`http://127.0.0.1:${port}/mcp`);
    expect((await httpCall(moved.http.url!, token)).status).toBe(200);
    await expect(httpCall(first!, token)).rejects.toThrow();
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

  it("handles calls to apply that come together, one after the other", async () => {
    const t = setup({ enabled: true });
    const results = await Promise.all([t.service.apply(), t.service.apply(), t.service.apply()]);
    expect(results.every((status) => status.stdio.listening)).toBe(true);
    expect(await connectable(t.socketPath)).toBe(true);
  });

  it("counts calls per app against the limit in the settings", async () => {
    const t = setup({ enabled: true, rateLimitPerMinute: 2 });
    const { token } = await t.approve();
    await t.service.apply();
    const replies = await rpc(
      t.socketPath,
      token,
      call(1, "list_folders"),
      call(2, "list_folders"),
      call(3, "list_folders"),
    );
    const refused = replies.filter((reply) => (reply.result as { isError?: boolean }).isError);
    expect(refused).toHaveLength(1);
    expect(JSON.stringify(refused[0])).toContain("Too many calls");
    // A new connection of the same app shares the count.
    const [again] = await rpc(t.socketPath, token, call(4, "list_folders"));
    expect((again!.result as { isError?: boolean }).isError).toBe(true);
  });
});

describe("write tools and the log (CN-11)", () => {
  it("a write tool is not offered, and is refused, while its switch is off; it works when on", async () => {
    const t = setup({ enabled: true });
    const { token } = await t.approve();
    await t.service.apply();
    const [list, refused] = await rpc(
      t.socketPath,
      token,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      call(2, "create_task", { title: "Book the venue" }),
    );
    expect(toolNames(list!)).not.toContain("create_task");
    expect(JSON.stringify(refused)).toContain("The create_task tool is turned off in Murmur.");
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 0 });

    t.set({ write: { createTask: true, addNote: false } });
    const [on, made, note] = await rpc(
      t.socketPath,
      token,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      call(2, "create_task", { title: "Book the venue" }),
      call(3, "add_note", { meetingId: "m-1", text: "hello" }),
    );
    expect(toolNames(on!)).toContain("create_task");
    expect(toolNames(on!)).not.toContain("add_note");
    expect(JSON.stringify(made)).toContain("suggested");
    expect(JSON.stringify(note)).toContain("turned off");
    expect(t.db.prepare("SELECT status FROM tasks").get()).toEqual({ status: "suggested" });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM meeting_notes").get()).toEqual({ n: 0 });

    t.set({ write: { createTask: false, addNote: true } });
    const [added] = await rpc(
      t.socketPath,
      token,
      call(1, "add_note", { meetingId: "m-1", text: "hello" }),
    );
    expect(JSON.stringify(added)).toContain('\\"added\\":5');
  });

  it("every call is in the log with the app, the tool and sizes, and never the arguments or the result", async () => {
    const t = setup({ enabled: true, write: { createTask: true, addNote: false } });
    const { token } = await t.approve("Claude desktop");
    await t.service.apply();
    await rpc(
      t.socketPath,
      token,
      call(1, "get_meeting", { meetingId: "m-1" }),
      call(2, "create_task", { title: "A very private task about the merger" }),
      call(3, "add_note", { meetingId: "m-1", text: "private note text" }),
      call(4, "nope"),
      call(5, "get_meeting", { meetingId: "missing" }),
    );
    const entries = t.service.audit.list();
    // Calls on one connection run together, so the order is not the order sent.
    expect(entries.map((e) => `${e.client}|${e.tool}|${e.ok}|${e.write}`).sort()).toEqual(
      [
        "Claude desktop|get_meeting|true|false",
        "Claude desktop|get_meeting|false|false",
        "Claude desktop|add_note|false|true",
        "Claude desktop|create_task|true|true",
      ].sort(),
    );
    expect(entries.every((e) => e.resultBytes > 0)).toBe(true);
    // Contents never reach the table or the log.
    const dump = JSON.stringify(t.db.prepare("SELECT * FROM mcp_audit").all());
    for (const secret of ["merger", "private note", "Sync", token])
      expect(dump).not.toContain(secret);
    expect(t.logs.join("\n")).not.toContain("merger");
    expect(t.db.prepare("SELECT args_hash FROM mcp_audit").all()).toSatisfy(
      (rows: { args_hash: string }[]) => rows.every((row) => /^[0-9a-f]{64}$/.test(row.args_hash)),
    );
  });

  it("reset removes every app, its token and the log", async () => {
    const t = setup({ enabled: true });
    const { token } = await t.approve();
    t.keychain.items.set("com.murmur.mcp|http-token", "old");
    await t.service.apply();
    await rpc(t.socketPath, token, call(1, "list_folders"));
    expect(t.service.audit.list()).toHaveLength(1);
    await t.service.reset();
    expect(t.service.clients.list()).toEqual([]);
    expect(t.service.audit.list()).toEqual([]);
    expect(t.keychain.items.size).toBe(0);
  });
});
