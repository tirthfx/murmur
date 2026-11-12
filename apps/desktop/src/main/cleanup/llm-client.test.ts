import { describe, expect, it, vi } from "vitest";
import { FakeClock, createTestLogger, flush } from "../helper/fakes";
import {
  createLlmClient,
  LlmCancelledError,
  LlmPreemptedError,
  LlmTimeoutError,
  LlmTooLongError,
  type LlmChunk,
  type LlmReply,
  type LlmRequest,
  type LlmWorker,
} from "./llm-client";

class FakeWorker implements LlmWorker {
  readonly requests: LlmRequest[] = [];
  killed = false;
  private messageHandler: ((reply: LlmReply | LlmChunk) => void) | null = null;
  private exitHandler: ((code: number) => void) | null = null;
  post(request: LlmRequest) {
    this.requests.push(request);
  }
  onMessage(handler: (reply: LlmReply | LlmChunk) => void) {
    this.messageHandler = handler;
  }
  onExit(handler: (code: number) => void) {
    this.exitHandler = handler;
  }
  kill() {
    this.killed = true;
  }
  chunk(text: string) {
    const request = [...this.requests].reverse().find((item) => item.type === "generate") as {
      id: number;
    };
    this.messageHandler?.({ id: request.id, chunk: text });
  }
  reply(type: string, value: string, ok = true) {
    const request = [...this.requests].reverse().find((item) => item.type === type) as {
      id: number;
    };
    this.messageHandler?.({ id: request.id, ok, value });
  }
  crash() {
    this.exitHandler?.(1);
  }
}

function setup() {
  const clock = new FakeClock();
  const workers: FakeWorker[] = [];
  const logger = createTestLogger();
  const client = createLlmClient({
    spawn: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    modelPath: "/models/m.gguf",
    clock,
    logger,
    idleMs: 60_000,
  });
  return { clock, workers, logger, client };
}

