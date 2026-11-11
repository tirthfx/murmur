import { describe, expect, it } from "vitest";
import { FakeClock, createTestLogger, flush } from "../helper/fakes";
import {
  createLlmClient,
  LlmTimeoutError,
  type LlmReply,
  type LlmRequest,
  type LlmWorker,
} from "./llm-client";

class FakeWorker implements LlmWorker {
  readonly requests: LlmRequest[] = [];
  killed = false;
  private messageHandler: ((reply: LlmReply) => void) | null = null;
  private exitHandler: ((code: number) => void) | null = null;
  post(request: LlmRequest) {
    this.requests.push(request);
  }
  onMessage(handler: (reply: LlmReply) => void) {
    this.messageHandler = handler;
  }
  onExit(handler: (code: number) => void) {
    this.exitHandler = handler;
  }
  kill() {
    this.killed = true;
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
});
