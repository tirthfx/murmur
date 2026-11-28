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

/** Where every logger's lines also go, such as the log file; nowhere until one is set. */
let sink: ((level: "info" | "warn" | "error", line: string) => void) | null = null;
export function setLogSink(next: typeof sink): void {
  sink = next;
}

export function createConsoleLogger(prefix: string): Logger {
  const log = (level: "info" | "warn" | "error", message: string) => {
    const line = `${prefix} ${message}`;
    console[level === "info" ? "log" : level](line);
    sink?.(level, line);
  };
  return {
    info: (message) => log("info", message),
    warn: (message) => log("warn", message),
    error: (message) => log("error", message),
  };
}
