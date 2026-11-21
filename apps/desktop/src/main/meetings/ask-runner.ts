import type { Logger } from "../helper/types";
import type { AskCitation, AskScope, AskSendInput, AskThread } from "@murmur/shared";
import {
  ANSWER_TOKENS,
  SYSTEM,
  UNSUPPORTED_NOTHING,
  UNSUPPORTED_WITH_CLOSEST,
  askPrompt,
  numberSources,
  parseAnswer,
  sourceExcerpt,
} from "./ask-answer";
import { describeRange, questionRange, withoutDates } from "./ask-dates";
import type { AskFilter, AskIndex } from "./ask-index";
import type { AskStore } from "./ask-store";
import { createModelAsk, type ModelAskDeps } from "./model-ask";

export type AskErrorCode = "busy" | "model-missing" | "invalid" | "not-found" | "failed";

export class AskError extends Error {
  constructor(
    readonly code: AskErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AskError";
  }
}

export interface AskRunnerDeps extends ModelAskDeps {
  index: AskIndex;
  store: AskStore;
  settings(): { topK: number; includeNotes: boolean };
  modelReady(): Promise<boolean>;
  now(): number;
  logger: Logger;
}

export interface AskRunner {
  /**
   * Answers a question from the meetings in its scope and keeps both in a thread (new when
   * `threadId` is null). Throws an AskError; one question is answered at a time.
   */
  send(input: AskSendInput): Promise<AskThread>;
}

const localDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getTime();
};

/** The meetings a scope covers, as a filter for the index. */
export function scopeFilter(scope: AskScope): AskFilter {
  if (scope.kind === "meetings") return { meetingIds: scope.ids };
  if (scope.kind === "range") {
    const to = new Date(localDay(scope.to));
    return {
      from: localDay(scope.from),
      to: new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1).getTime(),
    };
  }
  return {};
}

export function createAskRunner(deps: AskRunnerDeps): AskRunner {
  const ask = createModelAsk(deps);
  let running = false;

  return {
    async send(input) {
      if (running)
        throw new AskError("busy", "Another question is being answered. Try again in a moment.");
      const question = input.question.trim();
      if (question === "") throw new AskError("invalid", "Write a question.");
      if (input.scope.kind === "range" && input.scope.from > input.scope.to)
        throw new AskError("invalid", "The first date comes after the last.");
      if (input.threadId !== null && !deps.store.get(input.threadId))
        throw new AskError("not-found", "That conversation is gone.");
      if (!(await deps.modelReady()))
        throw new AskError(
          "model-missing",
          "The language model is not downloaded. Get it in Settings.",
        );

      running = true;
      try {
        const threadId = input.threadId ?? deps.store.createThread(question, input.scope);
        if (input.threadId !== null) deps.store.setScope(threadId, input.scope);
        deps.store.addMessage(threadId, { role: "user", text: question });

        // The scope, narrowed by dates in the question ("last Tuesday").
        const filter: AskFilter = scopeFilter(input.scope);
        const asked = questionRange(question, deps.now());
        if (asked) {
          filter.from = Math.max(filter.from ?? asked.from, asked.from);
          filter.to = Math.min(filter.to ?? asked.to, asked.to);
        }
        const { topK, includeNotes } = deps.settings();
        deps.index.sync(filter);
        const hits = deps.index.search(
          question,
          {
            ...filter,
            ...(includeNotes ? {} : { sources: ["transcript", "summary", "task"] as const }),
          },
          topK,
        );

        const closest = [
          ...new Map(
            hits.map((hit) => [
              hit.meetingId,
              {
                meetingId: hit.meetingId,
                title: hit.meetingTitle,
                startedAt: hit.meetingStartedAt,
              },
            ]),
          ).values(),
        ].slice(0, 3);
        const unsupported = () =>
          deps.store.addMessage(threadId, {
            role: "assistant",
            text: closest.length > 0 ? UNSUPPORTED_WITH_CLOSEST : UNSUPPORTED_NOTHING,
            supported: false,
            closest,
          });

        if (hits.length === 0) {
          unsupported();
        } else {
          const sources = numberSources(hits);
          const output = await ask({
            system: SYSTEM,
            prompt: askPrompt(
              withoutDates(question, asked),
              sources,
              deps.now(),
              asked ? describeRange(asked) : null,
            ),
            maxTokens: ANSWER_TOKENS,
          });
          const parsed = parseAnswer(output, sources.length);
          if (parsed.kind === "unsupported") {
            if (parsed.reason === "uncited")
              deps.logger.warn("an answer with no valid citation was not kept");
            unsupported();
          } else {
            if (parsed.dropped.length > 0)
              deps.logger.warn(
                `citation numbers that are not sources were removed: ${parsed.dropped.join(", ")}`,
              );
            const citations = parsed.cited.map((n): Omit<AskCitation, "gone"> => {
              const { hit } = sources[n - 1]!;
              return {
                n,
                meetingId: hit.meetingId,
                meetingTitle: hit.meetingTitle,
                source: hit.source,
                ref: hit.ref,
                startMs: hit.startMs,
                excerpt: sourceExcerpt(hit),
              };
            });
            deps.store.addMessage(threadId, {
              role: "assistant",
              text: parsed.text,
              citations,
              supported: true,
            });
          }
        }
        return deps.store.get(threadId)!;
      } catch (error) {
        if (error instanceof AskError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        deps.logger.warn(`a question could not be answered: ${message}`);
        throw new AskError("failed", "The question could not be answered. Try again.");
      } finally {
        running = false;
      }
    },
  };
}
