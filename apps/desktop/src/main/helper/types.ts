import type { HelperErrorCode } from "@murmur/shared";

/** A running helper child process, reduced to what the client needs. Tests supply a fake. */
export interface HelperProcess {
  write(data: string): void;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
  onStdout(handler: (chunk: Uint8Array) => void): void;
  onStderr(handler: (chunk: Uint8Array) => void): void;
  /** Fires once, when the process ends or could not be started. */
  onExit(handler: (info: ExitInfo) => void): void;
}

export interface ExitInfo {
  code: number | null;
  signal: string | null;
  /** Set when the process could not be started at all. */
  error?: string;
}

export type SpawnHelper = (binaryPath: string) => HelperProcess;

export type TimerHandle = unknown;

/** Time source. Production uses the real clock; tests advance a fake one by hand. */
export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export class HelperError extends Error {
  constructor(
    readonly code: HelperErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HelperError";
  }
}
