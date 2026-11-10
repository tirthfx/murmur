import { spawn } from "node:child_process";
import type { Clock, ExitInfo, HelperProcess, Logger, SpawnHelper } from "./types";

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** Spawns the helper with piped stdio. Never throws: a failed start is reported through `onExit`. */
export const spawnHelperProcess: SpawnHelper = (binaryPath) => {
  const exitHandlers: Array<(info: ExitInfo) => void> = [];
  let exited = false;
  const reportExit = (info: ExitInfo) => {
    if (exited) return;
    exited = true;
    for (const handler of exitHandlers) handler(info);
  };

  const child = spawn(binaryPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  // A write to a dead helper must not crash main; the exit event handles the fallout.
  child.stdin.on("error", () => {});
  child.once("error", (error) => reportExit({ code: null, signal: null, error: error.message }));
  child.once("exit", (code, signal) => reportExit({ code, signal }));

  const helperProcess: HelperProcess = {
    write: (data) => {
      if (child.stdin.writable) child.stdin.write(data);
    },
    kill: (signal) => {
      child.kill(signal);
    },
    onStdout: (handler) => {
      child.stdout.on("data", handler);
    },
    onStderr: (handler) => {
      child.stderr.on("data", handler);
    },
    onExit: (handler) => {
      exitHandlers.push(handler);
    },
  };
  return helperProcess;
};

export function createConsoleLogger(prefix: string): Logger {
  return {
    info: (message) => console.log(`${prefix} ${message}`),
    warn: (message) => console.warn(`${prefix} ${message}`),
    error: (message) => console.error(`${prefix} ${message}`),
  };
}
