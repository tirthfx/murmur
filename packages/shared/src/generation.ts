// Text generation for Rewrites, Command Mode and Instruct Mode (RW-07): limits and the
// messages the panels show. The model and prompts live in main and the LLM process.

export const GENERATION_KINDS = ["rewrite", "command", "instruct"] as const;
export type GenerationKind = (typeof GENERATION_KINDS)[number];

/** Output tokens and time limits per kind. The model load is not counted in the time. */
export const GENERATION_LIMITS: Record<
  GenerationKind,
  { maxTokens: number; timeoutMs: number; followUpTimeoutMs: number }
> = {
  rewrite: { maxTokens: 4000, timeoutMs: 20_000, followUpTimeoutMs: 20_000 },
  command: { maxTokens: 2000, timeoutMs: 5_000, followUpTimeoutMs: 5_000 },
  instruct: { maxTokens: 4000, timeoutMs: 30_000, followUpTimeoutMs: 20_000 },
};

/** Writing samples added to a prompt (PZ-20): at most this many, each cut to this length. */
export const GENERATION_SAMPLES = { max: 2, chars: 1500 } as const;
/** Memory facts added to a prompt (PZ-18). */
export const GENERATION_MEMORY_MAX = 20;
/** A Rewrite's own instruction and example (RW-03). */
export const GENERATION_INSTRUCTION_MAX = 1000;

export const GENERATION_ERROR_CODES = [
  /** The time limit ran out. */
  "timeout",
  /** The model gave nothing usable. */
  "empty",
  /** No model file, or it failed its check. */
  "model-missing",
  /** Not enough memory to load or run the model. */
  "memory",
  /** A dictation needed the model before any output came. */
  "preempted",
  /** The caller cancelled it, or a newer request replaced it. */
  "cancelled",
  /** The input does not fit the model's context. */
  "too-long",
  "error",
] as const;
export type GenerationErrorCode = (typeof GENERATION_ERROR_CODES)[number];

/** What the user sees for each failure. */
export const GENERATION_MESSAGES: Record<GenerationErrorCode, string> & { loading: string } = {
  loading: "Loading model",
  timeout: "Taking too long. Try again or pick a smaller selection.",
  empty: "No result. Try Regenerate.",
  "model-missing": "The language model is not downloaded. Get it in Settings.",
  memory: "Not enough memory to run the language model. Close some apps and try again.",
  preempted: "Stopped for a dictation. Try again.",
  cancelled: "Cancelled.",
  "too-long": "Select less text to rewrite (8,000 characters max).",
  error: "Something went wrong. Try again.",
};
