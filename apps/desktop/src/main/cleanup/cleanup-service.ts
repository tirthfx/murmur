import type { Logger } from "../helper/types";
import { LlmTimeoutError, type LlmClient } from "./llm-client";
import { acceptCleanup } from "./prompt";
import { cleanRules, type CleanupLevel } from "./rules";

/** M1 budget for the model stage (roadmap; DC-23). */
export const CLEANUP_BUDGET_MS = 1500;
/** With less time than this left, the model is not asked at all. */
export const MIN_MODEL_BUDGET_MS = 250;

export interface CleanupResult {
  text: string;
  /** Which stage produced the text. */
  source: "rules" | "model";
  /** True when the model stage was wanted but its output was not used (`cleanup_fallback`). */
  fallback: boolean;
  reason: "model-missing" | "timeout" | "rejected" | "error" | null;
  modelMs: number | null;
}

export interface CleanupServiceDeps {
  llm: LlmClient | null;
  /** Whether the model file is on disk and passed its check. */
  modelReady: () => Promise<boolean>;
  logger: Logger;
  /** Read at each dictation, so a change in Settings applies to the next one. */
  level?: () => CleanupLevel;
  now?: () => number;
  budgetMs?: number;
}

export interface CleanupService {
  /** Called when recording starts, so the model is warm by the time the text arrives. */
  prepare(): void;
  /**
   * `terms`: names and terms on screen, for spelling (DC-30). `budgetMs`: the time left for
   * the model in this dictation; never more than the usual budget.
   */
  clean(raw: string, options?: { terms?: string[]; budgetMs?: number }): Promise<CleanupResult>;
}

/**
 * Rules first, always. Then the model, if present, within the budget; its answer is used
 * only if the output guard accepts it. Otherwise the rules' text is used.
 */
export function createCleanupService(deps: CleanupServiceDeps): CleanupService {
  const levelOf = deps.level ?? (() => "standard" as CleanupLevel);
  const now = deps.now ?? Date.now;
  const budgetMs = deps.budgetMs ?? CLEANUP_BUDGET_MS;

  return {
    prepare() {
      if (levelOf() === "off" || !deps.llm) return;
      void deps.modelReady().then((ok) => ok && deps.llm?.prepare());
    },
    async clean(raw, options = {}) {
      const terms = options.terms ?? [];
      const level = levelOf();
      const rules = cleanRules(raw, level);
      const base = { text: rules, source: "rules" as const, modelMs: null };
      if (level === "off" || rules === "") return { ...base, fallback: false, reason: null };
      if (!deps.llm || !(await deps.modelReady())) {
        return { ...base, fallback: true, reason: "model-missing" };
      }
      const budget = Math.min(budgetMs, options.budgetMs ?? budgetMs);
      if (budget < MIN_MODEL_BUDGET_MS) return { ...base, fallback: true, reason: "timeout" };
      const started = now();
      try {
        const answer = (await deps.llm.clean(rules, level, budget, terms)).trim();
        const modelMs = now() - started;
        if (!acceptCleanup(rules, answer, level, terms)) {
          deps.logger.warn("cleanup model answer refused by the guard; using the rules' text");
          return { ...base, fallback: true, reason: "rejected", modelMs };
        }
        return { text: answer, source: "model", fallback: false, reason: null, modelMs };
      } catch (error) {
        const reason = error instanceof LlmTimeoutError ? "timeout" : "error";
        return { ...base, fallback: true, reason, modelMs: now() - started };
      }
    },
  };
}
