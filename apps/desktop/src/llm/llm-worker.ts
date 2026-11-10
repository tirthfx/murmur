// Entry of the LLM utility process. A crash or a slow model here never blocks main.
import { CleanupEngine } from "../main/cleanup/engine";
import type { LlmReply, LlmRequest } from "../main/cleanup/llm-client";

const engine = new CleanupEngine();
const running = new Map<number, AbortController>();

function reply(message: LlmReply): void {
  process.parentPort.postMessage(message);
}

process.parentPort.on("message", (event) => {
  const request = event.data as LlmRequest;
  void handle(request);
});

async function handle(request: LlmRequest): Promise<void> {
  try {
    switch (request.type) {
      case "load": {
        const { loadMs } = await engine.load(request.modelPath);
        reply({ id: request.id, ok: true, value: String(loadMs) });
        return;
      }
      case "clean": {
        const controller = new AbortController();
        running.set(request.id, controller);
        try {
          const text = await engine.clean(request.text, request.level, controller.signal);
          reply({ id: request.id, ok: true, value: text });
        } finally {
          running.delete(request.id);
        }
        return;
      }
      case "abort":
        running.get(request.target)?.abort();
        return;
      case "unload":
        await engine.unload();
        reply({ id: request.id, ok: true, value: "" });
        return;
    }
  } catch (error) {
    if ("id" in request) {
      reply({
        id: request.id,
        ok: false,
        value: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
