import type { Envelope } from "@murmur/shared";
import { NdjsonDecoder, encodeMessage } from "@murmur/shared";
import type { Clock, ExitInfo, HelperProcess, Logger, SpawnHelper, TimerHandle } from "./types";

/** A clock that only moves when a test says so. Timers fire in time order. */
export class FakeClock implements Clock {
  private current = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.current;
  }

  setTimeout(callback: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { at: this.current + ms, callback });
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as number);
  }

  get pendingTimers(): number {
    return this.timers.size;
  }

  /** Moves time forward, running due timers (and timers they schedule) in order. */
  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    await flush();
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.current = Math.max(this.current, due[1].at);
      due[1].callback();
      await flush();
    }
    this.current = target;
    await flush();
  }
}

/** Lets promise continuations run. No timers involved. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 25; i++) await Promise.resolve();
}

export function createTestLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (message) => lines.push(`info: ${message}`),
    warn: (message) => lines.push(`warn: ${message}`),
    error: (message) => lines.push(`error: ${message}`),
  };
}

/**
 * Stands in for the helper child process. Tests push helper output with `send` and read
 * what main wrote with `received`.
 */
export class FakeHelperProcess implements HelperProcess {
  readonly received: Envelope[] = [];
  readonly killSignals: string[] = [];
  exited = false;
  /** Set to false to make `kill` leave the process running (a stuck helper). */
  exitsOnKill = true;
  private readonly decoder = new NdjsonDecoder();
  private stdoutHandler: ((chunk: Uint8Array) => void) | null = null;
  private stderrHandler: ((chunk: Uint8Array) => void) | null = null;
  private exitHandler: ((info: ExitInfo) => void) | null = null;

  write(data: string): void {
    for (const decoded of this.decoder.push(data)) {
      if (decoded.ok) this.received.push(decoded.value as Envelope);
    }
  }

  kill(signal: "SIGTERM" | "SIGKILL"): void {
    this.killSignals.push(signal);
    if (this.exitsOnKill) this.exit({ code: null, signal });
  }

  onStdout(handler: (chunk: Uint8Array) => void): void {
    this.stdoutHandler = handler;
  }
  onStderr(handler: (chunk: Uint8Array) => void): void {
    this.stderrHandler = handler;
  }
  onExit(handler: (info: ExitInfo) => void): void {
    this.exitHandler = handler;
  }

  send(message: Envelope): void {
    this.stdoutHandler?.(new TextEncoder().encode(encodeMessage(message)));
  }

  sendRaw(text: string): void {
    this.stdoutHandler?.(new TextEncoder().encode(text));
  }

  sendStderr(text: string): void {
    this.stderrHandler?.(new TextEncoder().encode(text));
  }

  sendHello(overrides: Partial<{ protocolVersion: number; helperVersion: string }> = {}): void {
    this.send({
      id: null,
      type: "hello",
      payload: {
        protocolVersion: 1,
        helperVersion: "0.1.0",
        capabilities: [],
        pid: 4242,
        ...overrides,
      },
    });
  }

  /** The most recent request of this type that main sent. */
  lastRequest(type: string): Envelope | undefined {
    return [...this.received].reverse().find((message) => message.type === type);
  }

  respondOk(request: Envelope, result: Record<string, unknown> = {}): void {
    this.send({
      id: request.id,
      type: "response",
      payload: { requestType: request.type, ok: true, result },
    });
  }

  respondError(request: Envelope, code: string, message = "failed"): void {
    this.send({
      id: request.id,
      type: "response",
      payload: { requestType: request.type, ok: false, error: { code, message, retryable: false } },
    });
  }

  /** Ends the process, as a crash or a normal exit. */
  exit(info: ExitInfo = { code: 1, signal: null }): void {
    if (this.exited) return;
    this.exited = true;
    this.exitHandler?.(info);
  }
}

/** A spawner that hands out fake processes and remembers them. */
export function createFakeSpawner(): {
  spawn: SpawnHelper;
  processes: FakeHelperProcess[];
  paths: string[];
} {
  const processes: FakeHelperProcess[] = [];
  const paths: string[] = [];
  return {
    processes,
    paths,
    spawn: (binaryPath) => {
      paths.push(binaryPath);
      const fake = new FakeHelperProcess();
      processes.push(fake);
      return fake;
    },
  };
}
