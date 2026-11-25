import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { HotkeyBinding } from "@murmur/shared";
import { createTestLogger } from "../helper/fakes";
import { spawnHelperProcess, systemClock } from "../helper/node-runtime";
import { HelperSupervisor } from "../helper/supervisor";
import type { HelperProcess, SpawnHelper } from "../helper/types";
import { describePlatformHelperConformance, type HelperWorld } from "./platform-helper-conformance";
import { resolveWindowsHelperBinary } from "./windows-helper";

/**
 * Runs the conformance suite against the real .NET helper process (`native/helper-win`), over
 * its real pipes, on the helper's fake operating system (`MURMUR_HELPER_FAKE=1`). That checks the
 * helper's protocol layer and its controllers on any machine. What it cannot check is the Win32
 * calls underneath; those run only on Windows 11 (see docs/platform.md).
 *
 * It needs the helper built: `npm run build:helper:win`. Without a build it is skipped, unless
 * `MURMUR_REQUIRE_WIN_HELPER=1` (set in CI), which makes a missing build a failure.
 */
const appPath = path.resolve(__dirname, "../../..");
const buildDir = path.resolve(appPath, "../../native/helper-win/src/MurmurHelper/bin");
const candidates = ["Release", "Debug"].flatMap((configuration) =>
  ["murmur-helper", "murmur-helper.exe"].map((name) =>
    path.join(buildDir, configuration, "net9.0-windows", name),
  ),
);
const binary = candidates.find((candidate) => existsSync(candidate));
const required = process.env.MURMUR_REQUIRE_WIN_HELPER === "1";

const HOLD: HotkeyBinding = {
  id: "dictate",
  action: "dictate.hold",
  trigger: { type: "key", keyCode: 0x7a, modifiers: [] },
  mode: "hold",
};

/** A helper process that also takes control requests for the fake OS, answered out of band. */
class ControlledProcess implements HelperProcess {
  private readonly inner: HelperProcess;
  private buffer = "";
  private counter = 0;
  private readonly waiting = new Map<string, (payload: Record<string, unknown>) => void>();
  private stdoutHandler: ((chunk: Uint8Array) => void) | null = null;

  constructor(inner: HelperProcess) {
    this.inner = inner;
    inner.onStdout((chunk) => this.read(chunk));
  }

  private read(chunk: Uint8Array): void {
    this.buffer += new TextDecoder().decode(chunk);
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      const message = JSON.parse(line) as { id: string | null; payload: Record<string, unknown> };
      const resolve = message.id ? this.waiting.get(message.id) : undefined;
      if (resolve && message.id) {
        this.waiting.delete(message.id);
        resolve(message.payload);
      } else {
        this.stdoutHandler?.(new TextEncoder().encode(`${line}\n`));
      }
      newline = this.buffer.indexOf("\n");
    }
  }

  /** Acts on the fake OS and waits for the helper to say it is done. */
  async act(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = `w-${++this.counter}`;
    const answer = new Promise<Record<string, unknown>>((resolve) => this.waiting.set(id, resolve));
    this.inner.write(`${JSON.stringify({ id, type: "test.world", payload })}\n`);
    const response = (await answer) as { ok: boolean; result?: Record<string, unknown> };
    if (!response.ok) throw new Error(`test.world failed: ${JSON.stringify(response)}`);
    return response.result ?? {};
  }

  write = (data: string): void => this.inner.write(data);
  kill = (signal: "SIGTERM" | "SIGKILL"): void => this.inner.kill(signal);
  onStdout(handler: (chunk: Uint8Array) => void): void {
    this.stdoutHandler = handler;
  }
  onStderr = (handler: (chunk: Uint8Array) => void): void => this.inner.onStderr(handler);
  onExit = (handler: Parameters<HelperProcess["onExit"]>[0]): void => this.inner.onExit(handler);
}

const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

if (!binary && !required) {
  describe("platform helper conformance: Windows helper, fake OS", () => {
    it.skip("needs the helper built (npm run build:helper:win)", () => {});
  });
} else {
  describe("the Windows helper binary is built", () => {
    it("exists", () => {
      expect(binary, "run `npm run build:helper:win`").toBeDefined();
    });
  });

  describePlatformHelperConformance("Windows helper, fake OS", {
    async start(): Promise<HelperWorld> {
      process.env.MURMUR_HELPER_FAKE = "1";
      let controlled: ControlledProcess | null = null;
      const spawn: SpawnHelper = (binaryPath) => {
        controlled = new ControlledProcess(spawnHelperProcess(binaryPath));
        return controlled;
      };
      const folder = mkdtempSync(path.join(os.tmpdir(), "murmur-win-conformance-"));
      folders.push(folder);
      const helper = new HelperSupervisor({
        binary: { path: binary! },
        appVersion: "1.0.0",
        spawn,
        clock: systemClock,
        logger: createTestLogger(),
      });
      const act = (payload: Record<string, unknown>) => {
        if (!controlled) throw new Error("the helper has not started");
        return controlled.act(payload);
      };
      return {
        helper,
        holdBinding: HOLD,
        captureFolder: folder,
        speechModelDir: folder,
        async setPermission(kind, status) {
          await act({ op: "setPermission", kind, status });
        },
        async keys(binding, phase) {
          if (binding.trigger.type !== "key") throw new Error("a key binding is needed");
          await act({
            op: "key",
            keyCode: binding.trigger.keyCode,
            modifiers: binding.trigger.modifiers,
            down: phase === "down",
          });
        },
        async focusTextField() {
          await act({ op: "focusTextField" });
        },
        async textFieldValue() {
          return String((await act({ op: "readField" })).text);
        },
        async focusApp(app) {
          await act({ op: "focusApp", bundleId: app.bundleId, name: app.name });
        },
        async setCall(matcherId, active) {
          await act({ op: "setCall", matcherId, active });
        },
        async close() {
          helper.terminate();
        },
      };
    },
  });

  describe("resolveWindowsHelperBinary", () => {
    const base = {
      isPackaged: false,
      resourcesPath: "C:\\Murmur\\resources",
      appPath: "/repo/apps/desktop",
      env: {},
    };
    it("packaged: uses resources/helper/murmur-helper.exe, or says it is missing", () => {
      const packaged = path.join("C:\\Murmur\\resources", "helper", "murmur-helper.exe");
      expect(
        resolveWindowsHelperBinary({ ...base, isPackaged: true, exists: (p) => p === packaged }),
      ).toEqual({ path: packaged });
      expect(
        resolveWindowsHelperBinary({ ...base, isPackaged: true, exists: () => false }),
      ).toMatchObject({ path: null, message: expect.stringContaining("missing from this build") });
    });
    it("development: MURMUR_HELPER_PATH, then the Release build, then Debug", () => {
      const env = { MURMUR_HELPER_PATH: "/custom/helper.exe" };
      expect(resolveWindowsHelperBinary({ ...base, env, exists: () => true })).toEqual({
        path: "/custom/helper.exe",
      });
      expect(resolveWindowsHelperBinary({ ...base, exists: () => true }).path).toMatch(
        /Release.*murmur-helper\.exe$/,
      );
      expect(
        resolveWindowsHelperBinary({ ...base, exists: (p) => p.includes("Debug") }).path,
      ).toMatch(/Debug.*murmur-helper\.exe$/);
    });
    it("development: says how to build when nothing is found", () => {
      expect(resolveWindowsHelperBinary({ ...base, exists: () => false })).toMatchObject({
        path: null,
        message: expect.stringContaining("npm run build:helper:win"),
      });
    });
  });
}
