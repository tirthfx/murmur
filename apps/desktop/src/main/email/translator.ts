import { EMAIL_LIMITS, emailLanguageLabel, type EmailLanguage } from "@murmur/shared";
import { acceptTranslation } from "../cleanup/prompt";
import { LlmTimeoutError, type LlmClient } from "../cleanup/llm-client";
import type { Logger } from "../helper/types";

export interface TranslatorDeps {
  llm: LlmClient | null;
  modelReady: () => Promise<boolean>;
  logger: Logger;
  timeoutMs?: number;
}

/**
 * Email language (PZ-22): the local model translates within its own limit, and its answer
 * is used only if the guard finds every link, number and kept word in it. Null otherwise.
 */
export function createTranslator(deps: TranslatorDeps) {
  const timeoutMs = deps.timeoutMs ?? EMAIL_LIMITS.translateMs;
  return async (text: string, language: EmailLanguage, keep: string[]): Promise<string | null> => {
    if (!deps.llm || !(await deps.modelReady())) {
      deps.logger.warn("no cleanup model, so email text cannot be translated");
      return null;
    }
    try {
      const answer = (
        await deps.llm.translate(text, emailLanguageLabel(language), timeoutMs, keep)
      ).trim();
      if (!acceptTranslation(text, answer, keep)) {
        deps.logger.warn("translation refused by the guard");
        return null;
      }
      return answer;
    } catch (error) {
      deps.logger.warn(
        error instanceof LlmTimeoutError
          ? `translation took longer than ${timeoutMs / 1000} s`
          : `translation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  };
}
