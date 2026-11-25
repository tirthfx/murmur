import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mcpSocketAddress } from "../platform";
import { createMcpServer } from "./mcp-server";
import { isPipeAddress, startSocketTransport, type RunningTransport } from "./socket-transport";

/**
 * The Node version of the `murmur-mcp` command (what `murmur-mcp.cmd` runs on Windows). It runs
 * on any OS: a socket file on a Mac, a named pipe on Windows. CI runs this file on Windows too.
 */
const shim = path.resolve(__dirname, "../../../packaging/murmur-mcp.cjs");
const open: RunningTransport[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const transport of open.splice(0)) await transport.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const run = (args: string[], input: string, env: Record<string, string> = {}) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [shim, ...args], {
      env: { PATH: process.env.PATH ?? "", ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });

/** An address for this OS that no other test run uses. */
function freshAddress(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mm-"));
  dirs.push(dir);
  return process.platform === "win32"
    ? mcpSocketAddress("win32", dir, `test-${path.basename(dir)}`)
    : path.join(dir, "mcp.sock");
}

async function serve(address: string, accept: (token: string) => boolean) {
  open.push(
    await startSocketTransport({
      path: address,
      server: createMcpServer({ tools: [], serverName: "murmur", serverVersion: "9" }),
      logger: { warn: vi.fn() },
      authenticate: (token) => (accept(token) ? { id: "c1", name: "Test app" } : null),
      isActive: () => true,
    }),
  );
}

describe("the murmur-mcp command, Node version", () => {
  it("asks for the app's token when there is none, and fails", async () => {
    const result = await run([freshAddress()], "");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("MURMUR_MCP_TOKEN is not set");
    expect(result.stdout).toBe("");
  });

  it("says Murmur is not running when nothing listens, and fails", async () => {
    const result = await run([freshAddress()], "", { MURMUR_MCP_TOKEN: "tok" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Murmur is not running, or its local MCP server is off");
    expect(result.stdout).toBe("");
  });

  it("needs an address", async () => {
    const result = await run([], "", { MURMUR_MCP_TOKEN: "tok" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("no socket address");
  });

  it("sends the token first and passes messages both ways, by argument or by MURMUR_MCP_SOCKET", async () => {
    const address = freshAddress();
    await serve(address, (token) => token === "tok-1");
    const messages = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`;
    for (const result of [
      await run([address], messages, { MURMUR_MCP_TOKEN: "tok-1" }),
      await run([], messages, { MURMUR_MCP_SOCKET: address, MURMUR_MCP_TOKEN: "tok-1" }),
    ]) {
      expect(result.code).toBe(0);
      const replies = result.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      expect(replies.map((reply) => reply.id).sort()).toEqual([1, 2]);
      expect(replies.find((reply) => reply.id === 1).result.serverInfo).toEqual({
        name: "murmur",
        version: "9",
      });
    }
  });

  it("is refused with a wrong token", async () => {
    const address = freshAddress();
    await serve(address, () => false);
    const result = await run(
      [address],
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`,
      { MURMUR_MCP_TOKEN: "wrong" },
    );
    expect(JSON.parse(result.stdout.split("\n")[0]!)).toMatchObject({ error: { code: -32001 } });
  });
});

describe("the MCP address for each OS", () => {
  it("is a socket file on a Mac and a named pipe on Windows", () => {
    expect(mcpSocketAddress("darwin", "/Users/me/Library/Application Support", "me")).toBe(
      path.join("/Users/me/Library/Application Support", "Murmur", "mcp.sock"),
    );
    const pipe = mcpSocketAddress("win32", "C:\\Users\\me\\AppData\\Roaming", "Me Name");
    expect(pipe).toBe("\\\\.\\pipe\\murmur-mcp-Me_Name");
    expect(isPipeAddress(pipe)).toBe(true);
    expect(isPipeAddress("/tmp/x.sock")).toBe(false);
  });
});
