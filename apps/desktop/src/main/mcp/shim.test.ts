import { spawn } from "node:child_process";
import { accessSync, constants, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpServer } from "./mcp-server";
import { startSocketTransport, type RunningTransport } from "./socket-transport";

const shim = path.resolve(__dirname, "../../../packaging/murmur-mcp");
const open: RunningTransport[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const transport of open.splice(0)) await transport.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs the command with some input and collects its output until it ends. */
const run = (args: string[], input: string, env: Record<string, string> = {}) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn("/bin/sh", [shim, ...args], {
      env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    // The command may exit before it reads anything (no socket): that is not an error here.
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });

describe("the murmur-mcp command (CN-11)", () => {
  it("is shipped as an executable file", () => {
    expect(() => accessSync(shim, constants.X_OK)).not.toThrow();
  });

  it("asks for the app's token when there is none, and fails", async () => {
    const result = await run(["/tmp/murmur-no-such.sock"], "");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("MURMUR_MCP_TOKEN is not set");
    expect(result.stdout).toBe("");
  });

  it("says Murmur is not running when there is no socket, and fails", async () => {
    const result = await run(["/tmp/murmur-no-such.sock"], "", { MURMUR_MCP_TOKEN: "tok" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Murmur is not running, or its local MCP server is off");
    expect(result.stdout).toBe("");
  });

  // macOS has the nc the command uses; the CI machine does not.
  it.skipIf(process.platform !== "darwin")(
    "sends the token first and passes messages between the client and the app, by argument or by MURMUR_MCP_SOCKET",
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "mm-"));
      dirs.push(dir);
      const socketPath = path.join(dir, "mcp.sock");
      open.push(
        await startSocketTransport({
          path: socketPath,
          server: createMcpServer({ tools: [], serverName: "murmur", serverVersion: "9" }),
          logger: { warn: vi.fn() },
          authenticate: (token) => (token === "tok-1" ? { id: "c1", name: "Test app" } : null),
          isActive: () => true,
        }),
      );
      const messages = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`;
      for (const result of [
        await run([socketPath], messages, { MURMUR_MCP_TOKEN: "tok-1" }),
        await run([], messages, { MURMUR_MCP_SOCKET: socketPath, MURMUR_MCP_TOKEN: "tok-1" }),
      ]) {
        expect(result.code).toBe(0);
        const replies = result.stdout
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l));
        expect(replies.map((r) => r.id).sort()).toEqual([1, 2]);
        expect(replies.find((r) => r.id === 1).result.serverInfo).toEqual({
          name: "murmur",
          version: "9",
        });
      }
    },
  );

  it.skipIf(process.platform !== "darwin")("is refused with a wrong token", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mm-"));
    dirs.push(dir);
    const socketPath = path.join(dir, "mcp.sock");
    open.push(
      await startSocketTransport({
        path: socketPath,
        server: createMcpServer({ tools: [], serverName: "murmur", serverVersion: "9" }),
        logger: { warn: vi.fn() },
        authenticate: () => null,
        isActive: () => true,
      }),
    );
    const result = await run(
      [socketPath],
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`,
      { MURMUR_MCP_TOKEN: "wrong" },
    );
    expect(JSON.parse(result.stdout.split("\n")[0]!)).toMatchObject({ error: { code: -32001 } });
  });
});
