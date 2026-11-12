import type { Clock, Logger, TimerHandle } from "../helper/types";
import type { GenerateRequest } from "./engine";
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
  | ({ id: number; type: "generate" } & GenerateRequest)
  | { id: number; type: "unload" }
  | { type: "abort"; target: number };

export interface LlmReply {
  id: number;
  ok: boolean;
  value: string;
}

/** A piece of streamed output from a `generate` request, sent before its reply. */
export interface LlmChunk {
  id: number;
  chunk: string;
}

/** The LLM utility process as main sees it. Tests use a fake. */
export interface LlmWorker {
  post(request: LlmRequest): void;
  onMessage(handler: (reply: LlmReply | LlmChunk) => void): void;
  onExit(handler: (code: number) => void): void;
  kill(): void;
}

export class LlmTimeoutError extends Error {
  constructor() {
    super("The cleanup model did not answer within its time budget");
    this.name = "LlmTimeoutError";
  }
}

/** A dictation needed the model before the generation had produced anything (RW-07). */
export class LlmPreemptedError extends Error {
  constructor() {
    super("Stopped so a dictation could use the model");
    this.name = "LlmPreemptedError";
  }
}

/** Cancelled by the caller, or replaced by a newer generation. */
export class LlmCancelledError extends Error {
  constructor() {
    super("The generation was cancelled");
    this.name = "LlmCancelledError";
  }
}

/** The prompt leaves too little room in the model's context. */
export class LlmTooLongError extends Error {
  constructor() {
    super("The text does not fit the model's context");
    this.name = "LlmTooLongError";
  }
}

export interface GenerateOptions {
  /** Counted from when the model is loaded; a first load is not part of it. */
  timeoutMs: number;
  onChunk?: (text: string) => void;
  /** Called at once when the model has to be loaded first ("Loading model"). */
  onLoading?: () => void;
  /** Called when the request goes to the model, which is when the time limit starts. */
  onStart?: () => void;
}

export interface GenerationJob {
  /** The whole answer. Rejects with LlmTimeoutError, LlmPreemptedError, LlmCancelledError or LlmTooLongError. */
  result: Promise<string>;
  cancel(): void;
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
  /**
   * Free text for Rewrites, Command Mode and Instruct Mode (RW-07), streamed. One at a time:
   * a new one cancels the last. Dictation comes first: a dictation stops a generation that has
   * not produced anything yet, and otherwise waits for it only within its own budget.
   */
  generate(request: GenerateRequest, options: GenerateOptions): GenerationJob;
  stop(): void;
}

interface Pending {
  resolve(value: string): void;
  reject(error: Error): void;
  timer: TimerHandle;
  onChunk?: (text: string) => void;
}

interface ActiveGeneration {
  /** Zero until the request is sent. */
  id: number;
  hasOutput: boolean;
  /** Resolves when the job has ended, however it ended. */
  settled: Promise<void>;
  stop(error: Error): void;
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
  let loaded = false;
  let active: ActiveGeneration | null = null;
  /** Cleanup and translation jobs in flight; a generation starts only when there are none. */
  const dictations = new Set<Promise<unknown>>();

  function send(
    request: Exclude<LlmRequest, { type: "abort" }>,
    timeoutMs: number,
    onChunk?: (text: string) => void,
  ): Promise<string> {
    const target = worker;
    if (!target) return Promise.reject(new Error("The cleanup process is not running"));
    return new Promise((resolve, reject) => {
      const timer = clock.setTimeout(() => {
        pending.delete(request.id);
        const work = request.type !== "load" && request.type !== "unload";
        if (work) target.post({ type: "abort", target: request.id });
        reject(work ? new LlmTimeoutError() : new Error(`${request.type} timed out`));
      }, timeoutMs);
      pending.set(request.id, { resolve, reject, timer, ...(onChunk ? { onChunk } : {}) });
      target.post(request);
    });
  }

