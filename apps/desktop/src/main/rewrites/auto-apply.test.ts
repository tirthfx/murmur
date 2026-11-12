import { describe, expect, it, vi } from "vitest";
import { createTestLogger } from "../helper/fakes";
import { openDatabase } from "../db/database";
import { GenerationError, type GenerationService } from "../generation/service";
import { createRewriteStore } from "./rewrite-store";
import { createRewriteRunStore } from "./run-store";
import { autoRewriteFor, createAutoRewriter } from "./auto-apply";

function store() {
  const db = openDatabase(":memory:");
  return { rewrites: createRewriteStore(db), runs: createRewriteRunStore(db) };
}

const all = ["personal", "work", "email", "other"] as const;

describe("autoRewriteFor", () => {
  it("picks the first auto-apply Rewrite in order, by category and words", () => {
    const { rewrites } = store();
    expect(autoRewriteFor(rewrites.list(), "work", "Some text here.")).toBeNull();
    rewrites.setAutoApply("builtin:structure", {
      enabled: true,
      minWords: 0,
      categories: [...all],
    });
    rewrites.setAutoApply("builtin:concise", {
      enabled: true,
      minWords: 5,
      categories: ["email"],
    });
    // Tighten comes first in order, so only its rules count.
    expect(autoRewriteFor(rewrites.list(), "email", "one two three four")).toBeNull();
    expect(autoRewriteFor(rewrites.list(), "email", "one two three four five")?.name).toBe(
      "Tighten",
    );
    expect(autoRewriteFor(rewrites.list(), "work", "one two three four five")).toBeNull();
    expect(autoRewriteFor(rewrites.list(), "developer", "one two three four five")).toBeNull();
    expect(autoRewriteFor(rewrites.list(), null, "one two three four five")).toBeNull();
  });

  it("runs on a 4-word dictation with min 0 and skips it with min 5", () => {
    const { rewrites } = store();
    rewrites.setAutoApply("builtin:concise", { enabled: true, minWords: 0, categories: [...all] });
    expect(autoRewriteFor(rewrites.list(), "work", "Ship it on Monday.")?.name).toBe("Tighten");
    rewrites.setAutoApply("builtin:concise", { enabled: true, minWords: 5, categories: [...all] });
    expect(autoRewriteFor(rewrites.list(), "work", "Ship it on Monday.")).toBeNull();
  });

  it("ignores a switched-off Rewrite and empty text", () => {
    const { rewrites } = store();
    rewrites.setAutoApply("builtin:concise", { enabled: true, minWords: 0, categories: [...all] });
    rewrites.setEnabled("builtin:concise", false);
    expect(autoRewriteFor(rewrites.list(), "work", "Some text.")).toBeNull();
    rewrites.setEnabled("builtin:concise", true);
    expect(autoRewriteFor(rewrites.list(), "work", "   ")).toBeNull();
  });
});

function generation(answer: () => Promise<string>) {
  const cancel = vi.fn();
  const generate = vi.fn((() => ({
    result: answer().then((text) => ({ text, sources: [], ms: 500, retried: false })),
    cancel,
  })) as GenerationService["generate"]);
  return { service: { generate } as GenerationService, generate, cancel };
}

function setup(answer: () => Promise<string>) {
  const { rewrites, runs } = store();
  rewrites.setAutoApply("builtin:concise", { enabled: true, minWords: 0, categories: [...all] });
  const gen = generation(answer);
  let fire: () => void = () => {};
  const auto = createAutoRewriter({
    rewrites,
    generation: gen.service,
    context: () => ({ style: ["Casual."], memory: [], samples: [] }),
    runs,
    logger: createTestLogger(),
    setTimer: (done) => {
      fire = done;
      return () => {};
    },
  });
  return { auto, gen, runs, rewrites, fire: () => fire() };
}

describe("createAutoRewriter", () => {
  it("applies the Rewrite with a 3 s limit and records the run", async () => {
    const { auto, gen, runs, rewrites } = setup(async () => "Ship Monday.");
    const result = await auto("So we ship it on Monday.", "work", "com.apple.Notes");
    expect(result).toEqual({
      status: "applied",
      rewriteId: "builtin:concise",
      text: "Ship Monday.",
    });
    expect(gen.generate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "rewrite", timeoutMs: 3000, style: ["Casual."] }),
    );
    expect(runs.recent(1)[0]).toMatchObject({
      outcome: "replaced",
      sourceText: "So we ship it on Monday.",
      outputText: "Ship Monday.",
      appBundleId: "com.apple.Notes",
    });
    expect(rewrites.get("builtin:concise")!.useCount).toBe(1);
  });

  it("skips a slow Rewrite when the time is up, cancelling it", async () => {
    const { auto, gen, fire, runs } = setup(() => new Promise<string>(() => {}));
    const pending = auto("So we ship it on Monday.", "work", null);
    await Promise.resolve();
    fire();
    expect(await pending).toEqual({ status: "skipped_timeout", rewriteId: "builtin:concise" });
    expect(gen.cancel).toHaveBeenCalled();
    expect(runs.recent(1)[0]).toMatchObject({ outcome: "failed", outputText: null });
  });

  it("reports a failure, and does nothing when no Rewrite applies", async () => {
    const failing = setup(async () => {
      throw new GenerationError("model-missing");
    });
    expect(await failing.auto("Some text here.", "work", null)).toEqual({
      status: "failed",
      rewriteId: "builtin:concise",
    });
    const none = setup(async () => "x");
    expect(await none.auto("Some text here.", "developer", null)).toEqual({ status: "none" });
    expect(none.gen.generate).not.toHaveBeenCalled();
  });
});
