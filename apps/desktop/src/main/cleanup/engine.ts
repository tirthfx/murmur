// The cleanup model, run with node-llama-cpp (Metal on Apple silicon). Used inside the LLM
// utility process and by the benchmark script; never in the main process.
import type {
  ChatHistoryItem,
  LlamaChatSession,
  LlamaContext,
  LlamaJsonSchemaGrammar,
  LlamaModel,
} from "node-llama-cpp";
import { maxTokensFor, maxTranslateTokens, systemPrompt, translatePrompt } from "./prompt.ts";
import type { CleanupLevel } from "./rules.ts";

const SCHEMA = {
  type: "object",
  properties: { text: { type: "string" } },
} as const;

interface Loaded {
  model: LlamaModel;
  session: LlamaChatSession;
  grammar: LlamaJsonSchemaGrammar<typeof SCHEMA>;
  /** Builds a chat session; kept so generation can make its own (RW-07). */
  newSession: (context: LlamaContext) => LlamaChatSession;
}

/** A turn of an earlier exchange (Instruct follow-ups). */
export interface GenerationTurn {
  role: "user" | "assistant";
  text: string;
}

export interface GenerateRequest {
  system: string;
  prompt: string;
  maxTokens: number;
  history?: GenerationTurn[];
}

/** Context for generation: room for 8,000 characters in and 4,000 tokens out, less on small Macs. */
export const GENERATION_CONTEXT = { min: 4096, max: 8192 } as const;
/** Kept free in the context beyond the prompt, for the chat template's own tokens. */
const TEMPLATE_MARGIN = 64;
/** Below this many output tokens the request does not fit. */
export const MIN_GENERATION_TOKENS = 128;

/** The output cap: what was asked, or less when the prompt leaves less room. */
export function generationTokens(asked: number, contextSize: number, promptTokens: number): number {
  return Math.min(asked, contextSize - promptTokens - TEMPLATE_MARGIN);
}

export class GenerationTooLongError extends Error {
  constructor() {
    super("The text does not fit the model's context");
    this.name = "GenerationTooLongError";
  }
}

/**
 * The text from a model answer. An answer cut off by the token limit is not valid JSON; it
 * gives an empty string, which the output guard rejects, so the rules-only text is used.
 */
export function parseAnswer(answer: string, parse: (value: string) => string | undefined): string {
  try {
    return parse(answer) ?? "";
  } catch {
    return "";
  }
}

export class CleanupEngine {
  private loaded: Loaded | null = null;

  get isLoaded(): boolean {
    return this.loaded !== null;
  }

  /** Loads the model and runs one short warm-up so the first real request is fast. */
  async load(
    modelPath: string,
    // node-llama-cpp is an ES module with native parts; it is loaded at run time, not bundled.
    // The packaged app passes its own copy (see `llm-worker.ts`).
    importLlama: () => Promise<typeof import("node-llama-cpp")> = () => import("node-llama-cpp"),
  ): Promise<{ loadMs: number }> {
    const started = Date.now();
    const { getLlama, LlamaChatSession } = await importLlama();
    const llama = await getLlama({ gpu: "auto" });
    const model = await llama.loadModel({ modelPath });
    const context = await model.createContext({ contextSize: 2048 });
    const session = new LlamaChatSession({ contextSequence: context.getSequence() });
    const grammar = await llama.createGrammarForJsonSchema(SCHEMA);
    const newSession = (ctx: LlamaContext) =>
      new LlamaChatSession({ contextSequence: ctx.getSequence() });
    this.loaded = { model, session, grammar, newSession };
    await this.clean("ok", "standard");
    return { loadMs: Date.now() - started };
  }

  async clean(
    text: string,
    level: Exclude<CleanupLevel, "off">,
    signal?: AbortSignal,
    terms: string[] = [],
    instructions: string[] = [],
  ): Promise<string> {
    const loaded = this.loaded;
    if (!loaded) throw new Error("The cleanup model is not loaded");
    // The fixed part of the system prompt comes first, so the model reuses its cached prefix.
    loaded.session.setChatHistory([
      { type: "system", text: systemPrompt(level, terms, instructions) },
    ]);
    const answer = await loaded.session.prompt(text, {
      grammar: loaded.grammar,
      maxTokens: maxTokensFor(text),
      temperature: 0,
      ...(signal ? { signal } : {}),
    });
    return parseAnswer(answer, (value) => loaded.grammar.parse(value).text);
  }

  /** Translates Email-category text (PZ-22). `language` is its English name. */
  async translate(
    text: string,
    language: string,
    signal?: AbortSignal,
    keep: string[] = [],
  ): Promise<string> {
    const loaded = this.loaded;
    if (!loaded) throw new Error("The cleanup model is not loaded");
    loaded.session.setChatHistory([{ type: "system", text: translatePrompt(language, keep) }]);
    const answer = await loaded.session.prompt(text, {
      grammar: loaded.grammar,
      maxTokens: maxTranslateTokens(text),
      temperature: 0,
      ...(signal ? { signal } : {}),
    });
    return parseAnswer(answer, (value) => loaded.grammar.parse(value).text);
  }

  private generation: { context: LlamaContext; session: LlamaChatSession } | null = null;

  /**
   * Free text for Rewrites, Command Mode and Instruct Mode (RW-07), streamed through
   * `onChunk`. Runs in its own context, created on first use, so cleanup keeps its cache.
   */
  async generate(
    request: GenerateRequest,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const loaded = this.loaded;
    if (!loaded) throw new Error("The cleanup model is not loaded");
    if (!this.generation) {
      const context = await loaded.model.createContext({ contextSize: { ...GENERATION_CONTEXT } });
      this.generation = { context, session: loaded.newSession(context) };
    }
    const { context, session } = this.generation;
    const history: ChatHistoryItem[] = [{ type: "system", text: request.system }];
    for (const turn of request.history ?? []) {
      history.push(
        turn.role === "user"
          ? { type: "user", text: turn.text }
          : { type: "model", response: [turn.text] },
      );
    }
    const used = loaded.model.tokenize(
      [request.system, ...(request.history ?? []).map((turn) => turn.text), request.prompt].join(
        "\n",
      ),
    ).length;
    const maxTokens = generationTokens(request.maxTokens, context.contextSize, used);
    if (maxTokens < MIN_GENERATION_TOKENS) throw new GenerationTooLongError();
    session.setChatHistory(history);
    return session.prompt(request.prompt, {
      maxTokens,
      temperature: 0.6,
      topP: 0.9,
      onTextChunk: onChunk,
      ...(signal ? { signal } : {}),
    });
  }

  async unload(): Promise<void> {
    const loaded = this.loaded;
    const generation = this.generation;
    this.loaded = null;
    this.generation = null;
    await generation?.context.dispose();
    await loaded?.model.dispose();
  }
}