  /** Resolves true if `promise` settles within `ms`, false otherwise. */
  function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = clock.setTimeout(() => resolve(false), ms);
      void promise.then(
        () => {
          clock.clearTimeout(timer);
          resolve(true);
        },
        () => {
          clock.clearTimeout(timer);
          resolve(true);
        },
      );
    });
  }

  /**
   * Makes the model free for a dictation job: stops a generation with no output yet, or waits
   * for one with output within the time left. Returns the time still left.
   */
  async function makeRoom(timeLeft: number): Promise<number> {
    const job = active;
    if (!job) return timeLeft;
    if (!job.hasOutput) {
      logger.info("generation stopped so a dictation could use the model");
      job.stop(new LlmPreemptedError());
      return timeLeft;
    }
    const started = clock.now();
    if (!(await within(job.settled, timeLeft))) throw new LlmTimeoutError();
    return Math.max(1, timeLeft - (clock.now() - started));
  }

  /** Runs a cleanup or translation, tracked so a generation waits for it. */
  function dictationJob(run: () => Promise<string>): Promise<string> {
    const job = run();
    dictations.add(job);
    const done = () => dictations.delete(job);
    void job.then(done, done);
    return job;
  }

  function start(): Promise<void> {
    if (ready) return ready;
    const spawned = deps.spawn();
    worker = spawned;
    spawned.onMessage((reply) => {
      if ("chunk" in reply) {
        pending.get(reply.id)?.onChunk?.(reply.chunk);
        return;
      }
      const entry = pending.get(reply.id);
      if (!entry) return;
      pending.delete(reply.id);
      clock.clearTimeout(entry.timer);
      if (reply.ok) entry.resolve(reply.value);
      else if (reply.value.startsWith("too-long:")) entry.reject(new LlmTooLongError());
      else entry.reject(new Error(reply.value));
    });
    spawned.onExit((code) => {
      if (worker !== spawned) return;
      logger.warn(`cleanup process exited (code ${code})`);
      worker = null;
      ready = null;
      loaded = false;
      for (const [id, entry] of pending) {
        clock.clearTimeout(entry.timer);
        entry.reject(new Error("The cleanup process exited"));
        pending.delete(id);
      }
    });
    ready = send({ id: nextId++, type: "load", modelPath: deps.modelPath }, loadTimeoutMs).then(
      (loadMs) => {
        loaded = true;
        logger.info(`cleanup model loaded in ${loadMs} ms`);
      },
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
    loaded = false;
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
    clean(text, level, budgetMs, terms = [], instructions = []) {
      return dictationJob(async () => {
        const left = await makeRoom(await loadWithin(budgetMs));
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
      });
    },
    translate(text, language, timeoutMs, keep = []) {
      return dictationJob(async () => {
        const left = await makeRoom(await loadWithin(timeoutMs));
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
      });
    },
    generate(request, options) {
      // One generation at a time: the newest wins.
      active?.stop(new LlmCancelledError());
      let stopped: Error | null = null;
      let stopEarly: (error: Error) => void = () => {};
      const early = new Promise<never>((_, reject) => {
        stopEarly = reject;
      });
      early.catch(() => {});
      let settle: () => void = () => {};
      const job: ActiveGeneration = {
        id: 0,
        hasOutput: false,
        settled: new Promise<void>((resolve) => {
          settle = resolve;
        }),
        stop(error) {
          if (stopped) return;
          stopped = error;
          const entry = job.id ? pending.get(job.id) : undefined;
          if (!entry) {
            stopEarly(error);
            return;
          }
          pending.delete(job.id);
          clock.clearTimeout(entry.timer);
          worker?.post({ type: "abort", target: job.id });
          entry.reject(error);
        },
      };
      active = job;
      const result = (async () => {
        try {
          touch();
          if (!loaded) options.onLoading?.();
          await Promise.race([start(), early]);
          // A dictation in progress finishes first.
          while (dictations.size > 0) {
            await Promise.race([Promise.allSettled([...dictations]), early]);
          }
          if (stopped) throw stopped;
          job.id = nextId++;
          options.onStart?.();
          return await send(
            {
              id: job.id,
              type: "generate",
              system: request.system,
              prompt: request.prompt,
              maxTokens: request.maxTokens,
              ...(request.history && request.history.length > 0
                ? { history: request.history }
                : {}),
            },
            options.timeoutMs,
            (chunk) => {
              job.hasOutput = true;
              touch();
              options.onChunk?.(chunk);
            },
          );
        } finally {
          if (active === job) active = null;
          settle();
        }
      })();
      return { result, cancel: () => job.stop(new LlmCancelledError()) };
    },
    stop() {
      active?.stop(new LlmCancelledError());
      if (idleTimer !== null) clock.clearTimeout(idleTimer);
      idleTimer = null;
      stopWorker();
    },
  };
}
