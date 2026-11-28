import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MCP_LIMITS } from "@murmur/shared";
import { createMcpServer, McpToolError, type McpClient, type McpTool } from "./mcp-server";
import { createRateLimiter } from "./rate-limit";

const tool = (over: Partial<McpTool> = {}): McpTool => ({
  name: "echo",
  title: "Echo",
  description: "Says it back.",
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
  args: z.strictObject({ text: z.string().max(10).optional() }),
  readOnly: true,
  run: (args: { text?: string }) => ({ said: args.text ?? "" }),
  ...over,
});

const setup = (
  tools: McpTool[] = [tool()],
  over: Parameters<typeof createMcpServer>[0] extends infer D ? Partial<D> : never = {},
) => {
  const onCall = vi.fn();
  const server = createMcpServer({
    tools,
    serverName: "murmur",
    serverVersion: "1.2.3",
    onCall,
    ...over,
  });
  const client: McpClient = { id: "c1", name: null };
  const call = (method: string, params?: unknown, id: number | string | undefined = 1) =>
    server.handle({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, params }, client);
  return { server, client, call, onCall };
};

describe("MCP protocol (CN-11)", () => {
  it("answers initialize with the client's protocol version when it is known, and learns its name", async () => {
    const t = setup();
    const reply = await t.call("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "Claude Desktop", version: "9" },
    });
    expect(reply).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "murmur", version: "1.2.3" },
      },
    });
    expect(t.client.name).toBe("Claude Desktop");
  });

  it("offers its newest version to a client that asks for one it does not know", async () => {
    const reply = await setup().call("initialize", { protocolVersion: "1999-01-01" });
    expect(reply?.result).toMatchObject({ protocolVersion: "2025-06-18" });
    expect((await setup().call("initialize"))?.result).toMatchObject({
      protocolVersion: "2025-06-18",
    });
  });

  it("answers ping, and gives no reply to a notification", async () => {
    const t = setup();
    expect(await t.call("ping")).toMatchObject({ id: 1, result: {} });
    const notify = (method: string) => t.server.handle({ jsonrpc: "2.0", method }, t.client);
    expect(await notify("notifications/initialized")).toBeNull();
    expect(await notify("no/such/thing")).toBeNull();
  });

  it("lists tools with the read-only hint set, and a tool that writes only while it is allowed", async () => {
    let allowed = false;
    const t = setup([tool(), tool({ name: "change", readOnly: false })], {
      writeAllowed: () => allowed,
    });
    const names = async () =>
      ((await t.call("tools/list"))?.result as { tools: { name: string }[] }).tools.map(
        (candidate) => candidate.name,
      );
    expect(await names()).toEqual(["echo"]);
    allowed = true;
    expect(await names()).toEqual(["echo", "change"]);
    expect((await t.call("tools/list"))?.result).toMatchObject({
      tools: [
        { name: "echo", annotations: { readOnlyHint: true, destructiveHint: false } },
        { name: "change", annotations: { readOnlyHint: false } },
      ],
    });
  });

  it("keeps the name an approved app was given, not the one it announces", async () => {
    const t = setup();
    t.client.name = "Claude desktop";
    await t.call("initialize", { clientInfo: { name: "something-else" } });
    expect(t.client.name).toBe("Claude desktop");
  });

  it("calls a tool and returns its result as one JSON text block", async () => {
    const t = setup();
    const reply = await t.call("tools/call", { name: "echo", arguments: { text: "hi" } });
    expect(reply?.result).toEqual({ content: [{ type: "text", text: '{"said":"hi"}' }] });
    expect(t.onCall).toHaveBeenCalledWith({
      client: "c1",
      tool: "echo",
      args: { text: "hi" },
      ok: true,
      resultBytes: 13,
      write: false,
    });
  });

  it("reports an unknown tool, a bad call and an unknown method as protocol errors", async () => {
    const t = setup();
    expect((await t.call("tools/call", { name: "nope" }))?.error).toMatchObject({ code: -32602 });
    expect((await t.call("tools/call", {}))?.error).toMatchObject({ code: -32602 });
    expect((await t.call("resources/list"))?.error).toMatchObject({ code: -32601 });
  });

  it("reports bad arguments and a tool's own failure as text the client can read", async () => {
    const t = setup([
      tool(),
      tool({
        name: "fails",
        run: () => {
          throw new McpToolError("There is no meeting x.");
        },
      }),
      tool({
        name: "crashes",
        run: () => {
          throw new Error("secret detail /Users/me/file");
        },
      }),
    ]);
    const bad = await t.call("tools/call", {
      name: "echo",
      arguments: { text: "far too long text" },
    });
    expect(bad?.result).toMatchObject({ isError: true });
    expect(JSON.stringify(bad?.result)).toContain("text: ");
    expect(
      (await t.call("tools/call", { name: "echo", arguments: { extra: 1 } }))?.result,
    ).toMatchObject({
      isError: true,
    });
    expect((await t.call("tools/call", { name: "fails" }))?.result).toEqual({
      content: [{ type: "text", text: "There is no meeting x." }],
      isError: true,
    });
    // An unexpected error never leaks its message.
    const crash = await t.call("tools/call", { name: "crashes" });
    expect(JSON.stringify(crash)).not.toContain("secret detail");
    expect(t.onCall).toHaveBeenLastCalledWith(
      expect.objectContaining({ tool: "crashes", ok: false }),
    );
  });

  it("refuses a result bigger than 200 KB rather than sending it", async () => {
    const t = setup([tool({ run: () => ({ big: "x".repeat(MCP_LIMITS.responseBytes) }) })]);
    const reply = await t.call("tools/call", { name: "echo" });
    expect(reply?.result).toMatchObject({ isError: true });
    expect(JSON.stringify(reply)).toContain("bigger than 200 KB");
    expect(JSON.stringify(reply).length).toBeLessThan(1_000);
  });

  it("refuses a tool that writes while writing is off, and runs it when it is allowed", async () => {
    const run = vi.fn(() => ({ ok: true }));
    const writer = tool({ name: "change", readOnly: false, run });
    const off = setup([writer]);
    expect((await off.call("tools/call", { name: "change" }))?.result).toEqual({
      content: [{ type: "text", text: "The change tool is turned off in Murmur." }],
      isError: true,
    });
    expect(run).not.toHaveBeenCalled();
    const on = setup([writer], { writeAllowed: (candidate) => candidate.name === "change" });
    expect((await on.call("tools/call", { name: "change" }))?.result).toMatchObject({
      content: [{ type: "text", text: '{"ok":true}' }],
    });
  });

  it("neither lists nor runs a reading tool the owner switched off (CN-11)", async () => {
    const t = setup([tool()], { toolOff: (name) => name === "echo" });
    expect((await t.call("tools/list"))?.result).toEqual({ tools: [] });
    expect((await t.call("tools/call", { name: "echo" }))?.result).toMatchObject({
      isError: true,
    });
  });

  it("counts calls to tools, 60 a minute, and says when to try again; listing is free", async () => {
    let now = 0;
    const t = setup([tool()], {
      rateLimiter: createRateLimiter({ limit: () => 2, now: () => now }),
    });
    await t.call("tools/call", { name: "echo" });
    await t.call("tools/call", { name: "echo" });
    for (let i = 0; i < 5; i++) await t.call("tools/list");
    const third = await t.call("tools/call", { name: "echo" });
    expect(third?.result).toMatchObject({ isError: true });
    expect(JSON.stringify(third)).toContain("Too many calls. Try again in 60 seconds.");
    now = 61_000;
    expect((await t.call("tools/call", { name: "echo" }))?.result).not.toHaveProperty("isError");
  });

  it("reads text: parse errors, bad requests and batches", async () => {
    const t = setup();
    expect(JSON.parse((await t.server.handleText("{nope", t.client))!)).toMatchObject({
      id: null,
      error: { code: -32700 },
    });
    expect(JSON.parse((await t.server.handleText('{"hello":1}', t.client))!)).toMatchObject({
      error: { code: -32600 },
    });
    expect(JSON.parse((await t.server.handleText("[]", t.client))!)).toMatchObject({
      error: { code: -32600 },
    });
    const batch = JSON.parse(
      (await t.server.handleText(
        JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "ping" },
          { jsonrpc: "2.0", method: "notifications/initialized" },
          { jsonrpc: "2.0", id: "b", method: "ping" },
        ]),
        t.client,
      ))!,
    );
    expect(batch.map((reply: { id: unknown }) => reply.id)).toEqual([1, "b"]);
    expect(
      await t.server.handleText('{"jsonrpc":"2.0","method":"notifications/initialized"}', t.client),
    ).toBeNull();
  });
});
