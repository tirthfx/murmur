import {
  HELPER_EVENTS,
  HELPER_REQUESTS,
  NdjsonDecoder,
  isHelperEventType,
  type HelperEventMessage,
  encodeMessage,
  envelopeSchema,
  formatRequestId,
  helloPayloadSchema,
  helperErrorEventPayloadSchema,
  responsePayloadSchema,
  type HelloPayload,
  type HelperRequestPayload,
  type HelperRequestResult,
  type HelperRequestType,
} from "@murmur/shared";
import { HelperError, type Clock, type ExitInfo, type HelperProcess, type Logger } from "./types";

export const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

interface Pending {
  requestType: string;
  resultSchema: { safeParse(value: unknown): { success: boolean; data?: unknown } };
  timer: unknown;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export interface ConnectionDeps {
  clock: Clock;
  logger: Logger;
  requestTimeoutMs?: number;
}

/**
 * One helper process and the protocol on top of it: framing, request and response
 * matching by id with a timeout, and event dispatch. A new connection is made for each
 * process, so nothing carries over a restart.
 */
export class HelperConnection {
  private readonly decoder = new NdjsonDecoder();
  private readonly pending = new Map<string, Pending>();
  private readonly warnedTypes = new Set<string>();
  private readonly requestTimeoutMs: number;
  private counter = 0;
  private closed = false;
  private stderrRemainder = "";
  private helloHandler: ((hello: HelloPayload) => void) | null = null;
  private exitHandler: ((info: ExitInfo) => void) | null = null;
  private eventHandler: ((event: HelperEventMessage) => void) | null = null;

  constructor(
    private readonly proc: HelperProcess,
    private readonly deps: ConnectionDeps,
  ) {
    this.requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    proc.onStdout((chunk) => this.handleStdout(chunk));
    proc.onStderr((chunk) => this.handleStderr(chunk));
    proc.onExit((info) => {
      this.close();
      this.exitHandler?.(info);
    });
  }

  onHello(handler: (hello: HelloPayload) => void): void {
    this.helloHandler = handler;
  }

  onExit(handler: (info: ExitInfo) => void): void {
    this.exitHandler = handler;
  }

  /** Feature events from `HELPER_EVENTS`, already validated. Invalid ones are dropped. */
  onEvent(handler: (event: HelperEventMessage) => void): void {
    this.eventHandler = handler;
  }

  kill(signal: "SIGTERM" | "SIGKILL"): void {
    this.proc.kill(signal);
  }

  /** Sends a request and resolves with its validated result. */
  request<K extends HelperRequestType>(
    type: K,
    payload: HelperRequestPayload<K>,
    timeoutMs: number = this.requestTimeoutMs,
  ): Promise<HelperRequestResult<K>> {
    if (this.closed) {
      return Promise.reject(
        new HelperError("HELPER_RESTARTED", `Helper is gone, cannot send ${type}`),
      );
    }
    const id = formatRequestId(++this.counter);
    return new Promise((resolve, reject) => {
      const timer = this.deps.clock.setTimeout(() => {
        this.pending.delete(id);
        reject(new HelperError("HELPER_TIMEOUT", `${type} got no response within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, {
        requestType: type,
        resultSchema: HELPER_REQUESTS[type].result,
        timer,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      try {
        this.proc.write(encodeMessage({ id, type, payload }));
      } catch (error) {
        this.settle(id)?.reject(
          new HelperError("HELPER_UNAVAILABLE", `Could not write ${type}: ${String(error)}`),
        );
      }
    });
  }

  /** Rejects everything in flight. Called when the process exits. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const id of [...this.pending.keys()]) {
      this.settle(id)?.reject(
        new HelperError("HELPER_RESTARTED", "Helper exited while the request was in flight"),
      );
    }
  }

  private settle(id: string): Pending | undefined {
    const entry = this.pending.get(id);
    if (!entry) return undefined;
    this.pending.delete(id);
    this.deps.clock.clearTimeout(entry.timer);
    return entry;
  }

  private handleStdout(chunk: Uint8Array): void {
    for (const decoded of this.decoder.push(chunk)) {
      if (!decoded.ok) {
        this.deps.logger.warn(`dropped a helper line (${decoded.error})`);
        continue;
      }
      this.handleMessage(decoded.value);
    }
  }

  private handleMessage(value: unknown): void {
    const envelope = envelopeSchema.safeParse(value);
    if (!envelope.success) {
      this.deps.logger.warn("dropped a helper message with an invalid envelope");
      return;
    }
    const { id, type, payload } = envelope.data;
    if (type === "response") {
      this.handleResponse(id, payload);
      return;
    }
    if (id !== null) {
      this.deps.logger.warn(`dropped helper event ${type}: events must have a null id`);
      return;
    }
    if (type === "hello") {
      const hello = helloPayloadSchema.safeParse(payload);
      if (hello.success) this.helloHandler?.(hello.data);
      else this.deps.logger.error("helper sent an invalid hello");
    } else if (type === "helper.error") {
      const error = helperErrorEventPayloadSchema.safeParse(payload);
      if (error.success) {
        this.deps.logger.error(
          `helper reported ${error.data.code}: ${error.data.message}${error.data.fatal ? " (fatal)" : ""}`,
        );
      }
    } else if (isHelperEventType(type)) {
      const parsed = HELPER_EVENTS[type].safeParse(payload);
      if (parsed.success) {
        this.eventHandler?.({ type, payload: parsed.data } as HelperEventMessage);
      } else {
        this.deps.logger.warn(`dropped an invalid ${type} event`);
      }
    } else if (!this.warnedTypes.has(type)) {
      this.warnedTypes.add(type);
      this.deps.logger.warn(`ignoring unknown helper event type ${type}`);
    }
  }

  private handleResponse(id: string | null, payload: Record<string, unknown>): void {
    const entry = id === null ? undefined : this.settle(id);
    if (!entry) {
      this.deps.logger.warn(`dropped a response with no waiting request (id ${String(id)})`);
      return;
    }
    const parsed = responsePayloadSchema.safeParse(payload);
    if (!parsed.success || parsed.data.requestType !== entry.requestType) {
      entry.reject(
        new HelperError("INVALID_PAYLOAD", `Malformed response to ${entry.requestType}`),
      );
    } else if (!parsed.data.ok) {
      const { code, message } = parsed.data.error;
      entry.reject(new HelperError(code as HelperError["code"], message));
    } else {
      const result = entry.resultSchema.safeParse(parsed.data.result);
      if (result.success) entry.resolve(result.data);
      else {
        entry.reject(new HelperError("INVALID_PAYLOAD", `Invalid result for ${entry.requestType}`));
      }
    }
  }

  private handleStderr(chunk: Uint8Array): void {
    const lines = (this.stderrRemainder + new TextDecoder().decode(chunk)).split("\n");
    this.stderrRemainder = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() !== "") this.deps.logger.info(`[stderr] ${line}`);
    }
  }
}