describe("LLM client", () => {
  it("starts the worker on first use, loads, then cleans", async () => {
    const { client, workers } = setup();
    const result = client.clean("hello", "standard", 1500);
    await flush();
    expect(workers).toHaveLength(1);
    expect(workers[0]!.requests[0]).toMatchObject({ type: "load", modelPath: "/models/m.gguf" });
    workers[0]!.reply("load", "900");
    await flush();
    expect(workers[0]!.requests[1]).toMatchObject({
      type: "clean",
      text: "hello",
      level: "standard",
    });
    workers[0]!.reply("clean", "Hello.");
    await expect(result).resolves.toBe("Hello.");
  });

  it("gives up after the budget and aborts the request in the worker", async () => {
    const { client, workers, clock } = setup();
    client.prepare();
    await flush();
    workers[0]!.reply("load", "900");
    await flush();
    const result = client.clean("hello", "standard", 1500);
    const rejection = expect(result).rejects.toBeInstanceOf(LlmTimeoutError);
    await clock.advance(1500);
    await rejection;
    const clean = workers[0]!.requests.find((request) => request.type === "clean") as {
      id: number;
    };
    expect(workers[0]!.requests.at(-1)).toEqual({ type: "abort", target: clean.id });
  });

  it("translates with its own time limit, and aborts it when the limit runs out", async () => {
    const { client, workers, clock } = setup();
    client.prepare();
    await flush();
    workers[0]!.reply("load", "900");
    await flush();
    const done = client.translate("See you at 5.", "French", 6000, ["Murmur"]);
    await flush();
    expect(workers[0]!.requests.at(-1)).toMatchObject({
      type: "translate",
      text: "See you at 5.",
      language: "French",
      keep: ["Murmur"],
    });
    workers[0]!.reply("translate", "À 5 h.");
    await expect(done).resolves.toBe("À 5 h.");

    const slow = client.translate("Hello.", "French", 6000);
    const rejection = expect(slow).rejects.toBeInstanceOf(LlmTimeoutError);
    await clock.advance(5999);
    await clock.advance(1);
    await rejection;
    const last = workers[0]!.requests.filter((request) => request.type === "translate").at(-1) as {
      id: number;
    };
    expect(workers[0]!.requests.at(-1)).toEqual({ type: "abort", target: last.id });
  });

  it("counts a slow first load against the budget", async () => {
    const { client, clock } = setup();
    const result = client.clean("hello", "standard", 1500);
    const rejection = expect(result).rejects.toBeInstanceOf(LlmTimeoutError);
    await clock.advance(1500);
    await rejection;
  });

  it("stops the worker after being idle and starts a new one when needed", async () => {
    const { client, workers, clock } = setup();
    client.prepare();
    await flush();
    workers[0]!.reply("load", "1");
    await clock.advance(60_000);
    expect(workers[0]!.killed).toBe(true);
    client.prepare();
    await flush();
    expect(workers).toHaveLength(2);
  });

  it("fails pending requests when the worker crashes, and recovers", async () => {
    const { client, workers } = setup();
    client.prepare();
    await flush();
    workers[0]!.reply("load", "1");
    await flush();
    const result = client.clean("hello", "standard", 1500);
    await flush();
    workers[0]!.crash();
    await expect(result).rejects.toThrow("exited");
    client.prepare();
    await flush();
    expect(workers).toHaveLength(2);
  });

  it("reports a model that cannot load", async () => {
    const { client, workers, logger } = setup();
    const result = client.clean("hello", "standard", 1500);
    await flush();
    workers[0]!.reply("load", "no such file", false);
    await expect(result).rejects.toThrow("no such file");
    expect(workers[0]!.killed).toBe(true);
    expect(logger.lines.join("\n")).toContain("could not load");
  });

  describe("generation", () => {
    const request = { system: "rules", prompt: "<text>hi</text>", maxTokens: 4000 };

    async function loadedSetup() {
      const context = setup();
      context.client.prepare();
      await flush();
      context.workers[0]!.reply("load", "1");
      await flush();
      return context;
    }

    it("streams chunks and resolves with the answer", async () => {
      const { client, workers } = await loadedSetup();
      const chunks: string[] = [];
      const loading = vi.fn();
      const started = vi.fn();
      const job = client.generate(request, {
        timeoutMs: 20_000,
        onChunk: (text) => chunks.push(text),
        onLoading: loading,
        onStart: started,
      });
      await flush();
      expect(workers[0]!.requests.at(-1)).toMatchObject({ type: "generate", ...request });
      expect(started).toHaveBeenCalledOnce();
      expect(loading).not.toHaveBeenCalled();
      workers[0]!.chunk("Hel");
      workers[0]!.chunk("lo.");
      workers[0]!.reply("generate", "Hello.");
      await expect(job.result).resolves.toBe("Hello.");
      expect(chunks).toEqual(["Hel", "lo."]);
    });

    it("says it is loading, and starts the time limit only once loaded", async () => {
      const { client, workers, clock } = setup();
      const loading = vi.fn();
      const job = client.generate(request, { timeoutMs: 20_000, onLoading: loading });
      await flush();
      expect(loading).toHaveBeenCalledOnce();
      await clock.advance(30_000);
      workers[0]!.reply("load", "30000");
      await flush();
      expect(workers[0]!.requests.at(-1)).toMatchObject({ type: "generate" });
      workers[0]!.reply("generate", "Done.");
      await expect(job.result).resolves.toBe("Done.");
    });

    it("times out and aborts the request in the worker", async () => {
      const { client, workers, clock } = await loadedSetup();
      const job = client.generate(request, { timeoutMs: 20_000 });
      const rejection = expect(job.result).rejects.toBeInstanceOf(LlmTimeoutError);
      await flush();
      await clock.advance(20_000);
      await rejection;
      const sent = workers[0]!.requests.find((item) => item.type === "generate") as { id: number };
      expect(workers[0]!.requests.at(-1)).toEqual({ type: "abort", target: sent.id });
    });

    it("a dictation stops a generation that has produced nothing yet", async () => {
      const { client, workers } = await loadedSetup();
      const job = client.generate(request, { timeoutMs: 20_000 });
      const rejection = expect(job.result).rejects.toBeInstanceOf(LlmPreemptedError);
      await flush();
      const cleaned = client.clean("hello", "standard", 1500);
      await flush();
      await rejection;
      const sent = workers[0]!.requests.find((item) => item.type === "generate") as { id: number };
      expect(workers[0]!.requests).toContainEqual({ type: "abort", target: sent.id });
      expect(workers[0]!.requests.at(-1)).toMatchObject({ type: "clean" });
      workers[0]!.reply("clean", "Hello.");
      await expect(cleaned).resolves.toBe("Hello.");
    });

    it("a dictation waits for a generation with output, but only within its budget", async () => {
      const { client, workers, clock } = await loadedSetup();
      const job = client.generate(request, { timeoutMs: 20_000 });
      await flush();
      workers[0]!.chunk("Part");
      const cleaned = client.clean("hello", "standard", 1500);
      const rejection = expect(cleaned).rejects.toBeInstanceOf(LlmTimeoutError);
      await flush();
      expect(workers[0]!.requests.some((item) => item.type === "clean")).toBe(false);
      await clock.advance(1500);
      await rejection;
      // The generation goes on.
      workers[0]!.reply("generate", "Part two.");
      await expect(job.result).resolves.toBe("Part two.");
    });

    it("a dictation runs as soon as a generation with output ends", async () => {
      const { client, workers, clock } = await loadedSetup();
      const job = client.generate(request, { timeoutMs: 20_000 });
      await flush();
      workers[0]!.chunk("Part");
      const cleaned = client.clean("hello", "standard", 1500);
      await flush();
      await clock.advance(400);
      workers[0]!.reply("generate", "Part two.");
      await job.result;
      await flush();
      const clean = workers[0]!.requests.at(-1);
      expect(clean).toMatchObject({ type: "clean" });
      workers[0]!.reply("clean", "Hello.");
      await expect(cleaned).resolves.toBe("Hello.");
    });

    it("a generation waits for a dictation that is running", async () => {
      const { client, workers } = await loadedSetup();
      const cleaned = client.clean("hello", "standard", 1500);
      await flush();
      const job = client.generate(request, { timeoutMs: 20_000 });
      await flush();
      expect(workers[0]!.requests.some((item) => item.type === "generate")).toBe(false);
      workers[0]!.reply("clean", "Hello.");
      await cleaned;
      await flush();
      expect(workers[0]!.requests.at(-1)).toMatchObject({ type: "generate" });
      workers[0]!.reply("generate", "Done.");
      await expect(job.result).resolves.toBe("Done.");
    });

    it("a new generation cancels the last one, and cancel() stops it", async () => {
      const { client, workers } = await loadedSetup();
      const first = client.generate(request, { timeoutMs: 20_000 });
      const firstRejected = expect(first.result).rejects.toBeInstanceOf(LlmCancelledError);
      await flush();
      const second = client.generate(request, { timeoutMs: 20_000 });
      await firstRejected;
      await flush();
      const secondRejected = expect(second.result).rejects.toBeInstanceOf(LlmCancelledError);
      second.cancel();
      await secondRejected;
      const aborts = workers[0]!.requests.filter((item) => item.type === "abort");
      expect(aborts).toHaveLength(2);
    });

    it("cancel() before loading finishes sends nothing", async () => {
      const { client, workers } = setup();
      const job = client.generate(request, { timeoutMs: 20_000 });
      const rejected = expect(job.result).rejects.toBeInstanceOf(LlmCancelledError);
      await flush();
      job.cancel();
      await rejected;
      workers[0]!.reply("load", "1");
      await flush();
      expect(workers[0]!.requests.some((item) => item.type === "generate")).toBe(false);
    });

    it("maps the worker's too-long answer", async () => {
      const { client, workers } = await loadedSetup();
      const job = client.generate(request, { timeoutMs: 20_000 });
      await flush();
      workers[0]!.reply("generate", "too-long: no room", false);
      await expect(job.result).rejects.toBeInstanceOf(LlmTooLongError);
    });
  });
});
