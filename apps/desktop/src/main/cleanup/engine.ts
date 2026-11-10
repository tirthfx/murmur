// The cleanup model, run with node-llama-cpp (Metal on Apple silicon). Used inside the LLM
// utility process and by the benchmark script; never in the main process.
import type { LlamaChatSession, LlamaJsonSchemaGrammar, LlamaModel } from "node-llama-cpp";
import { maxTokensFor, systemPrompt } from "./prompt.ts";
import type { CleanupLevel } from "./rules.ts";

const SCHEMA = {
  type: "object",
  properties: { text: { type: "string" } },
} as const;

interface Loaded {
  model: LlamaModel;
  session: LlamaChatSession;
  grammar: LlamaJsonSchemaGrammar<typeof SCHEMA>;
}

export class CleanupEngine {
  private loaded: Loaded | null = null;

  get isLoaded(): boolean {
    return this.loaded !== null;
  }

  /** Loads the model and runs one short warm-up so the first real request is fast. */
  async load(modelPath: string): Promise<{ loadMs: number }> {
    const started = Date.now();
    // node-llama-cpp is an ES module with native parts; it is loaded at run time, not bundled.
    const { getLlama, LlamaChatSession } = await import("node-llama-cpp");
    const llama = await getLlama({ gpu: "auto" });
    const model = await llama.loadModel({ modelPath });
    const context = await model.createContext({ contextSize: 2048 });
    const session = new LlamaChatSession({ contextSequence: context.getSequence() });
    const grammar = await llama.createGrammarForJsonSchema(SCHEMA);
    this.loaded = { model, session, grammar };
    await this.clean("ok", "standard");
    return { loadMs: Date.now() - started };
  }

  async clean(
    text: string,
    level: Exclude<CleanupLevel, "off">,
    signal?: AbortSignal,
  ): Promise<string> {
    const loaded = this.loaded;
    if (!loaded) throw new Error("The cleanup model is not loaded");
    // Same system prompt each time, so the model reuses its cached prefix.
    loaded.session.setChatHistory([{ type: "system", text: systemPrompt(level) }]);
    const answer = await loaded.session.prompt(text, {
      grammar: loaded.grammar,
      maxTokens: maxTokensFor(text),
      temperature: 0,
      ...(signal ? { signal } : {}),
    });
    return loaded.grammar.parse(answer).text ?? "";
  }

  async unload(): Promise<void> {
    const loaded = this.loaded;
    this.loaded = null;
    await loaded?.model.dispose();
  }
}
