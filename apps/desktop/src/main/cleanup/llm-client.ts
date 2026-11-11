import type { Clock, Logger, TimerHandle } from "../helper/types";
import type { CleanupLevel } from "./rules";

export type LlmRequest =
  | { id: number; type: "load"; modelPath: string }
  | {
      id: number;
      type: "clean";
      text: string;
      level: Exclude<CleanupLevel, "off">;
      terms?: string[];
      /** The style's instructions (PZ-11), and later Memory. */
      instructions?: string[];
    }
  | {
      id: number;
      type: "translate";
      text: string;
      /** The target language's English name (PZ-22). */
      language: string;
      keep?: string[];
    }
  | { id: number; type: "unload" }
  | { type: "abort"; target: number };

export interface LlmReply {
  id: number;
  ok: boolean;
  value: string;
}

/** The LLM utility process as main sees it. Tests use a fake. */
export interface LlmWorker {
  post(request: LlmRequest): void;
  onMessage(handler: (reply: LlmReply) => void): void;
  onExit(handler: (code: number) => void): void;
  kill(): void;
}

export class LlmTimeoutError extends Error {
  constructor() {
    super("The cleanup model did not answer within its time budget");
    this.name = "LlmTimeoutError";
  }
}

export interface LlmClientDeps {
  spawn: () => LlmWorker;
  modelPath: string;
  clock: Clock;
  logger: Logger;
  /** The worker is stopped (and its memory freed) after this long without requests. */
  idleMs?: number;
  /** A first load can take a while; it is not part of a request's budget. */
  loadTimeoutMs?: number;
}

export interface LlmClient {
  /** Starts the worker and loads the model if needed, so the next request is fast. */
  prepare(): void;
  /** Cleans text within `budgetMs`. Rejects with LlmTimeoutError when the budget runs out. */
  clean(
    text: string,
    level: Exclude<CleanupLevel, "off">,
    budgetMs: number,
    terms?: string[],
    instructions?: string[],
  ): Promise<string>;
  /** Translates text within `timeoutMs` (PZ-22). Rejects with LlmTimeoutError when it runs out. */
  translate(text: string, language: string, timeoutMs: number, keep?: string[]): Promise<string>;
  stop(): void;
}

interface Pending {
  resolve(value: string): void;
  reject(error: Error): void;
  timer: TimerHandle;
}

/**
 * Runs the cleanup model in a utility process: started on first use, loaded once, stopped
 * when idle. A request that runs past its budget is abandoned (and aborted in the worker)
 * so the caller can fall back at once.
 */
export function createLlmClient(deps: LlmClientDeps): LlmClient {
  const { clock, logger } = deps;
  const idleMs = deps.idleMs ?? 5 * 60_000;
  const loadTimeoutMs = deps.loadTimeoutMs ?? 120_000;
  let worker: LlmWorker | null = null;
  let ready: Promise<void> | null = null;
  let nextId = 1;
  let idleTimer: TimerHandle | null = null;
  const pending = new Map<number, Pending>();

  function send(
    request: Exclude<LlmRequest, { type: "abort" }>,
    timeoutMs: number,
  ): Promise<string> {
    const target = worker;
    if (!target) return Promise.reject(new Error("The cleanup process is not running"));
    return new Promise((resolve, reject) => {
      const timer = clock.setTimeout(() => {
        pending.delete(request.id);
        const work = request.type === "clean" || request.type === "translate";
        if (work) target.post({ type: "abort", target: request.id });
        reject(work ? new LlmTimeoutError() : new Error(`${request.type} timed out`));
      }, timeoutMs);
      pending.set(request.id, { resolve, reject, timer });
      target.post(request);
    });
  }

  function start(): Promise<void> {
    if (ready) return ready;
    const spawned = deps.spawn();
    worker = spawned;
    spawned.onMessage((reply) => {
      const entry = pending.get(reply.id);
      if (!entry) return;
      pending.delete(reply.id);
      clock.clearTimeout(entry.timer);
      if (reply.ok) entry.resolve(reply.value);
      else entry.reject(new Error(reply.value));
    });
    spawned.onExit((code) => {
      if (worker !== spawned) return;
      logger.warn(`cleanup process exited (code ${code})`);
      worker = null;
      ready = null;
      for (const [id, entry] of pending) {
        clock.clearTimeout(entry.timer);
        entry.reject(new Error("The cleanup process exited"));
        pending.delete(id);
      }
    });
    ready = send({ id: nextId++, type: "load", modelPath: deps.modelPath }, loadTimeoutMs).then(
      (loadMs) => logger.info(`cleanup model loaded in ${loadMs} ms`),
      (error: unknown) => {
        logger.warn(
          `cleanup model could not load: ${error instanceof Error ? error.message : String(error)}`,
        );
        stopWorker();
        throw error;
      },
    );
    ready.catch(() => {});
    return ready;
  }

  function stopWorker(): void {
    const current = worker;
    worker = null;
    ready = null;
    current?.kill();
  }

  function touch(): void {
    if (idleTimer !== null) clock.clearTimeout(idleTimer);
    idleTimer = clock.setTimeout(() => {
      idleTimer = null;
      if (worker) logger.info("cleanup model unloaded after being idle");
      stopWorker();
    }, idleMs);
  }

  /**
   * Loads the model if needed, counting the load against the budget: a dictation never waits
   * for a slow first load. Returns the time left.
   */
  async function loadWithin(budgetMs: number): Promise<number> {
    touch();
    const started = clock.now();
    const loading = start();
    const loadTimer = new Promise<never>((_, reject) => {
      const timer = clock.setTimeout(() => reject(new LlmTimeoutError()), budgetMs);
      void loading.then(
        () => clock.clearTimeout(timer),
        () => clock.clearTimeout(timer),
      );
    });
    await Promise.race([loading, loadTimer]);
    return Math.max(1, budgetMs - (clock.now() - started));
  }

  return {
    prepare() {
      touch();
      void start().catch(() => {});
    },
    async clean(text, level, budgetMs, terms = [], instructions = []) {
      const left = await loadWithin(budgetMs);
      return send(
        {
          id: nextId++,
          type: "clean",
          text,
          level,
          ...(terms.length > 0 ? { terms } : {}),
          ...(instructions.length > 0 ? { instructions } : {}),
        },
        left,
      );
    },
    async translate(text, language, timeoutMs, keep = []) {
      const left = await loadWithin(timeoutMs);
      return send(
        {
          id: nextId++,
          type: "translate",
          text,
          language,
          ...(keep.length > 0 ? { keep } : {}),
        },
        left,
      );
    },
    stop() {
      if (idleTimer !== null) clock.clearTimeout(idleTimer);
      idleTimer = null;
      stopWorker();
    },
  };
}
