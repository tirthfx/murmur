import {
  GENERATION_LIMITS,
  GENERATION_MESSAGES,
  type GenerationErrorCode,
  type GenerationKind,
} from "@murmur/shared";
import type { GenerationTurn } from "../cleanup/engine";
import {
  LlmCancelledError,
  LlmPreemptedError,
  LlmTimeoutError,
  LlmTooLongError,
  type LlmClient,
} from "../cleanup/llm-client";
import type { Logger } from "../helper/types";
import { createPrefaceFilter, repeatsInstruction, stripPreface } from "./output";
import { buildGenerationPrompt, type GenerationPrompt, type GenerationPromptInput } from "./prompt";

export class GenerationError extends Error {
  constructor(readonly code: GenerationErrorCode) {
    super(GENERATION_MESSAGES[code]);
    this.name = "GenerationError";
  }
}

export interface GenerateInput extends GenerationPromptInput {
  kind: GenerationKind;
  /** A follow-up in an Instruct thread (shorter time limit). */
  followUp?: boolean;
  /** Earlier turns of the thread. */
  history?: GenerationTurn[];
  /** A shorter limit than the kind's own (auto-apply, RW-05). */
  timeoutMs?: number;
}

export interface GenerateHandlers {
  /** Output as it arrives, preface already removed. */
  onChunk?: (text: string) => void;
  /** The model has to load first: show "Loading model". */
  onLoading?: () => void;
  /** The answer so far is discarded and the model asked again: clear the panel. */
  onReset?: () => void;
}

export interface GenerationResult {
  text: string;
  /** Context sources that went into the prompt, for the panel's chips. */
  sources: GenerationPrompt["sources"];
  /** Time from the request reaching the model to the end of the answer. */
  ms: number;
  /** True when the first answer repeated the instruction and was asked again. */
  retried: boolean;
}

export interface GenerationRun {
  result: Promise<GenerationResult>;
  cancel(): void;
}

export interface GenerationServiceDeps {
  llm: LlmClient | null;
  modelReady: () => Promise<boolean>;
  logger: Logger;
  now?: () => number;
}

export interface GenerationService {
  generate(input: GenerateInput, handlers?: GenerateHandlers): GenerationRun;
}

/** Asked again with this added when the first answer repeated the instruction. */
export const RETRY_NOTE =
  "Your last answer repeated the instruction. Do not repeat it: answer with the resulting text only.";
/** A retry with less time left than this is not tried. */
const MIN_RETRY_MS = 500;

export function errorCode(error: unknown): GenerationErrorCode {
  if (error instanceof GenerationError) return error.code;
  if (error instanceof LlmTimeoutError) return "timeout";
  if (error instanceof LlmPreemptedError) return "preempted";
  if (error instanceof LlmCancelledError) return "cancelled";
  if (error instanceof LlmTooLongError) return "too-long";
  const message = error instanceof Error ? error.message : String(error);
  if (/memory|alloc|vram/i.test(message)) return "memory";
  return "error";
}

/**
 * Rewrites, Command Mode and Instruct Mode on the local model (RW-07): the engine's rules,
 * streamed output without a preface, one retry when the answer only repeats the instruction,
 * and the limits per kind. Text is never logged.
 */
export function createGenerationService(deps: GenerationServiceDeps): GenerationService {
  const now = deps.now ?? Date.now;
  return {
    generate(input, handlers = {}) {
      let cancelled = false;
      let current: { cancel(): void } | null = null;
      const run = async (): Promise<GenerationResult> => {
        if (!deps.llm || !(await deps.modelReady())) throw new GenerationError("model-missing");
        const llm = deps.llm;
        const built = buildGenerationPrompt(input);
        const limits = GENERATION_LIMITS[input.kind];
        const timeoutMs =
          input.timeoutMs ?? (input.followUp ? limits.followUpTimeoutMs : limits.timeoutMs);
        let deadline: number | null = null;
        let sentAt = 0;
        for (let attempt = 0; attempt < 2; attempt++) {
          if (cancelled) throw new GenerationError("cancelled");
          const left = deadline === null ? timeoutMs : deadline - now();
          if (left < MIN_RETRY_MS) throw new GenerationError("timeout");
          const filter = createPrefaceFilter((chunk) => handlers.onChunk?.(chunk));
          const job = llm.generate(
            {
              system: attempt === 0 ? built.system : `${built.system}\n${RETRY_NOTE}`,
              prompt: built.prompt,
              maxTokens: limits.maxTokens,
              ...(input.history ? { history: input.history } : {}),
            },
            {
              timeoutMs: left,
              onChunk: (chunk) => filter.push(chunk),
              ...(handlers.onLoading ? { onLoading: handlers.onLoading } : {}),
              onStart: () => {
                sentAt = now();
                deadline ??= sentAt + timeoutMs;
              },
            },
          );
          current = job;
          const raw = await job.result;
          if (cancelled) throw new GenerationError("cancelled");
          filter.end();
          const text = stripPreface(raw);
          if (text !== "" && !repeatsInstruction(text, input.instruction)) {
            const ms = now() - sentAt;
            deps.logger.info(
              `${input.kind} done in ${ms} ms (${input.text.length} chars in, ${text.length} out)`,
            );
            return { text, sources: built.sources, ms, retried: attempt > 0 };
          }
          if (text === "") break;
          deps.logger.warn(`${input.kind} answer repeated the instruction; asking once more`);
          handlers.onReset?.();
        }
        throw new GenerationError("empty");
      };
      const result = run().catch((error: unknown) => {
        const code = errorCode(error);
        if (code !== "cancelled" && code !== "preempted") {
          deps.logger.warn(`${input.kind} failed: ${code}`);
        }
        throw error instanceof GenerationError ? error : new GenerationError(code);
      });
      return {
        result,
        cancel() {
          cancelled = true;
          current?.cancel();
        },
      };
    },
  };
}
