import { AUTO_APPLY_TIMEOUT_MS, type AppCategory, type Rewrite } from "@murmur/shared";
import type { Logger } from "../helper/types";
import type { GenerationService } from "../generation/service";
import type { AutoRewriteResult } from "../recorder";
import type { RewriteContext } from "./rewrite-controller";
import type { RewriteRunStore } from "./run-store";

export interface AutoRewriterDeps {
  rewrites: { list(): Rewrite[]; markUsed(id: string): void };
  generation: GenerationService;
  context: (appId: string | null, text: string) => RewriteContext;
  runs: Pick<RewriteRunStore, "record"> | null;
  logger: Logger;
  timeoutMs?: number;
  /** Schedules the time limit; tests pass their own. */
  setTimer?: (done: () => void, ms: number) => () => void;
  now?: () => number;
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** The Rewrite that auto-applies to a dictation in this category, if any: the first in order. */
export function autoRewriteFor(
  rewrites: readonly Rewrite[],
  category: AppCategory | null,
  text: string,
): Rewrite | null {
  const first = rewrites.find((rewrite) => rewrite.enabled && rewrite.autoApply);
  if (!first || !category) return null;
  if (!(first.autoApplyCategories as readonly string[]).includes(category)) return null;
  const words = wordCount(text);
  if (words === 0 || words < first.autoApplyMinWords) return null;
  return first;
}

/**
 * Auto-apply (RW-05): runs the first auto-apply Rewrite on the cleaned text. The time limit
 * counts from the start, model load included, so a dictation is never held longer.
 */
export function createAutoRewriter(deps: AutoRewriterDeps) {
  const timeoutMs = deps.timeoutMs ?? AUTO_APPLY_TIMEOUT_MS;
  const setTimer =
    deps.setTimer ??
    ((done: () => void, ms: number) => {
      const handle = setTimeout(done, ms);
      return () => clearTimeout(handle);
    });
  const now = deps.now ?? Date.now;

  return async function autoRewrite(
    text: string,
    category: AppCategory | null,
    appBundleId: string | null,
  ): Promise<AutoRewriteResult> {
    const rewrite = autoRewriteFor(deps.rewrites.list(), category, text);
    if (!rewrite) return { status: "none" };
    const started = now();
    const context = deps.context(appBundleId, text);
    const run = deps.generation.generate({
      kind: "rewrite",
      instruction: rewrite.instruction,
      ...(rewrite.example ? { example: rewrite.example } : {}),
      text,
      style: context.style,
      memory: context.memory,
      samples: context.samples,
      timeoutMs,
    });
    let stopTimer: () => void = () => {};
    const late = new Promise<"late">((resolve) => {
      stopTimer = setTimer(() => resolve("late"), timeoutMs);
    });
    const record = (outcome: "replaced" | "failed", output: string | null) => {
      try {
        deps.runs?.record({
          rewriteId: rewrite.id,
          rewriteName: rewrite.name,
          sourceText: text,
          outputText: output,
          outcome,
          appBundleId,
          durationMs: now() - started,
        });
      } catch (error) {
        deps.logger.warn(`auto-apply run not saved: ${String(error)}`);
      }
    };
    try {
      const first = await Promise.race([run.result, late]);
      if (first === "late") {
        run.cancel();
        run.result.catch(() => {});
        deps.logger.info(`auto-apply ${rewrite.name} skipped after ${timeoutMs} ms`);
        record("failed", null);
        return { status: "skipped_timeout", rewriteId: rewrite.id };
      }
      deps.rewrites.markUsed(rewrite.id);
      record("replaced", first.text);
      return { status: "applied", rewriteId: rewrite.id, text: first.text };
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      deps.logger.warn(`auto-apply ${rewrite.name} failed: ${String(code ?? "error")}`);
      record("failed", null);
      return {
        status: code === "timeout" ? "skipped_timeout" : "failed",
        rewriteId: rewrite.id,
      };
    } finally {
      stopTimer();
    }
  };
}
