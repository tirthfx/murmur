export interface ModelRequest {
  system: string;
  prompt: string;
  maxTokens: number;
}

export interface ModelAskDeps {
  /** One call of the local model. A cancelled or preempted call rejects with `retry: true`. */
  generate(request: ModelRequest): Promise<string>;
  /** True while a dictation is recording or being transcribed. */
  dictating(): boolean;
  /** True while a Rewrite, Command or Instruct generation uses the model. */
  generating(): boolean;
  wait(ms: number): Promise<void>;
}

/** A call the model dropped for another request is asked again this many times. */
export const MODEL_RETRIES = 8;

/**
 * Asks the shared local model for the Notetaker's background work (summaries, tasks). A dictation
 * always goes first, and a Rewrite, Command or Instruct generation is never cancelled by this
 * work (the newest request would win), so a call waits until they are done. A call the model
 * dropped is asked again.
 */
export function createModelAsk(deps: ModelAskDeps): (request: ModelRequest) => Promise<string> {
  return async (request) => {
    for (let attempt = 0; ; attempt++) {
      while (deps.dictating() || deps.generating()) await deps.wait(1_000);
      try {
        return await deps.generate(request);
      } catch (error) {
        if ((error as { retry?: boolean } | null)?.retry && attempt < MODEL_RETRIES) {
          await deps.wait(2_000);
          continue;
        }
        throw error;
      }
    }
  };
}
